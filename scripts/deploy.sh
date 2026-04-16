#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${REGION:-asia-northeast3}"
ARTIFACT_REPOSITORY="${ARTIFACT_REPOSITORY:-nikke-containers}"
IMAGE_NAME="${IMAGE_NAME:-nikke-search-api}"
SERVICE_NAME="${SERVICE_NAME:-nikke-search-api}"
DEPLOY_HOSTING="${DEPLOY_HOSTING:-1}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "PROJECT_ID is empty. Run 'gcloud config set project <project-id>' or set PROJECT_ID explicitly."
  exit 1
fi

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPOSITORY}/${IMAGE_NAME}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1"
    exit 1
  fi
}

require_command npm
require_command gcloud
require_command firebase

echo "==> Deploy configuration"
echo "PROJECT_ID=$PROJECT_ID"
echo "REGION=$REGION"
echo "ARTIFACT_REPOSITORY=$ARTIFACT_REPOSITORY"
echo "IMAGE_NAME=$IMAGE_NAME"
echo "SERVICE_NAME=$SERVICE_NAME"
echo "DEPLOY_HOSTING=$DEPLOY_HOSTING"
echo

echo "==> Building frontend and search assets"
npm run build

if [[ ! -f "public/search-index.json" ]]; then
  echo "Missing public/search-index.json after build."
  exit 1
fi

echo "==> Building and pushing search API image"
gcloud builds submit \
  --region="$REGION" \
  --config cloudbuild.search-api.yaml \
  --substitutions="_IMAGE=${IMAGE_URI}" \
  .

echo "==> Deploying Cloud Run service"
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE_URI" \
  --region "$REGION" \
  --allow-unauthenticated \
  --cpu 1 \
  --memory 512Mi \
  --min-instances 0 \
  --max-instances 3

if [[ "$DEPLOY_HOSTING" == "1" ]]; then
  echo "==> Deploying Firebase Hosting"
  firebase deploy --only hosting
else
  echo "==> Skipping Firebase Hosting deploy because DEPLOY_HOSTING=$DEPLOY_HOSTING"
fi

echo
echo "Deployment completed."
