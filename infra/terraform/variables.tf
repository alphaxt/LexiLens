variable "acknowledge_deployment" {
  type        = bool
  default     = false
  description = "Safety interlock; set true only for an operator-reviewed deployment."
}

variable "aws_region" {
  type = string
  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]+$", var.aws_region))
    error_message = "aws_region must be a valid AWS region name."
  }
}

variable "stage" {
  type = string
  validation {
    condition     = contains(["staging", "production"], var.stage)
    error_message = "stage must be staging or production."
  }
}

variable "vpc_id" {
  type = string
  validation {
    condition     = can(regex("^vpc-[0-9a-f]+$", var.vpc_id))
    error_message = "vpc_id must be an approved VPC identifier."
  }
}

variable "private_subnet_ids" {
  type = list(string)
  validation {
    condition     = length(var.private_subnet_ids) >= 2 && alltrue([for id in var.private_subnet_ids : can(regex("^subnet-[0-9a-f]+$", id))])
    error_message = "At least two approved private subnet identifiers are required."
  }
}

variable "database_subnet_ids" {
  type = list(string)
  validation {
    condition     = length(var.database_subnet_ids) >= 2 && alltrue([for id in var.database_subnet_ids : can(regex("^subnet-[0-9a-f]+$", id))])
    error_message = "At least two approved database subnet identifiers are required."
  }
}

variable "api_allowed_cidrs" {
  type        = list(string)
  description = "Approved private CIDRs permitted to connect to the internal API ALB over HTTPS."
  validation {
    condition     = length(var.api_allowed_cidrs) > 0 && alltrue([for cidr in var.api_allowed_cidrs : can(cidrhost(cidr, 0))])
    error_message = "api_allowed_cidrs must contain one or more valid CIDR ranges."
  }
}

variable "private_hosted_zone_id" {
  type        = string
  description = "Required Route 53 private hosted zone for internal API and scanner records."
  validation {
    condition     = can(regex("^Z[A-Z0-9]+$", var.private_hosted_zone_id))
    error_message = "private_hosted_zone_id must be a Route 53 hosted-zone identifier."
  }
}

variable "api_private_dns_name" {
  type        = string
  description = "Private DNS name for the internal API ALB."
  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$", var.api_private_dns_name))
    error_message = "api_private_dns_name must be a DNS name."
  }
}

variable "scanner_private_dns_name" {
  type        = string
  description = "Private DNS name for the internal scanner ALB."
  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$", var.scanner_private_dns_name))
    error_message = "scanner_private_dns_name must be a DNS name."
  }
}

variable "api_acm_certificate_arn" {
  type        = string
  description = "ACM certificate ARN trusted by private API clients in this region."
  validation {
    condition     = can(regex("^arn:aws[a-z-]*:acm:[a-z]{2}-[a-z]+-[0-9]+:[0-9]{12}:certificate/[0-9a-f-]+$", var.api_acm_certificate_arn))
    error_message = "api_acm_certificate_arn must be a regional ACM certificate ARN."
  }
}

variable "scanner_acm_certificate_arn" {
  type        = string
  description = "ACM certificate ARN trusted by API and worker clients for the private scanner endpoint."
  validation {
    condition     = can(regex("^arn:aws[a-z-]*:acm:[a-z]{2}-[a-z]+-[0-9]+:[0-9]{12}:certificate/[0-9a-f-]+$", var.scanner_acm_certificate_arn))
    error_message = "scanner_acm_certificate_arn must be a regional ACM certificate ARN."
  }
}

variable "api_waf_web_acl_arn" {
  type        = string
  description = "Regional WAFv2 web ACL ARN associated with the internal API ALB."
  validation {
    condition     = can(regex("^arn:aws[a-z-]*:wafv2:[a-z]{2}-[a-z]+-[0-9]+:[0-9]{12}:regional/webacl/.+", var.api_waf_web_acl_arn))
    error_message = "api_waf_web_acl_arn must be a regional WAFv2 web ACL ARN."
  }
}

variable "api_health_check_path" {
  type        = string
  default     = "/docs"
  description = "Unauthenticated API path expected to return 2xx/3xx for internal ALB health checks."
  validation {
    condition     = can(regex("^/[^[:space:]]*$", var.api_health_check_path))
    error_message = "api_health_check_path must be an absolute path."
  }
}

variable "scanner_health_check_path" {
  type        = string
  default     = "/health"
  description = "Approved scanner facade HTTPS health-check path."
  validation {
    condition     = can(regex("^/[^[:space:]]*$", var.scanner_health_check_path))
    error_message = "scanner_health_check_path must be an absolute path."
  }
}

variable "api_image" {
  type = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.api_image))
    error_message = "api_image must end in an approved immutable sha256 digest."
  }
}

variable "scanner_image" {
  type = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.scanner_image))
    error_message = "scanner_image must end in an approved immutable sha256 digest."
  }
}

variable "scanner_version" {
  type = string
  validation {
    condition     = length(trimspace(var.scanner_version)) > 0
    error_message = "scanner_version is required."
  }
}

variable "oidc_issuer_url" {
  type = string
  validation {
    condition     = startswith(var.oidc_issuer_url, "https://")
    error_message = "oidc_issuer_url must be HTTPS."
  }
}

variable "oidc_jwks_uri" {
  type = string
  validation {
    condition     = startswith(var.oidc_jwks_uri, "https://")
    error_message = "oidc_jwks_uri must be HTTPS."
  }
}

variable "oidc_audience" {
  type = string
  validation {
    condition     = length(trimspace(var.oidc_audience)) > 0
    error_message = "oidc_audience is required."
  }
}

variable "alert_email" {
  type = string
  validation {
    condition     = can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", var.alert_email))
    error_message = "alert_email must be a monitored email address."
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
