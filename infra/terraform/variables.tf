variable "acknowledge_reference_architecture" {
  type        = bool
  default     = false
  description = "Safety interlock: this reference architecture cannot be planned/applied unless an approved operator explicitly sets this true after completing the runbook."
}

variable "aws_region" {
  type = string
}

variable "stage" {
  type = string
  validation {
    condition     = contains(["staging", "production"], var.stage)
    error_message = "stage must be staging or production."
  }
}

variable "vpc_id" {
  type        = string
  description = "TODO: approved pre-existing VPC ID; networking is intentionally not provisioned by this template."
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "database_subnet_ids" {
  type = list(string)
}

variable "container_image" {
  type        = string
  description = "TODO: immutable, approved API image digest (for example, registry/repository@sha256:...)."
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.container_image))
    error_message = "container_image must be an immutable sha256 image digest."
  }
}

variable "api_certificate_arn" {
  type        = string
  description = "TODO: ACM certificate ARN approved for the API load balancer."
  default     = null
}

variable "alert_email" {
  type        = string
  description = "TODO: approved on-call email or replace with an incident-management integration."
  default     = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
