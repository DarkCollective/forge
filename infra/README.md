# Forge hosting (infra)

Terraform for https://forge.darkcollective.com: a private S3 bucket behind
CloudFront, deployed from GitHub Actions. Design: `docs/PLAN.md` section 10.

## What it creates

- S3 bucket `forge-darkcollective-com`: private, versioned (noncurrent versions
  expire after 30 days), SSE-S3, public access blocked. The bucket policy lets
  only this CloudFront distribution read it.
- CloudFront distribution with Origin Access Control (sigv4, always), HTTP/2+3,
  IPv6, `PriceClass_100`, TLS 1.2 (2021 policy), 403/404 served as `/404.html`.
- A viewer-request function (`cf_function.js`) mapping `/about/` and `/about`
  to `/about/index.html`.
- Two response headers policies (`forge-security-headers`,
  `forge-headers-assets`): HSTS, COOP/COEP/CORP, the app CSP, and Cache-Control
  (`/assets/*` is immutable for a year, everything else revalidates).
- Route 53 A and AAAA alias records for `forge.darkcollective.com`.
- CloudFront access logs (standard logging v2) into
  `darkcollective-cloudfront-logs` under `forge/`.
- IAM role `forge-deploy`, assumable only by GitHub OIDC for
  `repo:DarkCollective/forge:ref:refs/heads/main`, with S3 access to the site
  bucket and CloudFront invalidation on this distribution only.

It does **not** own the `darkcollective.com` hosted zone, the `*.darkcollective.com`
certificate (us-east-1), the log bucket or the state bucket. Those belong to the
Relix stack (`relix/infra`) and are read through data sources.

## Prerequisites

- Terraform >= 1.10 and AWS credentials for the account that hosts the Relix stack.
- The Relix stack applied (zone, certificate, log bucket, state bucket exist).
- The GitHub OIDC provider: if the account already has
  `token.actions.githubusercontent.com` (check IAM, Identity providers) leave
  `create_github_oidc_provider` at its default `false`. If not, apply with
  `-var create_github_oidc_provider=true`. An account can hold only one.

## Apply

```sh
cd infra
terraform init
terraform plan
terraform apply          # or: terraform apply -var create_github_oidc_provider=true
```

## GitHub repository variables

Settings, Secrets and variables, Actions, Variables. No secrets are needed.

| Variable                | From output                             |
| ----------------------- | --------------------------------------- |
| `FORGE_DEPLOY_ROLE_ARN` | `terraform output -raw deploy_role_arn` |
| `FORGE_DISTRIBUTION_ID` | `terraform output -raw distribution_id` |
| `FORGE_BUCKET`          | `terraform output -raw bucket_name`     |

## First deploy

Merge to `main` (the Deploy workflow runs after CI succeeds), or run the Deploy
workflow manually from `main` via Actions, Deploy, Run workflow. It builds,
uploads hashed assets, then other files, then HTML (which also prunes files no
longer built), invalidates the changed keys, waits, and smoke-checks the headers.
Hashed assets are never deleted, so a still-cached page keeps working.

## Rollback

The bucket is versioned. To restore a previous deploy, either revert the
bad commit on `main` (the Deploy workflow redeploys), or restore object versions in S3
(copy the previous version of each changed object over the current one, for
example with `aws s3api copy-object --copy-source "bucket/key?versionId=..."`),
then invalidate `/*`. Noncurrent versions are kept for 30 days.
