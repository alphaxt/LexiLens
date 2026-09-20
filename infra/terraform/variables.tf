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

variable "scanner_endpoint" {
  type = string
  validation {
    condition     = can(regex("^https://[^/]+/.+", var.scanner_endpoint))
    error_message = "scanner_endpoint must be an approved HTTPS scan endpoint including a path."
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
