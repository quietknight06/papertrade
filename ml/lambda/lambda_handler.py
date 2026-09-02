import json
import os
from datetime import datetime, timezone
from pathlib import Path

import boto3

from config import DOWNLOAD_TICKERS, MODEL_TICKERS, MODEL_DIR, RAW_DATA_DIR
from dashboard_predictions import build_dashboard_prediction
from download_data import download_ticker


s3 = boto3.client("s3")
ssm = boto3.client("ssm")


def download_models(bucket: str, prefix: str) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    paginator = s3.get_paginator("list_objects_v2")
    downloaded = 0
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix.rstrip("/") + "/"):
        for item in page.get("Contents", []):
            key = item["Key"]
            if not key.endswith(".joblib"):
                continue
            target = MODEL_DIR / Path(key).name
            if not target.exists() or target.stat().st_size != item["Size"]:
                s3.download_file(bucket, key, str(target))
            downloaded += 1
    if downloaded == 0:
        raise RuntimeError(f"No model files found at s3://{bucket}/{prefix}")


def download_market_data(api_key: str) -> None:
    RAW_DATA_DIR.mkdir(parents=True, exist_ok=True)
    for ticker in DOWNLOAD_TICKERS:
        frame = download_ticker(ticker, api_key)
        frame.to_csv(RAW_DATA_DIR / f"{ticker}.csv", index=False)


def current_document(bucket: str, key: str) -> dict:
    try:
        response = s3.get_object(Bucket=bucket, Key=key)
        return json.loads(response["Body"].read())
    except s3.exceptions.NoSuchKey:
        return {}
    except Exception as error:
        if getattr(error, "response", {}).get("Error", {}).get("Code") in {
            "NoSuchKey",
            "AccessDenied",
        }:
            return {}
        raise


def handler(_event, _context):
    site_bucket = os.environ["SITE_BUCKET"]
    prediction_key = os.getenv("PREDICTION_KEY", "predictions/latest.json")
    artifact_bucket = os.environ["ARTIFACT_BUCKET"]
    model_version = os.environ["MODEL_VERSION"]
    model_prefix = os.getenv("MODEL_PREFIX", f"models/{model_version}")
    parameter_name = os.environ["TIINGO_PARAMETER"]

    api_key = ssm.get_parameter(Name=parameter_name, WithDecryption=True)["Parameter"]["Value"].strip()
    if not api_key:
        raise RuntimeError(f"Parameter {parameter_name} is empty")

    download_models(artifact_bucket, model_prefix)
    download_market_data(api_key)
    predictions = {ticker: build_dashboard_prediction(ticker) for ticker in MODEL_TICKERS}
    as_of_dates = {prediction["asOf"] for prediction in predictions.values()}
    if len(as_of_dates) != 1:
        raise RuntimeError(f"Ticker data is not aligned: {sorted(as_of_dates)}")

    existing = current_document(site_bucket, prediction_key)
    as_of = next(iter(as_of_dates))
    if existing.get("asOf") == as_of and existing.get("modelVersion") == model_version:
        print(json.dumps({"status": "unchanged", "asOf": as_of, "modelVersion": model_version}))
        return {"status": "unchanged", "asOf": as_of, "modelVersion": model_version}

    document = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "asOf": as_of,
        "modelVersion": model_version,
        "predictions": predictions,
    }
    body = json.dumps(document, allow_nan=False, separators=(",", ":")).encode("utf-8")
    s3.put_object(
        Bucket=site_bucket,
        Key=prediction_key,
        Body=body,
        ContentType="application/json",
        CacheControl="public,max-age=300",
        ServerSideEncryption="AES256",
    )
    print(json.dumps({"status": "published", "asOf": as_of, "modelVersion": model_version, "bytes": len(body)}))
    return {"status": "published", "asOf": as_of, "modelVersion": model_version}
