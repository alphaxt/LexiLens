# Internal-only TLS ingress. These resources make service reachability explicit without public DNS or CDN delivery.
data "aws_route53_zone" "private" {
  zone_id      = var.private_hosted_zone_id
  private_zone = true
}

resource "aws_security_group" "api_alb" {
  name_prefix = "${local.name}-api-alb-"
  description = "Internal API ALB accepts HTTPS only from approved VPC CIDRs."
  vpc_id      = data.aws_vpc.selected.id
  tags        = local.tags
  egress      = []

  ingress {
    description = "Approved private API clients"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.api_allowed_cidrs
  }
}

resource "aws_security_group" "scanner_alb" {
  name_prefix = "${local.name}-scanner-alb-"
  description = "Internal scanner ALB accepts HTTPS only from API and maintenance worker tasks."
  vpc_id      = data.aws_vpc.selected.id
  tags        = local.tags
  egress      = []

  ingress {
    description     = "HTTPS from API and maintenance worker"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id, aws_security_group.worker.id]
  }
}

resource "aws_vpc_security_group_egress_rule" "api_alb_to_api" {
  security_group_id            = aws_security_group.api_alb.id
  referenced_security_group_id = aws_security_group.api.id
  description                  = "HTTP to API tasks"
  from_port                    = 4000
  to_port                      = 4000
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "scanner_alb_to_scanner" {
  security_group_id            = aws_security_group.scanner_alb.id
  referenced_security_group_id = aws_security_group.scanner.id
  description                  = "HTTPS to scanner tasks"
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
}

resource "aws_lb" "api" {
  name_prefix        = "${local.name}-api-"
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.api_alb.id]
  subnets            = var.private_subnet_ids
  idle_timeout       = 60
  tags               = local.tags
}

resource "aws_lb_target_group" "api" {
  name_prefix = "${local.name}-api-"
  port        = 4000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = data.aws_vpc.selected.id
  health_check {
    enabled             = true
    protocol            = "HTTP"
    path                = var.api_health_check_path
    matcher             = "200-399"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
  }
  tags = local.tags
}

resource "aws_lb_listener" "api_https" {
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.api_acm_certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_wafv2_web_acl_association" "api" {
  resource_arn = aws_lb.api.arn
  web_acl_arn  = var.api_waf_web_acl_arn
}

resource "aws_route53_record" "api" {
  zone_id = data.aws_route53_zone.private.zone_id
  name    = var.api_private_dns_name
  type    = "A"
  alias {
    name                   = aws_lb.api.dns_name
    zone_id                = aws_lb.api.zone_id
    evaluate_target_health = true
  }
}

resource "aws_lb" "scanner" {
  name_prefix        = "${local.name}-scanner-"
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.scanner_alb.id]
  subnets            = var.private_subnet_ids
  idle_timeout       = 60
  tags               = local.tags
}

resource "aws_lb_target_group" "scanner" {
  name_prefix = "${local.name}-scanner-"
  port        = 443
  protocol    = "HTTPS"
  target_type = "ip"
  vpc_id      = data.aws_vpc.selected.id
  health_check {
    enabled             = true
    protocol            = "HTTPS"
    path                = var.scanner_health_check_path
    matcher             = "200-399"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
  }
  tags = local.tags
}

resource "aws_lb_listener" "scanner_https" {
  load_balancer_arn = aws_lb.scanner.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.scanner_acm_certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.scanner.arn
  }
}

resource "aws_route53_record" "scanner" {
  zone_id = data.aws_route53_zone.private.zone_id
  name    = var.scanner_private_dns_name
  type    = "A"
  alias {
    name                   = aws_lb.scanner.dns_name
    zone_id                = aws_lb.scanner.zone_id
    evaluate_target_health = true
  }
}

output "private_api_endpoint" {
  value = "https://${trimsuffix(aws_route53_record.api.fqdn, ".")}"
}

output "private_scanner_endpoint" {
  value = "https://${trimsuffix(aws_route53_record.scanner.fqdn, ".")}/scan"
}
