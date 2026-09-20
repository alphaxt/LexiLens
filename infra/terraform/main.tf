# Reference architecture only: it is deliberately fail-closed until an approved operator explicitly
# acknowledges the prerequisite runbook. It must not be treated as a deployable stack or applied by CI.
# Apply requires explicit user approval and reviewed values for every TODO variable.
locals {
  name = "lexilens-${var.stage}"
}

data "aws_vpc" "selected" {
  id = var.vpc_id
}

data "aws_caller_identity" "current" {}

resource "aws_kms_key" "quarantine" {
  description             = "${local.name} private document quarantine encryption"
  deletion_window_in_days = 30
  lifecycle {
    precondition {
      condition     = var.acknowledge_reference_architecture
      error_message = "This is a non-deployable reference architecture until the runbook prerequisites are approved. Set acknowledge_reference_architecture=true only after review; do not apply from this repository by default."
    }
  }
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "EnableRootAdministration"
      Effect    = "Allow"
      Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
      Action    = "kms:*"
      Resource  = "*"
    }]
  })
}

resource "aws_s3_bucket" "quarantine" {
  bucket_prefix = "${local.name}-quarantine-"
}

resource "aws_s3_bucket_public_access_block" "quarantine" {
  bucket                  = aws_s3_bucket.quarantine.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "quarantine" {
  bucket = aws_s3_bucket.quarantine.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.quarantine.arn
    }
  }
}

resource "aws_s3_bucket_policy" "quarantine" {
  bucket = aws_s3_bucket.quarantine.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.quarantine.arn, "${aws_s3_bucket.quarantine.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

resource "aws_security_group" "rds" {
  name_prefix = "${local.name}-rds-"
  vpc_id      = data.aws_vpc.selected.id
  # TODO: add ingress only from the approved API task security group before apply.
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_subnet_group" "postgres" {
  name_prefix = "${local.name}-"
  subnet_ids  = var.database_subnet_ids
}

resource "aws_db_instance" "postgres" {
  identifier                  = local.name
  engine                      = "postgres"
  engine_version              = "16.6"
  instance_class              = "db.t4g.medium"
  allocated_storage           = 50
  max_allocated_storage       = 200
  db_name                     = "lexilens"
  username                    = "lexilens_app"
  manage_master_user_password = true
  storage_encrypted           = true
  kms_key_id                  = aws_kms_key.quarantine.arn
  db_subnet_group_name        = aws_db_subnet_group.postgres.name
  vpc_security_group_ids      = [aws_security_group.rds.id]
  publicly_accessible         = false
  backup_retention_period     = 35
  deletion_protection         = true
  skip_final_snapshot         = false
  final_snapshot_identifier   = "${local.name}-final"
}

resource "aws_sqs_queue" "extraction_dlq" {
  name                      = "${local.name}-extraction-dlq"
  kms_master_key_id         = aws_kms_key.quarantine.id
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "extraction" {
  name                       = "${local.name}-extraction"
  kms_master_key_id          = aws_kms_key.quarantine.id
  visibility_timeout_seconds = 300
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.extraction_dlq.arn
    maxReceiveCount     = 5
  })
}

resource "aws_ecs_cluster" "this" {
  name = local.name
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name}/api"
  retention_in_days = 30
}

resource "aws_iam_role" "task" {
  name_prefix = "${local.name}-task-"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "task" {
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = "${aws_s3_bucket.quarantine.arn}/*" },
      { Effect = "Allow", Action = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"], Resource = aws_kms_key.quarantine.arn },
      { Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:SendMessage", "sqs:GetQueueAttributes"], Resource = [aws_sqs_queue.extraction.arn, aws_sqs_queue.extraction_dlq.arn] },
    ]
  })
}

# TODO: add a separately scoped execution role for ECR pulls/logs and a Secrets Manager policy for DATABASE_URL/OIDC configuration.
resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.task.arn # TODO: replace with execution role.
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name         = "api"
    image        = var.container_image
    essential    = true
    portMappings = [{ containerPort = 4000 }]
    environment = [
      { name = "HOST", value = "0.0.0.0" },
      { name = "PERSISTENCE_MODE", value = "postgresql" },
      { name = "STORAGE_MODE", value = "s3" },
      { name = "AUTH_MODE", value = "oidc" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.api.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "api"
      }
    }
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])
}

resource "aws_ecs_service" "api" {
  name            = "${local.name}-api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 2
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [] # TODO: attach least-privilege API task security group.
    assign_public_ip = false
  }
}

# Edge delivery is intentionally conceptual until approved domains/certificates/origins exist:
# CloudFront should serve the web origin, WAF should rate-limit and block known bad inputs, and
# the API should sit behind an internal ALB with TLS. Add those resources only with approved ARNs/domains.
output "quarantine_bucket_name" {
  value = aws_s3_bucket.quarantine.id
}
output "extraction_queue_url" {
  value = aws_sqs_queue.extraction.url
}
output "database_secret_arn" {
  value = aws_db_instance.postgres.master_user_secret[0].secret_arn
}
