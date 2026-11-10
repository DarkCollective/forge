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

output "distribution_id" {
  description = "CloudFront distribution id (GitHub variable FORGE_DISTRIBUTION_ID)."
  value       = aws_cloudfront_distribution.site.id
}

output "distribution_domain" {
  description = "The distribution's cloudfront.net domain."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "bucket_name" {
  description = "Site bucket (GitHub variable FORGE_BUCKET)."
  value       = aws_s3_bucket.site.id
}

output "deploy_role_arn" {
  description = "Deploy role (GitHub variable FORGE_DEPLOY_ROLE_ARN)."
  value       = aws_iam_role.deploy.arn
}
