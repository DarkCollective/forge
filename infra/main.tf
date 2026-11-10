# Copyright 2026 Darkcollective, LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# =============================================================================
# forge.darkcollective.com - Infrastructure as Code (Terraform)
#
# A private S3 bucket behind CloudFront (Origin Access Control), deployed from
# GitHub Actions through OIDC. The Route 53 zone, the wildcard ACM certificate
# and the access-log bucket belong to the Relix stack (relix/infra) and are only
# read here, through data sources.
#
#   main.tf      providers, variables, shared locals
#   site.tf      S3 origin, CloudFront, DNS alias records
#   logging.tf   CloudFront access logs (standard logging v2)
#   deploy.tf    the GitHub OIDC deploy role
#   outputs.tf
# =============================================================================

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
  required_version = ">= 1.10"

  # The state bucket is owned by the Relix stack. `use_lockfile` is S3-native
  # locking (Terraform 1.10+), so there is no DynamoDB table.
  backend "s3" {
    bucket       = "darkcollective-terraform-state"
    key          = "forge.darkcollective.com/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

# CloudFront requires its certificate in us-east-1 and everything else here is
# global or already lives there.
provider "aws" {
  region = "us-east-1"
}

variable "domain" {
  description = "The apex domain. Its Route 53 zone and wildcard certificate are owned by the Relix stack."
  type        = string
  default     = "darkcollective.com"
}

variable "site_host" {
  description = "The host the site is served from."
  type        = string
  default     = "forge.darkcollective.com"
}

variable "site_bucket" {
  description = "S3 bucket holding the built site."
  type        = string
  default     = "forge-darkcollective-com"
}

variable "log_bucket" {
  description = "Existing S3 bucket CloudFront access logs are delivered to (owned by the Relix stack)."
  type        = string
  default     = "darkcollective-cloudfront-logs"
}

variable "log_prefix" {
  description = "Key prefix for this site's access logs inside the log bucket."
  type        = string
  default     = "forge"
}

variable "github_repository" {
  description = "The GitHub repository allowed to assume the deploy role."
  type        = string
  default     = "DarkCollective/forge"
}

variable "github_oidc_sub_prefix" {
  description = "GitHub's immutable OIDC subject prefix for the repository, in the form owner@owner_id/repo@repo_id (for example repo:DarkCollective@157516510/forge@1451746198). Shown by `gh api repos/<owner>/<repo>/actions/oidc/customization/sub` as sub_claim_prefix. Unlike the name, it survives repo renames. The deploy role trusts tokens whose sub is this prefix plus the deploy ref."
  type        = string
  default     = "repo:DarkCollective@157516510/forge@1451746198"
}

variable "github_deploy_ref" {
  description = "The git ref allowed to assume the deploy role."
  type        = string
  default     = "refs/heads/main"
}

variable "create_github_oidc_provider" {
  description = "Create the account's token.actions.githubusercontent.com IAM OIDC provider. Leave false when the account already has one (only one per URL is allowed); the existing provider is then looked up by URL."
  type        = bool
  default     = false
}

locals {
  tags = {
    Site    = var.site_host
    project = "forge"
  }

  # CloudFront's own hosted zone, the same in every account and region.
  cloudfront_zone_id = "Z2FDTNDATAQYW2"
}
