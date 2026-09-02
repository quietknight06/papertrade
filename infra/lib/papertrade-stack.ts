import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export class PaperTradeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, "Table", {
      tableName: "PaperTrade",
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    table.addGlobalSecondaryIndex({
      indexName: "OpenOrders",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const orderDeadLetterQueue = new sqs.Queue(this, "OrderDeadLetterQueue", {
      queueName: "papertrade-order-events-dlq",
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    const orderQueue = new sqs.Queue(this, "OrderQueue", {
      queueName: "papertrade-order-events",
      receiveMessageWaitTime: cdk.Duration.seconds(20),
      visibilityTimeout: cdk.Duration.seconds(30),
      retentionPeriod: cdk.Duration.days(4),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: { queue: orderDeadLetterQueue, maxReceiveCount: 5 },
    });

    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "papertrade-users",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const userPoolClient = userPool.addClient("BrowserClient", {
      userPoolClientName: "papertrade-browser",
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ noncurrentVersionExpiration: cdk.Duration.days(30) }],
    });
    const artifactBucket = new s3.Bucket(this, "ArtifactBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const apiLogGroup = new logs.LogGroup(this, "ApiLogGroup", {
      logGroupName: "/aws/lambda/papertrade-api",
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const apiFunction = new lambdaNode.NodejsFunction(this, "ApiFunction", {
      functionName: "papertrade-api",
      entry: path.join(__dirname, "../../backend/api/handler.js"),
      projectRoot: path.join(__dirname, "../.."),
      depsLockFilePath: path.join(__dirname, "../../backend/package-lock.json"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      logGroup: apiLogGroup,
      environment: {
        TABLE_NAME: table.tableName,
        ORDER_QUEUE_URL: orderQueue.queueUrl,
        ALPACA_PARAMETER: "/papertrade/prod/alpaca-credentials",
      },
      bundling: { minify: true, sourceMap: true, target: "node22", bundleAwsSDK: true },
    });
    table.grantReadWriteData(apiFunction);
    orderQueue.grantSendMessages(apiFunction);
    apiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["ssm:GetParameter"],
      resources: [`arn:${cdk.Aws.PARTITION}:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter/papertrade/prod/alpaca-credentials`],
    }));

    const httpApi = new apigwv2.CfnApi(this, "HttpApi", {
      name: "papertrade-http-api",
      protocolType: "HTTP",
      corsConfiguration: {
        allowHeaders: ["authorization", "content-type"],
        allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
        allowOrigins: ["*"],
        maxAge: 300,
      },
    });
    const integration = new apigwv2.CfnIntegration(this, "ApiIntegration", {
      apiId: httpApi.ref,
      integrationType: "AWS_PROXY",
      integrationUri: apiFunction.functionArn,
      integrationMethod: "POST",
      payloadFormatVersion: "2.0",
      timeoutInMillis: 10000,
    });
    const authorizer = new apigwv2.CfnAuthorizer(this, "JwtAuthorizer", {
      apiId: httpApi.ref,
      authorizerType: "JWT",
      identitySource: ["$request.header.Authorization"],
      name: "papertrade-cognito",
      jwtConfiguration: {
        audience: [userPoolClient.userPoolClientId],
        issuer: `https://cognito-idp.${this.region}.${cdk.Aws.URL_SUFFIX}/${userPool.userPoolId}`,
      },
    });
    new apigwv2.CfnRoute(this, "HealthRoute", {
      apiId: httpApi.ref,
      routeKey: "GET /api/health",
      authorizationType: "NONE",
      target: `integrations/${integration.ref}`,
    });
    new apigwv2.CfnRoute(this, "ApiRoute", {
      apiId: httpApi.ref,
      routeKey: "ANY /api/{proxy+}",
      authorizationType: "JWT",
      authorizerId: authorizer.ref,
      target: `integrations/${integration.ref}`,
    });
    new apigwv2.CfnStage(this, "DefaultStage", {
      apiId: httpApi.ref,
      stageName: "$default",
      autoDeploy: true,
    });
    apiFunction.addPermission("AllowApiGateway", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      sourceArn: `arn:${cdk.Aws.PARTITION}:execute-api:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:${httpApi.ref}/*`,
    });

    const apiDomain = cdk.Fn.select(2, cdk.Fn.split("/", httpApi.attrApiEndpoint));
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(siteBucket);
    const spaRewrite = new cloudfront.Function(this, "SpaRewrite", {
      functionName: "papertrade-spa-rewrite",
      code: cloudfront.FunctionCode.fromInline(`function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri !== '/' && uri.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}`),
    });
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        functionAssociations: [{
          function: spaRewrite,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        }],
      },
      additionalBehaviors: {
        "api/*": {
          origin: new origins.HttpOrigin(apiDomain, { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY }),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          compress: true,
        },
        "predictions/*": {
          origin: s3Origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: new cloudfront.CachePolicy(this, "PredictionCachePolicy", {
            cachePolicyName: `papertrade-predictions-${this.account}`,
            minTtl: cdk.Duration.seconds(0),
            defaultTtl: cdk.Duration.minutes(5),
            maxTtl: cdk.Duration.minutes(5),
            enableAcceptEncodingBrotli: true,
            enableAcceptEncodingGzip: true,
          }),
          compress: true,
        },
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    const modelVersion = this.node.tryGetContext("modelVersion") || "current";
    const scheduleEnabled = String(this.node.tryGetContext("enableSchedule") || "false") === "true";
    const predictionLogGroup = new logs.LogGroup(this, "PredictionLogGroup", {
      logGroupName: "/aws/lambda/papertrade-daily-predictions",
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const predictionFunction = new lambda.DockerImageFunction(this, "PredictionFunction", {
      functionName: "papertrade-daily-predictions",
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, "../../ml"), { file: "lambda/Dockerfile" }),
      architecture: lambda.Architecture.X86_64,
      memorySize: 2048,
      timeout: cdk.Duration.minutes(10),
      ephemeralStorageSize: cdk.Size.gibibytes(1),
      reservedConcurrentExecutions: 1,
      logGroup: predictionLogGroup,
      environment: {
        SITE_BUCKET: siteBucket.bucketName,
        PREDICTION_KEY: "predictions/latest.json",
        ARTIFACT_BUCKET: artifactBucket.bucketName,
        MODEL_VERSION: modelVersion,
        MODEL_PREFIX: `models/${modelVersion}`,
        TIINGO_PARAMETER: "/papertrade/prod/tiingo-api-key",
        ML_ROOT: "/tmp/papertrade",
        RAW_DATA_DIR: "/tmp/papertrade/data/raw",
        MODEL_DIR: "/tmp/papertrade/models",
      },
    });
    artifactBucket.grantRead(predictionFunction, `models/${modelVersion}/*`);
    siteBucket.grantReadWrite(predictionFunction, "predictions/*");
    predictionFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["ssm:GetParameter"],
      resources: [`arn:${cdk.Aws.PARTITION}:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter/papertrade/prod/tiingo-api-key`],
    }));

    const schedulerRole = new iam.Role(this, "SchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
    });
    predictionFunction.grantInvoke(schedulerRole);
    new scheduler.CfnSchedule(this, "PredictionSchedule", {
      name: "papertrade-daily-predictions",
      description: "Generate forecasts after US market close on weekdays",
      scheduleExpression: "cron(30 18 ? * MON-FRI *)",
      scheduleExpressionTimezone: "America/New_York",
      flexibleTimeWindow: { mode: "FLEXIBLE", maximumWindowInMinutes: 15 },
      state: scheduleEnabled ? "ENABLED" : "DISABLED",
      target: {
        arn: predictionFunction.functionArn,
        roleArn: schedulerRole.roleArn,
        retryPolicy: { maximumEventAgeInSeconds: 7200, maximumRetryAttempts: 2 },
      },
    });

    const collectorUser = new iam.User(this, "CollectorUser", { userName: "papertrade-collector" });
    table.grantReadWriteData(collectorUser);
    orderQueue.grantConsumeMessages(collectorUser);

    new cdk.CfnOutput(this, "CloudFrontUrl", { value: `https://${distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new cdk.CfnOutput(this, "WebsiteBucket", { value: siteBucket.bucketName });
    new cdk.CfnOutput(this, "ArtifactBucketName", { value: artifactBucket.bucketName });
    new cdk.CfnOutput(this, "ApiUrl", { value: httpApi.attrApiEndpoint });
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "TableName", { value: table.tableName });
    new cdk.CfnOutput(this, "OrderQueueUrl", { value: orderQueue.queueUrl });
    new cdk.CfnOutput(this, "CollectorUserName", { value: collectorUser.userName });
  }
}
