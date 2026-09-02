#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { PaperTradeStack } from "../lib/papertrade-stack";

const app = new cdk.App();

new PaperTradeStack(app, "PaperTradeStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "ca-central-1",
  },
  description: "PaperTrade serverless API, website, authentication, data, and daily ML pipeline",
});
