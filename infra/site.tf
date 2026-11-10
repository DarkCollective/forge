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
# Shared, read-only: the Route 53 zone and the *.darkcollective.com certificate
# are owned by the Relix stack. Forge adds only its own alias records.
# ---------------------------------------------------------------------------
data "aws_route53_zone" "darkcollective" {
  name         = var.domain
  private_zone = false
}

data "aws_acm_certificate" "wildcard" {
  domain      = var.domain
  statuses    = ["ISSUED"]
  types       = ["AMAZON_ISSUED"]
  most_recent = true
}

# ---------------------------------------------------------------------------
# S3 bucket - the site origin
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "site" {
  bucket = var.site_bucket
  tags   = local.tags
}

# Versioning makes a bad deploy recoverable: the sync overwrites in place.
resource "aws_s3_bucket_versioning" "site" {
  bucket = aws_s3_bucket.site.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    id     = "expire-noncurrent-deploys"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.site]
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = false
  }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = jsonencode({
    Version = "2008-10-17"
    Id      = "PolicyForCloudFrontPrivateContent"
    Statement = [{
      Sid       = "AllowForgeDistribution"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.site.arn}/*"
      Condition = {
        StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.site.arn }
      }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.site]
}

# ---------------------------------------------------------------------------
# CloudFront Origin Access Control
# ---------------------------------------------------------------------------
resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "forge-darkcollective-com"
  description                       = "Forge site bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ---------------------------------------------------------------------------
# Response headers policies. The security headers are identical; the two
# policies differ only in Cache-Control.
#
# The CSP matches the app: scripts, workers and the wasm engine are same-origin,
# nothing is inline, and nothing may be framed, submitted or fetched elsewhere.
# ---------------------------------------------------------------------------
locals {
  csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

  permissions_policy = "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"

  response_headers_policies = {
    default = {
      name          = "forge-security-headers"
      comment       = "Forge pages and unhashed files: always revalidated"
      cache_control = "public, max-age=0, must-revalidate"
    }
    assets = {
      name          = "forge-headers-assets"
      comment       = "Forge content-hashed /assets/*: immutable"
      cache_control = "public, max-age=31536000, immutable"
    }
  }
}

resource "aws_cloudfront_response_headers_policy" "site" {
  for_each = local.response_headers_policies

  name    = each.value.name
  comment = each.value.comment

  custom_headers_config {
    items {
      header   = "Cache-Control"
      override = true
      value    = each.value.cache_control
    }
    items {
      header   = "Cross-Origin-Embedder-Policy"
      override = true
      value    = "require-corp"
    }
    items {
      header   = "Cross-Origin-Opener-Policy"
      override = true
      value    = "same-origin"
    }
    items {
      header   = "Cross-Origin-Resource-Policy"
      override = true
      value    = "same-origin"
    }
    items {
      header   = "Permissions-Policy"
      override = true
      value    = local.permissions_policy
    }
  }

  remove_headers_config {
    items {
      header = "Server"
    }
    items {
      header = "X-Amz-Id-2"
    }
    items {
      header = "X-Amz-Request-Id"
    }
    items {
      header = "X-Amz-Server-Side-Encryption"
    }
    items {
      header = "X-Amz-Version-Id"
    }
  }

  security_headers_config {
    frame_options {
      override     = true
      frame_option = "DENY"
    }
    referrer_policy {
      override        = true
      referrer_policy = "no-referrer"
    }
    content_type_options {
      override = true
    }
    content_security_policy {
      override                = true
      content_security_policy = local.csp
    }
    strict_transport_security {
      override                   = true
      include_subdomains         = true
      preload                    = true
      access_control_max_age_sec = 63072000
    }
  }
}

# ---------------------------------------------------------------------------
# CloudFront Function (viewer-request - directory index). Edit ./cf_function.js.
# ---------------------------------------------------------------------------
resource "aws_cloudfront_function" "index" {
  name    = "forge-resolve-index"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite /x/ and /x to /x/index.html"
  publish = true
  code    = file("${path.module}/cf_function.js")
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

# ---------------------------------------------------------------------------
# CloudFront Distribution
# ---------------------------------------------------------------------------
resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  http_version        = "http2and3"
  aliases             = [var.site_host]
  comment             = var.site_host

  origin {
    origin_id                = "forge-s3-origin"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id           = "forge-s3-origin"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    allowed_methods            = ["HEAD", "GET"]
    cached_methods             = ["HEAD", "GET"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site["default"].id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.index.arn
    }
  }

  # Vite's content-hashed output (entry chunks, lazy chunks, workers, wasm).
  # A name changes whenever its content does, so it is cached for a year.
  ordered_cache_behavior {
    path_pattern               = "/assets/*"
    target_origin_id           = "forge-s3-origin"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    allowed_methods            = ["HEAD", "GET"]
    cached_methods             = ["HEAD", "GET"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site["assets"].id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.index.arn
    }
  }

  # The origin is private with no s3:ListBucket, so S3 answers 403 for a key
  # that does not exist; both become a real 404.
  custom_error_response {
    error_caching_min_ttl = 0
    error_code            = 403
    response_code         = 404
    response_page_path    = "/404.html"
  }

  custom_error_response {
    error_caching_min_ttl = 0
    error_code            = 404
    response_code         = 404
    response_page_path    = "/404.html"
  }

  viewer_certificate {
    acm_certificate_arn      = data.aws_acm_certificate.wildcard.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = local.tags
}

# ---------------------------------------------------------------------------
# DNS - Forge's own alias records in the Relix-owned zone
# ---------------------------------------------------------------------------
resource "aws_route53_record" "site_a" {
  zone_id = data.aws_route53_zone.darkcollective.zone_id
  name    = var.site_host
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = local.cloudfront_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "site_aaaa" {
  zone_id = data.aws_route53_zone.darkcollective.zone_id
  name    = var.site_host
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = local.cloudfront_zone_id
    evaluate_target_health = false
  }
}
