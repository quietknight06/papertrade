# AWS hybrid deployment

This deployment keeps browser and account operations serverless while using one
small Lightsail instance for the persistent Alpaca market-data connection.

## Resources

- CloudFront and a private S3 bucket serve `frontend/dist` and daily forecasts.
- API Gateway HTTP API validates Cognito access tokens and invokes `backend/api/handler.js`.
- DynamoDB stores profiles, holdings, orders, and throttled current quotes.
- SQS sends new orders to the Lightsail collector.
- The collector matches orders from live Alpaca events and flushes quotes every five seconds.
- EventBridge invokes the containerized prediction Lambda at 6:30 PM New York time on weekdays.
- A separate private S3 bucket stores versioned `.joblib` model artifacts.

## Prerequisites

Install Node.js 22, Docker Desktop, AWS CLI v2, and Git. Configure an AWS
administrator identity through IAM Identity Center and select `ca-central-1`.
Do not deploy with the AWS account root user.

Create a zero-spend AWS Budget and a second monthly budget for USD 10 before
deploying anything.

## 1. Install and verify locally

```powershell
npm install
npm install --prefix backend
npm install --prefix collector
npm install --prefix frontend
npm install --prefix infra

npm test --prefix backend
npm run check --prefix collector
npm run lint --prefix frontend
npm run build --prefix frontend
npm run build --prefix infra
```

## 2. Bootstrap and deploy CDK

```powershell
$env:AWS_REGION = "ca-central-1"
$accountId = aws sts get-caller-identity --query Account --output text
Set-Location infra
npx cdk bootstrap "aws://$accountId/$env:AWS_REGION"
npx cdk deploy --all -c modelVersion=current -c enableSchedule=false
Set-Location ..
```

Save the CloudFormation outputs. They contain the website bucket, artifact
bucket, CloudFront distribution, Cognito IDs, table, queue, and collector IAM
user name.

The CDK stack intentionally retains the S3 buckets, DynamoDB table, and Cognito
pool if the stack is deleted. This prevents an accidental `cdk destroy` from
deleting user or model data.

## 3. Create runtime secrets

Create the parameters without placing their values in shell history. In the
AWS Systems Manager console, create these Standard `SecureString` parameters:

```text
/papertrade/prod/tiingo-api-key
  value: the Tiingo API key

/papertrade/prod/alpaca-credentials
  value: {"key":"...","secret":"...","tradingBaseUrl":"https://paper-api.alpaca.markets"}
```

The Lambda roles can read only their required parameter. The browser cannot
read either parameter.

## 4. Upload the trained model bundle

Replace `ARTIFACT_BUCKET` with the stack output. Model files are ignored by Git
and must be uploaded separately.

```powershell
aws s3 sync .\ml\models "s3://ARTIFACT_BUCKET/models/current" `
  --exclude "*" --include "*.joblib"
```

When promoting a new bundle, upload to a new immutable version such as
`models/2026-09-02` and deploy with `-c modelVersion=2026-09-02`.

## 5. Test the prediction job

Open Lambda, select `papertrade-daily-predictions`, and invoke it with `{}`.
Verify that `predictions/latest.json` appears in the website bucket and has six
ticker entries. Check CloudWatch logs for a `published` or `unchanged` result.

The EventBridge schedule is disabled by default. After this manual test passes,
enable it from `infra/` with
`npx cdk deploy -c modelVersion=current -c enableSchedule=true`.
The handler does not overwrite the last successful document when any ticker
fails.

## 6. Create the Lightsail instance

In Lightsail create an Ubuntu, dual-stack Linux instance in Canada Central:

```text
Name: papertrade-collector
Plan: 512 MB / USD 5 per month
Firewall: SSH from your IP only; no HTTP or HTTPS ports
```

The collector is outbound-only. It does not need a static IP unless your
operational policies require a stable address.

On the instance, install Node.js 22 and create its service account:

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin papertrade
sudo install -d -m 0750 -o root -g papertrade /etc/papertrade
```

In IAM, create one access key for the `papertrade-collector` user produced by
CDK. This user can access only the PaperTrade table and consume the order queue.
Store the key only in `/etc/papertrade/collector.env`, based on
`collector/.env.example`:

```bash
sudo chmod 0640 /etc/papertrade/collector.env
sudo chown root:papertrade /etc/papertrade/collector.env
```

Copy `collector/` to `/opt/papertrade/collector`, run `npm ci --omit=dev`, copy
the service file to `/etc/systemd/system`, and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now papertrade-collector
sudo journalctl -u papertrade-collector -f
```

Confirm `MARKET / QUOTE#AAPL` and the other default quote items appear in
DynamoDB. `updatedAt` should advance while the market is open.

## 7. Build and publish React

Create `frontend/.env` from the stack outputs:

```dotenv
VITE_AWS_REGION=ca-central-1
VITE_COGNITO_USER_POOL_ID=ca-central-1_REPLACE_ME
VITE_COGNITO_CLIENT_ID=REPLACE_ME
```

Then build and publish. Always exclude the Lambda-generated prediction prefix
from synchronization with `--delete`.

```powershell
npm run build --prefix frontend
aws s3 sync .\frontend\dist "s3://WEBSITE_BUCKET" --delete `
  --exclude "index.html" --exclude "predictions/*" `
  --cache-control "public,max-age=31536000,immutable"
aws s3 cp .\frontend\dist\index.html "s3://WEBSITE_BUCKET/index.html" `
  --content-type "text/html" --cache-control "no-cache"
aws cloudfront create-invalidation --distribution-id DISTRIBUTION_ID --paths "/index.html"
```

Enroll the distribution in CloudFront's Free plan in the AWS console if the
account is eligible and the plan is not automatically selected.

The distribution sends `/api/*` to API Gateway with caching disabled and sends
all other requests to private S3. A viewer-request function rewrites
extensionless React routes to `/index.html`; global 403/404 error rewriting is
deliberately avoided so API authorization failures keep their real status code.

## 8. Configure GitHub Actions

Add GitHub's OIDC provider to IAM and create a deployment role whose trust
policy restricts `token.actions.githubusercontent.com:sub` to this repository
and the `production` GitHub environment. Grant the role access to the CDK
bootstrap roles and the website deployment resources.

Create these GitHub environment values:

```text
Secret: AWS_DEPLOY_ROLE_ARN
Variable: MODEL_VERSION=current
Variable: ENABLE_PREDICTION_SCHEDULE=false
```

The main workflow deploys CDK and React without permanent AWS keys. The
collector workflow is manual and additionally requires:

```text
COLLECTOR_HOST
COLLECTOR_USER
COLLECTOR_SSH_KEY
```

Install `collector/deploy-papertrade-collector` as
`/usr/local/sbin/deploy-papertrade-collector`, owned by root, and allow the
deployment user to execute only that command through sudo.

## Estimated monthly cost

For roughly 500 ten-minute dashboard sessions, six default tickers, five-second
quote persistence, and one daily prediction run:

| Service | Expected monthly cost |
| --- | ---: |
| Lightsail collector | $5.00 |
| DynamoDB | $0.40-$0.90 |
| API Gateway HTTP API | $0.10-$0.25 |
| S3, CloudFront, Lambda, Cognito, SQS, EventBridge, SSM | $0-$0.30 |
| CloudWatch and ECR | $0-$0.50 |
| **Expected total before tax** | **$5.50-$7.00** |

Writing every Alpaca event directly to DynamoDB can increase the bill by tens
of dollars. Keep `QUOTE_FLUSH_MS` at 5000 or higher. A Route 53 hosted zone adds
about $0.50 per month, and upgrading Lightsail to 1 GB adds $2 per month.

## Production checks

- Sign up, confirm the email, sign in, refresh the browser, and sign out.
- Confirm protected API routes reject missing and expired tokens.
- Deposit and withdraw funds, including an insufficient-funds withdrawal.
- Submit buy and sell orders and confirm exactly one fill occurs.
- Restart the collector and verify that it reloads open orders.
- Confirm quote writes remain near one write per symbol every five seconds.
- Confirm a failed prediction run leaves the previous JSON available.
- Set finite CloudWatch log retention and enable AWS Budget notifications.
