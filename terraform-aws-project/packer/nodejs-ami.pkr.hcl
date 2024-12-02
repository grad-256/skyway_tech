packer {
  required_plugins {
    amazon = {
      version = ">= 1.2.8"
      source  = "github.com/hashicorp/amazon"
    }
  }
}

source "amazon-ebs" "ubuntu" {
  ami_name      = "nodejs-base-${formatdate("YYYYMMDD-hhmmss", timestamp())}"
  instance_type = "t2.micro"
  region        = "ap-northeast-1"
  source_ami_filter {
    filters = {
      name                = "ubuntu/images/*ubuntu-jammy-22.04-amd64-server-*"
      root-device-type    = "ebs"
      virtualization-type = "hvm"
    }
    most_recent = true
    owners      = ["099720109477"] # Canonical
  }
  ssh_username = "ubuntu"
}

build {
  name = "nodejs-base"
  sources = [
    "source.amazon-ebs.ubuntu"
  ]

  provisioner "shell" {
    inline = [
      "sudo apt-get update",
      "sudo apt-get install -y ca-certificates software-properties-common",
      "sudo apt-get update",
      "sudo apt-get install -y curl build-essential",
      "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -",
      "sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs",
      "sudo npm install -g npm@latest pnpm",
      "mkdir -p /home/ubuntu/.local/share/pnpm",
      "echo 'export PNPM_HOME=\"/home/ubuntu/.local/share/pnpm\"' >> /home/ubuntu/.profile",
      "echo 'export PATH=\"$PNPM_HOME:$PATH\"' >> /home/ubuntu/.profile",
      ". /home/ubuntu/.profile",
      "pnpm setup",
      ". /home/ubuntu/.profile",
      "pnpm add -g typescript ts-node pm2"
    ]
  }
} 