# PaperTrade

[![Deploy AWS application](https://github.com/quietknight06/papertrade/actions/workflows/deploy.yml/badge.svg)](https://github.com/quietknight06/papertrade/actions/workflows/deploy.yml)

PaperTrade is a full-stack stock-market simulator for practising trades with simulated money. It combines authenticated accounts, live and on-demand Alpaca market data, portfolio and order management, and experimental machine-learning forecasts in a responsive React application.

**Live application:** [https://d1zslde5jcr8ez.cloudfront.net](https://d1zslde5jcr8ez.cloudfront.net)

> PaperTrade is an educational portfolio project. It does not execute real trades, accept money, or provide financial advice.

![PaperTrade dashboard](frontend/public/media/images/papertradedashboard.png)

## Features

- Create and verify an account through Amazon Cognito.
- Search active, tradable U.S. equities from Alpaca.
- View Alpaca IEX quotes for default, searched, held, and ordered symbols.
- Add or withdraw simulated buying power.
- Submit simulated whole-share limit buy and sell orders.
- Match open orders against streamed bid, ask, and trade events.
- Review balances, holdings, allocation, profit and loss, and order history.
- Explore daily price and direction forecasts for six supported tickers.
- Preserve account and market state in DynamoDB.
- Deploy reproducibly through AWS CDK and GitHub Actions OIDC.

## Cloud architecture

```text
                                      EventBridge Scheduler
                                               |
                                               v
React ----> CloudFront ----> private S3 <---- Prediction Lambda container
  |              |                                |             |
  |              | /api/*                        Tiingo         S3 models
  |              v
  |       API Gateway HTTP API
  |              |
  |       Cognito JWT authorizer
  |              |
  |              v
  +--------> Node.js Lambda --------> DynamoDB <-------- Lightsail collector
                  |                     ^   ^                    |
                  |                     |   |                    |
                  +----> Alpaca REST    |   +------ SQS --------+
                                        |                       |
                                        +---- Alpaca WebSocket <-+
```

The browser and account API are serverless. A small Lightsail instance maintains the persistent Alpaca WebSocket, flushes quotes to DynamoDB, consumes order events from SQS, and reconciles open orders after restarts. The API Lambda retrieves an on-demand Alpaca snapshot when a requested quote is missing or stale.

Forecasts are calculated once after market close instead of loading the model bundle for every visitor. The scheduled Lambda publishes one cacheable `predictions/latest.json` document for the frontend.

### Architecture rationale

I designed this system after earning the AWS Certified Solutions Architect – Associate (SAA-C03) certification. The production architecture is intentionally serverless for bursty, low-volume portfolio traffic: CloudFront, S3, API Gateway, Lambda, Cognito, DynamoDB, SQS, and EventBridge scale automatically and charge primarily by use. Lightsail is the deliberate exception because the Alpaca market-data WebSocket requires a continuously running client; a small fixed-price instance is simpler and more economical here than an always-on container platform. The local Express and MongoDB implementation remains available for development, while the production AWS API entry point lives in `backend/api`.

### AWS services

| Concern | Service |
| --- | --- |
| React hosting and CDN | S3 + CloudFront |
| Authentication | Amazon Cognito |
| HTTP API | API Gateway HTTP API + Node.js Lambda |
| Accounts, holdings, orders, quotes | DynamoDB |
| Persistent Alpaca connection | Lightsail + systemd |
| Order notifications | SQS with a dead-letter queue |
| Daily forecasts | EventBridge Scheduler + Lambda container |
| Model artifacts | S3 + ECR |
| Runtime credentials | SSM Parameter Store `SecureString` values |
| Infrastructure as code | AWS CDK in TypeScript |
| Continuous deployment | GitHub Actions + AWS OIDC |
| Logs | CloudWatch Logs and the Lightsail system journal |

At portfolio traffic, the expected AWS cost is approximately **USD $5.50–$7 per month**, dominated by the Lightsail instance. Actual charges vary by region, traffic, storage, logging, and AWS pricing changes.

For the complete AWS procedure, see [AWS_DEPLOYMENT.md](AWS_DEPLOYMENT.md).

### Request and data flows

The production application separates browser traffic, transactional state, streaming work, and batch inference so each path can scale and fail independently.

#### Authentication and account requests

1. The browser signs up or signs in directly with Cognito through AWS Amplify.
2. Cognito returns short-lived JWTs; passwords never pass through the application API.
3. React sends the access token in the `Authorization` header on `/api/*` requests.
4. API Gateway validates the token issuer and browser-client audience before invoking protected routes.
5. The Lambda derives the application user key from the immutable Cognito `sub` claim and reads or updates that user's DynamoDB items.

`GET /api/health` is intentionally public. All account, balance, holding, quote, asset, and order routes require an authenticated subject.

#### Quotes and symbol search

1. The collector authenticates to Alpaca and subscribes to trades, quotes, and bars for the six default symbols.
2. It adds symbols referenced by holdings or open orders and reconnects with exponential backoff if the socket closes.
3. Incoming events are coalesced in memory and flushed to DynamoDB every five seconds rather than writing every market event.
4. React polls the API for the symbols visible to the current user.
5. The API reads quote items in one DynamoDB batch. If a requested item is missing or more than 15 seconds old, it makes one batched Alpaca snapshot request and caches the result in DynamoDB.
6. Asset search loads Alpaca's tradable U.S. equity catalog into a warm Lambda cache for six hours. Exact ticker matches rank ahead of ticker prefixes and company-name substrings.

This hybrid approach preserves a genuine WebSocket ingestion path while keeping arbitrary symbol lookup functional without subscribing to the entire U.S. market.

#### Simulated order lifecycle

1. The API validates the symbol, positive whole-share quantity, limit price, and side.
2. Sell orders verify that the user owns enough shares; every order also requires a current Alpaca quote.
3. The API persists an `OPEN` order and publishes an `UPSERT` event to SQS.
4. The collector consumes the event, adds the symbol to its WebSocket subscription, and compares the limit with the current ask for buys or bid for sells.
5. A DynamoDB transaction atomically marks the order `FILLED`, adjusts cash, and updates the holding.
6. Conditional expressions prevent duplicate fills, overspending, and selling shares that are no longer available.
7. If an SQS notification is delayed or lost, the collector scans and reconciles open orders every minute.

SQS delivery is at least once, so correctness does not rely on receiving an event only once. DynamoDB conditions make repeat processing safe.

### DynamoDB single-table design

Production state lives in one on-demand table named `PaperTrade` with partition key `PK`, sort key `SK`, and a sparse `OpenOrders` global secondary index.

| Entity | Partition key | Sort key | Purpose |
| --- | --- | --- | --- |
| Profile | `USER#<cognito-sub>` | `PROFILE` | Display name, email, and simulated cash |
| Holding | `USER#<cognito-sub>` | `HOLDING#<symbol>` | Quantity and aggregate cost basis |
| Order | `USER#<cognito-sub>` | `ORDER#<timestamp>#<uuid>` | Side, quantity, limit, state, and fill data |
| Quote | `MARKET` | `QUOTE#<symbol>` | Latest trade, bid, ask, previous close, and timestamp |

Open orders additionally receive `GSI1PK=OPEN#<symbol>` and a time-ordered `GSI1SK`. Those attributes are removed when an order is filled or rejected, keeping the index sparse. Quote items receive a seven-day `expiresAt` value for DynamoDB TTL cleanup.

On-demand billing avoids idle provisioned-capacity charges. The five-second collector flush interval deliberately trades a small amount of freshness for dramatically fewer write requests.

## Containers and runtime packaging

The project uses a Docker image for daily ML inference, but not for the React application, API Lambda, or Lightsail collector.

### Prediction Lambda image

`ml/lambda/Dockerfile` starts from AWS's managed Python 3.12 Lambda base image:

```dockerfile
FROM public.ecr.aws/lambda/python:3.12

COPY requirements-runtime.txt ${LAMBDA_TASK_ROOT}/requirements.txt
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

COPY src/ ${LAMBDA_TASK_ROOT}/
COPY lambda/lambda_handler.py ${LAMBDA_TASK_ROOT}/lambda_handler.py

CMD ["lambda_handler.handler"]
```

The image packages Python, NumPy, pandas, scikit-learn, joblib, the feature code, and the Lambda handler into a reproducible runtime. CDK builds the image as an asset, publishes it to the bootstrap ECR repository, and points the Lambda function at the resulting immutable image digest.

Trained `.joblib` files and historical CSV data are deliberately excluded from the image by `.dockerignore`. Models are versioned independently under `s3://<artifact-bucket>/models/<model-version>/`, allowing a model release to change without redesigning the runtime image. At invocation time, the function downloads the selected bundle into Lambda's `/tmp` storage and reuses matching files when a warm execution environment survives.

The function runs on x86-64 with 2 GB of memory, a ten-minute timeout, and 1 GB of ephemeral storage. This is intentionally separate from Lightsail: the instance handles the long-lived WebSocket, while the container exists only for bounded daily inference.

### Other deployment units

- The production Node.js API is bundled and minified by CDK/esbuild for the Lambda Node.js 22 ARM64 runtime.
- React is compiled into static, content-hashed assets and served from S3 through CloudFront; it does not require a web-server container.
- The collector is a small Node.js systemd service on Ubuntu. Its deployment archive contains application code and its lockfile, while secrets remain in `/etc/papertrade/collector.env` and are never included in the archive.

This packaging strategy avoids paying for an always-running application container when Lambda and static hosting are sufficient, while still using a persistent process where a WebSocket actually requires one.

## Reliability and scaling characteristics

- API Gateway, Lambda, Cognito, DynamoDB, S3, CloudFront, SQS, and EventBridge scale without pre-provisioned application servers.
- CloudFront caches immutable frontend assets for one year, serves `index.html` with `no-cache`, and caches predictions for five minutes.
- A CloudFront viewer-request function maps extensionless React routes to `/index.html` without rewriting API authorization errors.
- The API behavior has caching disabled, so authenticated responses are not shared between users.
- The collector uses systemd `Restart=always`, waits for networking, and reconnects to Alpaca with a delay that grows from one to 30 seconds.
- SQS long polling reduces empty receives. Messages that fail repeatedly move to a 14-day dead-letter queue after five receives.
- The collector reloads holdings and open orders every minute, so process restarts do not permanently lose subscription or order state.
- Prediction publishing is fail-safe: all six tickers must share one `asOf` date, JSON must contain no `NaN`, and a failed run leaves the last successful document untouched.
- If the market-data date and model version are unchanged, the prediction job returns `unchanged` instead of rewriting S3.
- S3 website, artifact, DynamoDB, and Cognito resources use retain-on-delete policies to reduce the risk of accidental data loss during stack changes.

The main non-serverless scaling boundary is the single 512 MB Lightsail collector. That is a conscious cost choice for portfolio traffic, not an active/active production design. A higher-scale version could partition symbols across collectors and introduce a managed stream, but Kinesis alone would not replace the process that owns the external Alpaca socket.

## Technology stack

| Layer | Technologies |
| --- | --- |
| Frontend | React 19, React Router, Vite, AWS Amplify Auth, CSS |
| Production API | Node.js 22, API Gateway, Lambda |
| Authentication | Amazon Cognito User Pools, JWT authorization |
| Persistence | DynamoDB |
| Streaming collector | Node.js, `ws`, AWS SDK, Lightsail, systemd |
| Market data | Alpaca REST API and IEX WebSocket stream |
| Historical data | Tiingo end-of-day API |
| Machine learning | Python, pandas, NumPy, scikit-learn, joblib |
| Infrastructure | AWS CDK, TypeScript, CloudFormation |
| CI/CD | GitHub Actions, AWS OIDC |

## Repository layout

```text
papertrade/
|-- .github/workflows/       AWS and collector deployment workflows
|-- backend/
|   |-- api/                 Production Lambda handler and tests
|   |-- model/               Local Express/MongoDB models
|   `-- index.js             Local development API
|-- collector/               Alpaca WebSocket and order-matching service
|-- frontend/                React/Vite application
|-- infra/                   AWS CDK application
|-- ml/
|   |-- lambda/              Prediction Lambda container
|   |-- src/                 Data, feature, training, and inference code
|   |-- tests/               Feature-engineering tests
|   |-- data/                Ignored local datasets
|   `-- models/              Ignored trained model bundles
|-- AWS_DEPLOYMENT.md        Detailed AWS deployment guide
`-- README.md
```

The retired top-level `dashboard/` implementation is not part of the active build.

## Prerequisites

For local development:

- Node.js 22 and npm
- Python 3 with `venv` and `pip` for ML work
- An Alpaca paper-trading account
- A Tiingo API key for data downloads and model training
- Optionally, MongoDB Atlas for persistent local Express storage

For AWS deployment, also install:

- AWS CLI v2
- Docker Desktop
- AWS CDK dependencies from `infra/package-lock.json`
- GitHub CLI if you want to administer repository settings from the terminal

## Install

From the repository root:

```powershell
npm ci
npm ci --prefix backend
npm ci --prefix collector
npm ci --prefix frontend
npm ci --prefix infra
```

## Local development

The local development command starts the Express API and Vite together. It does not emulate Cognito, API Gateway, Lambda, DynamoDB, or SQS.

Create `backend/.env`:

```dotenv
MONGODB_URI=mongodb+srv://YOUR_CONNECTION_STRING

ALPACA_API_KEY=YOUR_ALPACA_PAPER_KEY
ALPACA_API_SECRET=YOUR_ALPACA_PAPER_SECRET
ALPACA_TRADING_BASE_URL=https://paper-api.alpaca.markets
ALPACA_DATA_BASE_URL=https://data.alpaca.markets
ALPACA_DATA_FEED=iex

CLIENT_URL=http://localhost:5173
PORT=3002
```

Never place Alpaca, Tiingo, AWS, or database credentials in a `VITE_*` variable. Vite variables are compiled into browser-visible JavaScript.

Start the application:

```powershell
npm run dev --prefix frontend
```

Open [http://localhost:5173](http://localhost:5173).

Useful commands:

```powershell
npm test --prefix backend
npm run check --prefix collector
npm run lint --prefix frontend
npm run build --prefix frontend
npm run build --prefix infra
```

Run every JavaScript check with:

```powershell
npm run verify
```

## Production frontend configuration

Production authentication requires only public Cognito identifiers in `frontend/.env`:

```dotenv
VITE_AWS_REGION=ca-central-1
VITE_COGNITO_USER_POOL_ID=YOUR_USER_POOL_ID
VITE_COGNITO_CLIENT_ID=YOUR_BROWSER_CLIENT_ID
```

No API URL is required. The frontend calls same-origin `/api/*` routes, which CloudFront forwards to API Gateway.

The file is ignored by Git. A sanitized template is available at `frontend/.env.example`.

## Machine-learning pipeline

Forecasts are supported for:

```text
AAPL, MSFT, NVDA, AMZN, GOOGL, TSLA
```

SPY and QQQ provide broad-market context but do not receive their own prediction models.

Create the environment and install dependencies:

```powershell
Set-Location .\ml
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Create `ml/.env`:

```dotenv
TIINGO_API_KEY=YOUR_TIINGO_KEY
```

Download and train:

```powershell
python src\download_data.py
python src\train.py
python src\train_direction.py
```

Pilot one ticker and horizon:

```powershell
python src\train_direction.py --ticker AAPL --horizon 5
```

Run local inference:

```powershell
python src\predict.py AAPL
python src\predict_direction.py AAPL
python src\predict_direction.py AAPL --horizon 5
```

### Methodology

PaperTrade treats training and serving as separate lifecycle stages. Training is an explicit offline operation on a developer machine; the public website cannot start a training job. Only evaluated artifacts are uploaded for scheduled inference.

#### Model families

The bundle contains 24 fitted Random Forest artifacts:

- Six next-day return regressors, one for each supported ticker.
- Eighteen direction classifiers: six tickers multiplied by 1-, 5-, and 20-trading-day horizons.

The regression model uses 300 trees, a minimum leaf size of 10, a fixed random seed, and parallel training. It predicts a next-day log return, which the presentation layer translates into an estimated price. Its evaluation reports model mean absolute error, a zero-return baseline MAE, and directional accuracy.

Each direction classifier also uses 300 trees and a minimum leaf size of 10, with bootstrapping, balanced-subsample class weights, and an out-of-bag score retained as a secondary diagnostic. The primary output is the probability that the adjusted close will be higher at the selected horizon. Evaluation reports accuracy, balanced accuracy, precision, recall, specificity, ROC-AUC where defined, Brier score, and majority-class baseline accuracy.

#### Features

All inputs are calculated from information available at or before the prediction timestamp. They include:

- 1-, 5-, and 20-session returns
- Rolling volatility and volume change
- Relative recent performance against SPY and QQQ
- Causal exponential smoothing with `alpha=0.2`
- 14-session RSI
- 14-session stochastic oscillator
- 14-session Williams %R
- MACD, signal, and histogram
- 10-session price rate of change
- On-balance volume

SPY and QQQ are contextual inputs rather than prediction targets. This gives each stock model broad-market and technology-sector context without pretending that the six equities are independent of market regime.

#### Time-series validation

Random train/test splitting would leak future market regimes into earlier training periods, so both pipelines preserve chronology:

1. The newest 20% of labeled observations is held back as a final unseen evaluation set.
2. The older 80% is evaluated through five expanding walk-forward folds.
3. A gap separates training from validation. The return model uses a one-session gap; each direction model uses a gap equal to its forecast horizon.
4. Metrics and date ranges are stored alongside the fitted estimator in the `.joblib` artifact.
5. Only after validation is complete is the deployable estimator refit on all labeled observations.

The horizon-sized gap is important: a 20-day training label depends on a price 20 sessions in the future, so the purge prevents that future price from overlapping the first validation observations. Unit tests also verify that changing future rows cannot alter past direction features.

#### Artifact promotion and inference

Model files are ignored by Git and uploaded to an immutable or named S3 prefix such as `models/current` or `models/2026-09-02`. The CDK `modelVersion` context selects the prefix exposed to Lambda. A release can therefore be validated, uploaded under a new version, deployed, and rolled back by changing the version rather than overwriting source history.

The scheduled inference sequence is:

```text
EventBridge (weekday, 18:30 America/New_York)
    -> Lambda pulls the selected S3 model bundle
    -> Lambda decrypts the Tiingo key from SSM
    -> Tiingo data is refreshed for six stocks plus SPY and QQQ
    -> all predictions are generated and checked for one aligned as-of date
    -> predictions/latest.json is atomically replaced in the private site bucket
    -> CloudFront serves the shared document with a five-minute TTL
```

The scheduler permits a flexible 15-minute delivery window and retries twice while the event is younger than two hours. Because the inputs are end-of-day data, computing once per trading day produces the same user-visible result as per-request inference at a fraction of the cost.

This is a compact MLOps pipeline rather than a full model registry: it provides reproducible containerized inference, versioned artifacts, evaluation metadata, scheduled execution, guarded publication, and rollback-friendly versions, while intentionally keeping retraining manual.

For further details, see [ml/README.md](ml/README.md).

## Tests

Run the JavaScript suite:

```powershell
npm run verify
```

Run the Python feature tests:

```powershell
.\ml\.venv\Scripts\python.exe -m unittest discover -s ml\tests -p "test_*.py" -v
```

The backend tests cover monetary conversion, Cognito subject-based keys, public/protected routing, exact ticker ranking, and quote-number selection. The ML tests check feature finiteness, target alignment, binary direction targets, forecast horizons, and protection against future-data leakage.

## Deployment

Infrastructure is declared in `infra/lib/papertrade-stack.ts` and synthesized by CDK into CloudFormation. This makes the AWS topology reviewable, repeatable, and recoverable instead of depending on undocumented console changes.

### Application CI/CD

The main workflow is `.github/workflows/deploy.yml`. It runs on every push to `main` and supports manual dispatch. A concurrency group serializes production runs so two commits cannot race while updating the same stack.

The pipeline:

1. Assumes a narrowly scoped AWS role through GitHub OIDC.
2. Checks out the exact commit and selects Node.js 22.
3. Restores npm download caching keyed by the four lockfiles.
4. Runs `npm ci` independently for the root, backend, collector, frontend, and infrastructure projects.
5. Executes backend tests, the collector syntax check, frontend linting, and CDK TypeScript compilation.
6. Builds and publishes CDK file and Docker-image assets through the bootstrapped publishing roles.
7. Deploys the stack with the configured `MODEL_VERSION` and `ENABLE_PREDICTION_SCHEDULE` environment values.
8. Reads bucket, distribution, and Cognito identifiers from CloudFormation rather than hard-coding generated resource names.
9. Builds React with those Cognito identifiers available only as non-secret build configuration.
10. Uploads hashed assets with a one-year immutable cache policy.
11. Uploads `index.html` separately with `no-cache` and invalidates that path in CloudFront.

The S3 synchronization explicitly excludes `predictions/*`. This prevents the frontend's `--delete` operation from removing the JSON document owned by the prediction Lambda.

GitHub receives `id-token: write` only so it can request an OIDC token. The AWS trust policy constrains the token audience and repository/environment subject, then exchanges it for temporary credentials. No permanent AWS access key is stored in GitHub.

### Collector delivery

The optional `.github/workflows/deploy-collector.yml` workflow deploys the Lightsail collector manually over SSH. For a small project, manual collector deployment with SSH limited to a known IP is safer than exposing port 22 to changing GitHub-hosted runner addresses.

When enabled, the workflow builds a small tar archive, uploads it with a dedicated SSH key, and invokes one root-owned deployment helper through a restricted sudo rule. The helper extracts the application under `/opt/papertrade`, restores production dependencies from `package-lock.json`, installs the systemd unit, and restarts the service. It never replaces the root-owned secret environment file.

### Deployment configuration

| GitHub environment value | Type | Purpose |
| --- | --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | Secret | OIDC-assumable AWS deployment role |
| `MODEL_VERSION` | Variable | S3 model prefix selected by CDK |
| `ENABLE_PREDICTION_SCHEDULE` | Variable | Enables or disables the EventBridge schedule |
| `COLLECTOR_HOST` | Optional secret | Lightsail address for manual collector delivery |
| `COLLECTOR_USER` | Optional secret | Restricted SSH deployment user |
| `COLLECTOR_SSH_KEY` | Optional secret | Dedicated deployment key, not an AWS credential |

The GitHub `production` environment can add branch restrictions and human approval gates. The IAM OIDC trust should be restricted to that exact repository and environment, including immutable owner and repository IDs where GitHub uses immutable subject claims.

### Rollout and rollback

- Application rollback: redeploy a known-good Git commit.
- Infrastructure rollback: CloudFormation automatically rolls back failed updates.
- Frontend rollback: S3 versioning retains earlier object versions, while Git-based redeployment remains the normal path.
- Model rollback: deploy CDK with the previous `MODEL_VERSION` prefix.
- Collector rollback: deploy an archive built from a known-good commit and verify the systemd journal.
- Data protection: the stateful buckets, table, and Cognito pool are retained when the stack is deleted or replaced.

## Security

Security is organized around four trust boundaries: the public browser, authenticated AWS APIs, the batch inference runtime, and the persistent collector host.

### Identity and API boundary

- Cognito self-sign-up requires a verified email and enforces the configured password policy.
- The browser client has no client secret because public JavaScript cannot keep one confidential.
- Access and ID tokens expire after one hour; refresh tokens expire after 30 days.
- API Gateway verifies the JWT issuer and Cognito client audience before protected Lambda invocation.
- The API uses the verified `sub` claim as the account identifier rather than trusting a user ID supplied in a request body.
- DynamoDB keys namespace every profile, holding, and order under that subject.
- Monetary values are stored as integer cents, reducing floating-point ambiguity in account updates.
- Conditional writes and transactions enforce balance, holding, and one-time-fill invariants at the database boundary.

The current HTTP API allows cross-origin requests at the API Gateway layer, but protected operations still require a valid Cognito JWT. A custom production domain should narrow the CORS allowlist to the final site origin.

### IAM and secret isolation

| Principal | Allowed access |
| --- | --- |
| API Lambda | Read/write PaperTrade data, send order messages, decrypt only the Alpaca parameter |
| Prediction Lambda | Read the selected model prefix, read/write only the prediction prefix, decrypt only the Tiingo parameter |
| EventBridge scheduler | Invoke only the prediction function |
| Lightsail collector user | Read/write the PaperTrade table and consume the order queue |
| GitHub deployment role | Assume the CDK publishing/deployment roles and publish the website |

Alpaca and Tiingo credentials are stored as SSM `SecureString` parameters for Lambda. The collector's AWS and Alpaca values live in `/etc/papertrade/collector.env`, owned by `root:papertrade` with mode `0640`. Provider keys never enter React, CloudFormation outputs, Docker layers, the collector archive, or Git history.

GitHub Actions uses OIDC federation and short-lived STS credentials. The trust relationship checks `aud=sts.amazonaws.com` and a repository-specific `sub` claim, preventing arbitrary repositories from assuming the deployment role.

The collector still uses one long-lived IAM access key because it runs outside the EC2 instance-profile model. That key is deliberately attached to a low-privilege IAM user, stored only on the instance, and should be rotated periodically.

### Network and host controls

- CloudFront is the public entry point; both S3 buckets block all public access.
- CloudFront reaches the site bucket through origin access control and redirects viewers to HTTPS.
- S3 enforces TLS and uses server-side encryption.
- The Lightsail collector is outbound-only and needs no HTTP or HTTPS listener.
- Its firewall should expose SSH only to a controlled source IP.
- The service runs as the non-login `papertrade` system user with `NoNewPrivileges` and a private temporary directory.
- The root-owned deployment script and restricted sudo entry prevent the deployment user from gaining unrestricted passwordless root access.

### Data protection and repository hygiene

- DynamoDB uses AWS-managed encryption and TTL cleanup for market quotes.
- SQS uses server-side encryption and isolates poison messages in a dead-letter queue.
- S3 versioning protects site and model objects from accidental overwrites.
- Stateful resources use retain-on-update-or-delete policies.
- Lambda log groups have finite two-week retention.
- `.gitignore` excludes `.env` files, private keys, credentials, local state, virtual environments, datasets, models, build output, and deployment artifacts.

If a credential is exposed, revoke and rotate it immediately. Removing it in a later commit does not remove it from Git history or third-party logs.

## Observability and operations

The project keeps operations intentionally lightweight:

- API and prediction functions write structured errors to separate CloudWatch log groups.
- The prediction handler logs `published` or `unchanged` with its date, model version, and output size.
- The collector logs startup, Alpaca socket errors, failed quote writes, queue failures, fills, and rejection conditions to the systemd journal.
- CloudFormation and GitHub Actions retain deployment history and expose failures by pipeline stage.
- SQS exposes queue depth and dead-letter count for stalled order processing.
- DynamoDB quote timestamps make collector freshness directly inspectable.
- AWS Budgets should alert before costs exceed the expected portfolio-project range.

Useful production checks:

```powershell
aws logs tail "/aws/lambda/papertrade-api" --since 30m --region ca-central-1
aws logs tail "/aws/lambda/papertrade-daily-predictions" --since 1d --region ca-central-1
aws scheduler get-schedule --name papertrade-daily-predictions --region ca-central-1
```

On Lightsail:

```bash
sudo systemctl is-enabled papertrade-collector
sudo systemctl is-active papertrade-collector
sudo journalctl -u papertrade-collector --since "30 minutes ago" --no-pager
```

For a higher-stakes deployment, the next observability step would be CloudWatch alarms for Lambda errors, dead-letter messages, stale quotes, and missing prediction publications, plus an external synthetic check of the CloudFront health route.

## Operational notes

- The Lightsail service must remain enabled and active for streaming quotes and order matching.
- EventBridge runs the prediction job after the U.S. market closes on weekdays.
- Prediction documents use a five-minute CloudFront cache.
- Quotes expire from DynamoDB after seven days through TTL.
- SQS retries failed order events and sends repeatedly failing messages to a dead-letter queue.
- Model training remains an intentional offline operation; visitors cannot trigger it.

## Limitations

- All balances, orders, fills, and holdings are simulated.
- The Alpaca IEX feed is not the complete consolidated U.S. market feed.
- The matching engine is educational and does not model exchange priority, partial fills, slippage, fees, or every market-session rule.
- On-demand quotes and asset availability depend on Alpaca account permissions and service availability.
- Forecasts cover six tickers and update from end-of-day data.
- Historical validation cannot guarantee future predictive performance.
- The CloudFront URL currently serves as the production domain.

## Disclaimer

Nothing in this repository is financial, investment, tax, or legal advice. Forecasts are experimental and may be inaccurate. Real investing involves risk, including loss of principal.

## Author

Created by **Vedant Venkat**.

[LinkedIn](https://www.linkedin.com/in/vedant-venkat-393b21252) · [GitHub](https://github.com/quietknight06)
