terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 4.0"
    }
  }
}

provider "aws" {
  region = "ap-northeast-1"
}

# VPCの作成
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "main"
  }
}

# パブリックサブネットの作成
resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "ap-northeast-1a"
  map_public_ip_on_launch = true

  tags = {
    Name = "public"
  }
}

# インターネットゲートウェイの作成
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "main"
  }
}

# ルートテーブルの作成
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "public"
  }
}

# サブネットとルートテーブルの関連付け
resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# セキュリティグループの作成
resource "aws_security_group" "nodejs_sg" {
  name        = "nodejs_sg"
  description = "Security group for Node.js application"
  vpc_id      = aws_vpc.main.id

  # HTTP用（Nginx）
  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # SSH接続用
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # フロントエンド用（Vite）
  ingress {
    from_port   = 5173
    to_port     = 5174  # ポート範囲を指定
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # バックエンドAPI用
  ingress {
    from_port   = 3001
    to_port     = 3001
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # アウトバウンドトラフィック
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "nodejs_sg"
  }
}

# キーペアの作成
resource "aws_key_pair" "nodejs_key" {
  key_name   = "nodejs-key"
  public_key = file("~/.ssh/nodejs_key.pub")  # この行が正しいパスを指しているか確認
}

# カスタムAMIの参照
data "aws_ami" "nodejs" {
  most_recent = true
  owners      = ["self"]

  filter {
    name   = "name"
    values = ["nodejs-base-*"]
  }
}

# EC2インスタンス作成
resource "aws_instance" "nodejs_server" {
  ami           = data.aws_ami.nodejs.id  # 作成したカスタムAMIを使用
  instance_type = "t2.medium"
  subnet_id     = aws_subnet.public.id

  vpc_security_group_ids = [aws_security_group.nodejs_sg.id]
  associate_public_ip_address = true

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
  }

  key_name = aws_key_pair.nodejs_key.key_name

  tags = {
    Name = "nodejs-dev-server"
  }
}

# Elastic IPの割り当て
resource "aws_eip" "nodejs_eip" {
  instance = aws_instance.nodejs_server.id
  vpc      = true

  tags = {
    Name = "nodejs-eip"
  }
}

# 出力の設定
output "public_ip" {
  value = aws_eip.nodejs_eip.public_ip
  description = "The public IP address of the Node.js server"
} 
  