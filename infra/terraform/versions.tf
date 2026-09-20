terraform {
  required_version = ">= 1.10.5, < 1.17.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 5.82.2"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(var.tags, {
      ManagedBy = "terraform"
      Service   = "lexilens"
      Stage     = var.stage
    })
  }
}
