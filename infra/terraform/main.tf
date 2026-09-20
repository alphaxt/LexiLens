# Guarded private-workload template. CI deliberately does not run terraform init, plan, or apply.

locals {
  name = "lexilens-${var.stage}"
  tags = merge(var.tags, {
    Service     = "LexiLens"
    Environment = var.stage
  })
  task_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  runtime_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "PERSISTENCE_MODE", value = "postgresql" },
    { name = "STORAGE_MODE", value = "s3" },
    { name = "S3_ENDPOINT", value = "https://s3.${var.aws_region}.amazonaws.com" },
    { name = "S3_BUCKET", value = aws_s3_bucket.quarantine.id },
    { name = "AUTH_MODE", value = "oidc" },
    { name = "SCANNER_MODE", value = "configured" },
  ]
  runtime_secrets = [
    { name = "DATABASE_HOST", valueFrom = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}:host::" },
    { name = "DATABASE_PORT", valueFrom = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}:port::" },
    { name = "DATABASE_USERNAME", valueFrom = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}:username::" },
    { name = "DATABASE_PASSWORD", valueFrom = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}:password::" },
    { name = "DATABASE_NAME", valueFrom = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}:dbname::" },
    { name = "SCANNER_ENDPOINT", valueFrom = "${aws_secretsmanager_secret.runtime.arn}:SCANNER_ENDPOINT::" },
    { name = "SCANNER_VERSION", valueFrom = "${aws_secretsmanager_secret.runtime.arn}:SCANNER_VERSION::" },
    { name = "OIDC_ISSUER_URL", valueFrom = "${aws_secretsmanager_secret.runtime.arn}:OIDC_ISSUER_URL::" },
    { name = "OIDC_JWKS_URI", valueFrom = "${aws_secretsmanager_secret.runtime.arn}:OIDC_JWKS_URI::" },
    { name = "OIDC_AUDIENCE", valueFrom = "${aws_secretsmanager_secret.runtime.arn}:OIDC_AUDIENCE::" },
  ]
}

data "aws_vpc" "selected" {
  id = var.vpc_id
}

resource "terraform_data" "deployment_guard" {
  input = local.name
  lifecycle {
    precondition {
      condition     = var.acknowledge_deployment
      error_message = "Set acknowledge_deployment=true only after operator review of domains, image digests, networking, remote state, and change plan."
    }
  }
}

resource "aws_kms_key" "data" {
  description             = "${local.name} data encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = local.tags
  depends_on              = [terraform_data.deployment_guard]
}

resource "aws_s3_bucket" "quarantine" {
  bucket_prefix = "${local.name}-quarantine-"
  tags          = local.tags
  depends_on    = [terraform_data.deployment_guard]
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
      kms_master_key_id = aws_kms_key.data.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "quarantine" {
  bucket = aws_s3_bucket.quarantine.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_policy" "quarantine_tls" {
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

resource "aws_security_group" "api" {
  name_prefix = "${local.name}-api-"
  description = "LexiLens API; ingress is intentionally supplied by a separately reviewed edge module."
  vpc_id      = data.aws_vpc.selected.id
  tags        = local.tags
  depends_on  = [terraform_data.deployment_guard]
}

resource "aws_security_group" "worker" {
  name_prefix = "${local.name}-worker-"
  description = "LexiLens maintenance worker; no inbound traffic."
  vpc_id      = data.aws_vpc.selected.id
  tags        = local.tags
  depends_on  = [terraform_data.deployment_guard]
}

resource "aws_security_group" "scanner" {
  name_prefix = "${local.name}-scanner-"
  description = "Approved scanner facade accepts HTTPS only from API and worker tasks."
  vpc_id      = data.aws_vpc.selected.id
  tags        = local.tags
  depends_on  = [terraform_data.deployment_guard]

  ingress {
    description     = "HTTPS from API and maintenance worker"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id, aws_security_group.worker.id]
  }
}

resource "aws_security_group" "rds" {
  name_prefix = "${local.name}-rds-"
  description = "PostgreSQL accepts traffic only from API and maintenance worker tasks."
  vpc_id      = data.aws_vpc.selected.id
  tags        = local.tags
  depends_on  = [terraform_data.deployment_guard]

  ingress {
    description     = "PostgreSQL from API and maintenance worker"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id, aws_security_group.worker.id]
  }
}

resource "aws_db_subnet_group" "postgres" {
  name_prefix = "${local.name}-"
  subnet_ids  = var.database_subnet_ids
  tags        = local.tags
  depends_on  = [terraform_data.deployment_guard]
}

resource "aws_db_instance" "postgres" {
  identifier                      = local.name
  engine                          = "postgres"
  engine_version                  = "16.6"
  instance_class                  = "db.t4g.medium"
  allocated_storage               = 50
  max_allocated_storage           = 100
  db_name                         = "lexilens"
  username                        = "lexilens_app"
  manage_master_user_password     = true
  storage_encrypted               = true
  kms_key_id                      = aws_kms_key.data.arn
  db_subnet_group_name            = aws_db_subnet_group.postgres.name
  vpc_security_group_ids          = [aws_security_group.rds.id]
  publicly_accessible             = false
  deletion_protection             = true
  backup_retention_period         = 35
  copy_tags_to_snapshot           = true
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${local.name}-final"
  tags                            = local.tags
  depends_on                      = [terraform_data.deployment_guard]
}

resource "aws_sqs_queue" "dlq" {
  name                      = "${local.name}-extraction-dlq"
  kms_master_key_id         = aws_kms_key.data.id
  message_retention_seconds = 1209600
  tags                      = local.tags
  depends_on                = [terraform_data.deployment_guard]
}

resource "aws_sqs_queue" "extraction" {
  name                       = "${local.name}-extraction"
  kms_master_key_id          = aws_kms_key.data.id
  visibility_timeout_seconds = 300
  message_retention_seconds  = 1209600
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 5
  })
  tags       = local.tags
  depends_on = [terraform_data.deployment_guard]
}

resource "aws_sqs_queue_policy" "dlq_events" {
  queue_url = aws_sqs_queue.dlq.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = aws_sqs_queue.dlq.arn
      Condition = { ArnEquals = { "aws:SourceArn" = aws_cloudwatch_event_rule.maintenance.arn } }
    }]
  })
}

resource "aws_sns_topic" "alerts" {
  name              = "${local.name}-alerts"
  kms_master_key_id = aws_kms_key.data.id
  tags              = local.tags
  depends_on        = [terraform_data.deployment_guard]
}

resource "aws_sns_topic_subscription" "alerts" {
  topic_arn  = aws_sns_topic.alerts.arn
  protocol   = "email"
  endpoint   = var.alert_email
  depends_on = [terraform_data.deployment_guard]
}

resource "aws_cloudwatch_metric_alarm" "dlq" {
  alarm_name          = "${local.name}-dlq"
  alarm_description   = "Extraction/EventBridge dead-letter queue has messages."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  dimensions          = { QueueName = aws_sqs_queue.dlq.name }
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = local.tags
  depends_on          = [terraform_data.deployment_guard]
}

resource "aws_ecs_cluster" "this" {
  name       = local.name
  tags       = local.tags
  depends_on = [terraform_data.deployment_guard]
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name}/api"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.data.arn
  tags              = local.tags
  depends_on        = [terraform_data.deployment_guard]
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${local.name}/worker"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.data.arn
  tags              = local.tags
  depends_on        = [terraform_data.deployment_guard]
}

resource "aws_cloudwatch_log_group" "scanner" {
  name              = "/ecs/${local.name}/scanner"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.data.arn
  tags              = local.tags
  depends_on        = [terraform_data.deployment_guard]
}

resource "aws_iam_role" "execution" {
  name_prefix        = "${local.name}-execution-"
  assume_role_policy = local.task_assume_role_policy
  tags               = local.tags
  depends_on         = [terraform_data.deployment_guard]
}

resource "aws_iam_role" "api" {
  name_prefix        = "${local.name}-api-"
  assume_role_policy = local.task_assume_role_policy
  tags               = local.tags
  depends_on         = [terraform_data.deployment_guard]
}

resource "aws_iam_role" "worker" {
  name_prefix        = "${local.name}-worker-"
  assume_role_policy = local.task_assume_role_policy
  tags               = local.tags
  depends_on         = [terraform_data.deployment_guard]
}

resource "aws_iam_role" "scanner" {
  name_prefix        = "${local.name}-scanner-"
  assume_role_policy = local.task_assume_role_policy
  tags               = local.tags
  depends_on         = [terraform_data.deployment_guard]
}

resource "aws_iam_role" "events" {
  name_prefix = "${local.name}-events-"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags       = local.tags
  depends_on = [terraform_data.deployment_guard]
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_secretsmanager_secret" "runtime" {
  name_prefix = "${local.name}-runtime-"
  kms_key_id  = aws_kms_key.data.arn
  tags        = local.tags
  depends_on  = [terraform_data.deployment_guard]
}

resource "aws_secretsmanager_secret_version" "runtime" {
  secret_id = aws_secretsmanager_secret.runtime.id
  secret_string = jsonencode({
    SCANNER_ENDPOINT = var.scanner_endpoint
    SCANNER_VERSION  = var.scanner_version
    OIDC_ISSUER_URL  = var.oidc_issuer_url
    OIDC_JWKS_URI    = var.oidc_jwks_uri
    OIDC_AUDIENCE    = var.oidc_audience
  })
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "runtime-secret-injection"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.runtime.arn, aws_db_instance.postgres.master_user_secret[0].secret_arn]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = aws_kms_key.data.arn
      },
    ]
  })
}

resource "aws_iam_role_policy" "api_storage" {
  name = "quarantine-object-access"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:ListBucket"], Resource = aws_s3_bucket.quarantine.arn },
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = "${aws_s3_bucket.quarantine.arn}/*" },
      { Effect = "Allow", Action = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"], Resource = aws_kms_key.data.arn },
    ]
  })
}

resource "aws_iam_role_policy" "worker_storage" {
  name = "quarantine-cleanup-access"
  role = aws_iam_role.worker.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:ListBucket"], Resource = aws_s3_bucket.quarantine.arn },
      { Effect = "Allow", Action = ["s3:GetObject", "s3:DeleteObject"], Resource = "${aws_s3_bucket.quarantine.arn}/*" },
      { Effect = "Allow", Action = ["kms:Decrypt"], Resource = aws_kms_key.data.arn },
    ]
  })
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.api.arn
  container_definitions = jsonencode([{
    name         = "api"
    image        = var.api_image
    essential    = true
    portMappings = [{ containerPort = 4000, protocol = "tcp" }]
    environment  = local.runtime_environment
    secrets      = local.runtime_secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.api.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "api"
      }
    }
  }])
  depends_on = [terraform_data.deployment_guard]
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name}-maintenance"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.worker.arn
  container_definitions = jsonencode([{
    name        = "maintenance"
    image       = var.api_image
    essential   = true
    command     = ["node", "apps/api/dist/worker.js"]
    environment = local.runtime_environment
    secrets     = local.runtime_secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.worker.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "worker"
      }
    }
  }])
  depends_on = [terraform_data.deployment_guard]
}

resource "aws_ecs_task_definition" "scanner" {
  family                   = "${local.name}-scanner"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.scanner.arn
  container_definitions = jsonencode([{
    name                   = "approved-scanner-facade"
    image                  = var.scanner_image
    essential              = true
    portMappings           = [{ containerPort = 443, protocol = "tcp" }]
    environment            = [{ name = "SCANNER_LISTEN_PORT", value = "443" }, { name = "SCANNER_VERSION", value = var.scanner_version }]
    readonlyRootFilesystem = true
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.scanner.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "scanner"
      }
    }
  }])
  depends_on = [terraform_data.deployment_guard]
}

resource "aws_ecs_service" "api" {
  name            = "${local.name}-api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 2
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }
  tags       = local.tags
  depends_on = [terraform_data.deployment_guard]
}

resource "aws_ecs_service" "scanner" {
  name            = "${local.name}-scanner"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.scanner.arn
  desired_count   = 1
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.scanner.id]
    assign_public_ip = false
  }
  tags       = local.tags
  depends_on = [terraform_data.deployment_guard]
}

resource "aws_cloudwatch_event_rule" "maintenance" {
  name                = "${local.name}-maintenance"
  description         = "Runs retention and extraction lease reconciliation."
  schedule_expression = "rate(5 minutes)"
  tags                = local.tags
  depends_on          = [terraform_data.deployment_guard]
}

resource "aws_iam_role_policy" "events_run_worker" {
  name = "run-maintenance-task"
  role = aws_iam_role.events.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecs:RunTask"], Resource = aws_ecs_task_definition.worker.arn },
      {
        Effect    = "Allow"
        Action    = ["iam:PassRole"]
        Resource  = [aws_iam_role.execution.arn, aws_iam_role.worker.arn]
        Condition = { StringLike = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
    ]
  })
}

resource "aws_cloudwatch_event_target" "maintenance" {
  rule     = aws_cloudwatch_event_rule.maintenance.name
  arn      = aws_ecs_cluster.this.arn
  role_arn = aws_iam_role.events.arn
  dead_letter_config { arn = aws_sqs_queue.dlq.arn }
  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 5
  }
  ecs_target {
    task_definition_arn = aws_ecs_task_definition.worker.arn
    launch_type         = "FARGATE"
    network_configuration {
      subnets          = var.private_subnet_ids
      security_groups  = [aws_security_group.worker.id]
      assign_public_ip = false
    }
  }
  depends_on = [terraform_data.deployment_guard, aws_sqs_queue_policy.dlq_events]
}

output "quarantine_bucket_name" {
  value = aws_s3_bucket.quarantine.id
}

output "database_secret_arn" {
  value     = aws_db_instance.postgres.master_user_secret[0].secret_arn
  sensitive = true
}
