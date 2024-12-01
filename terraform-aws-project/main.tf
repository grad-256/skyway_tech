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

resource "aws_s3_bucket" "test" {
  bucket = "my-test-bucket-${random_string.random.result}"
  
  # バケットを削除する際に中身も強制削除
  force_destroy = true

  # タグ付けでコスト管理
  tags = {
    Environment = "test"
    Project     = "terraform-test"
  }
}

# ライフサイクルルールの追加（オプション）
resource "aws_s3_bucket_lifecycle_configuration" "example" {
  bucket = aws_s3_bucket.test.id

  rule {
    id     = "cleanup"
    status = "Enabled"

    # 30日後に削除
    expiration {
      days = 1
    }
  }
}

resource "random_string" "random" {
  length  = 8
  special = false
  upper   = false
} 