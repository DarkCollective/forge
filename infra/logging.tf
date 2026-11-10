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

# ---------------------------------------------------------------------------
# CloudFront access logs - standard logging v2, mirroring the Relix stack.
#
# The log bucket is owned by Relix (relix/infra/logging.tf): ACLs disabled, and
# a bucket policy letting delivery.logs.amazonaws.com write for any delivery
# source in this account. So Forge needs no bucket change, only its own
# delivery source, destination and delivery, writing under the forge/ prefix.
# ---------------------------------------------------------------------------
data "aws_s3_bucket" "logs" {
  bucket = var.log_bucket
}

resource "aws_cloudwatch_log_delivery_source" "site" {
  name         = "forge-cloudfront-access-logs"
  log_type     = "ACCESS_LOGS"
  resource_arn = aws_cloudfront_distribution.site.arn
}

resource "aws_cloudwatch_log_delivery_destination" "site" {
  name          = "forge-cloudfront-logs-s3"
  output_format = "plain"

  delivery_destination_configuration {
    destination_resource_arn = "${data.aws_s3_bucket.logs.arn}/${var.log_prefix}"
  }
}

resource "aws_cloudwatch_log_delivery" "site" {
  delivery_source_name     = aws_cloudwatch_log_delivery_source.site.name
  delivery_destination_arn = aws_cloudwatch_log_delivery_destination.site.arn

  s3_delivery_configuration {
    suffix_path                 = "/{yyyy}/{MM}/{dd}"
    enable_hive_compatible_path = false
  }
}
