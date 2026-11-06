#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

load_env_file() {
  local file_path="$1"
  if [[ ! -f "$file_path" ]]; then
    return
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    if [[ -z "$line" || "$line" == \#* || "$line" != *=* ]]; then
      continue
    fi

    local key="${line%%=*}"
    local value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"

    if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ && -z "${!key:-}" ]]; then
      export "$key=$value"
    fi
  done < "$file_path"
}

load_env_file ".env.local"
load_env_file ".env"

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${REGION:-asia-northeast3}"
ARTIFACT_REPOSITORY="${ARTIFACT_REPOSITORY:-nikke-containers}"
IMAGE_NAME="${IMAGE_NAME:-nikke-search-api}"
SERVICE_NAME="${SERVICE_NAME:-nikke-search-api}"
DEPLOY_HOSTING="${DEPLOY_HOSTING:-1}"
RUN_MAX_INSTANCES="${RUN_MAX_INSTANCES:-1}"
GEMINI_SECRET_NAME="${GEMINI_SECRET_NAME:-nikke-gemini-api-key}"
SYNC_GEMINI_SECRET="${SYNC_GEMINI_SECRET:-1}"
SYNC_GEMINI_FILE_SEARCH="${SYNC_GEMINI_FILE_SEARCH:-1}"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.7-flash}"
GEMINI_FALLBACK_MODEL="${GEMINI_FALLBACK_MODEL:-gemini-3.5-flash-lite}"
RATE_LIMIT_WINDOW_MS="${RATE_LIMIT_WINDOW_MS:-60000}"
RATE_LIMIT_MAX_REQUESTS="${RATE_LIMIT_MAX_REQUESTS:-120}"
ASK_RATE_LIMIT_WINDOW_MS="${ASK_RATE_LIMIT_WINDOW_MS:-600000}"
ASK_RATE_LIMIT_MAX_REQUESTS="${ASK_RATE_LIMIT_MAX_REQUESTS:-10}"
ASK_GLOBAL_RATE_LIMIT_WINDOW_MS="${ASK_GLOBAL_RATE_LIMIT_WINDOW_MS:-60000}"
ASK_GLOBAL_RATE_LIMIT_MAX_REQUESTS="${ASK_GLOBAL_RATE_LIMIT_MAX_REQUESTS:-6}"
ASK_DAILY_LIMIT_WINDOW_MS="${ASK_DAILY_LIMIT_WINDOW_MS:-86400000}"
ASK_DAILY_LIMIT_MAX_REQUESTS="${ASK_DAILY_LIMIT_MAX_REQUESTS:-100}"
GEMINI_RETRY_COUNT="${GEMINI_RETRY_COUNT:-3}"
GEMINI_RETRY_INITIAL_DELAY_MS="${GEMINI_RETRY_INITIAL_DELAY_MS:-5000}"
GEMINI_RETRY_MAX_DELAY_MS="${GEMINI_RETRY_MAX_DELAY_MS:-60000}"
GEMINI_PROVIDER_COOLDOWN_MS="${GEMINI_PROVIDER_COOLDOWN_MS:-60000}"
GEMINI_COUNT_TOKENS_BEFORE_REQUEST="${GEMINI_COUNT_TOKENS_BEFORE_REQUEST:-0}"
ASK_LOG_STORAGE="${ASK_LOG_STORAGE:-firestore}"
ASK_LOG_PROJECT_ID="${ASK_LOG_PROJECT_ID:-$PROJECT_ID}"
ASK_LOG_DATABASE_ID="${ASK_LOG_DATABASE_ID:-(default)}"
ASK_LOG_COLLECTION="${ASK_LOG_COLLECTION:-aiAskLogs}"
ASK_LOG_DEFAULT_STATUS="${ASK_LOG_DEFAULT_STATUS:-pending_review}"
ASK_LOG_INCLUDE_PROMPT="${ASK_LOG_INCLUDE_PROMPT:-1}"
ASK_LOG_INCLUDE_ANSWER="${ASK_LOG_INCLUDE_ANSWER:-1}"
ASK_LOG_WRITE_TIMEOUT_MS="${ASK_LOG_WRITE_TIMEOUT_MS:-3000}"
SYNC_FIRESTORE_IAM="${SYNC_FIRESTORE_IAM:-1}"
EFFECTIVE_GEMINI_API_KEY=""

is_usable_gemini_api_key() {
  local candidate="${1:-}"
  [[ -n "$candidate" && "$candidate" != "PLACEHOLDER_API_KEY" && "$candidate" != *YOUR_* ]]
}

select_gemini_api_key() {
  if is_usable_gemini_api_key "${GEMINI_API_KEY:-}"; then
    EFFECTIVE_GEMINI_API_KEY="$GEMINI_API_KEY"
    return
  fi

  if is_usable_gemini_api_key "${GOOGLE_API_KEY:-}"; then
    EFFECTIVE_GEMINI_API_KEY="$GOOGLE_API_KEY"
    return
  fi

  local candidate
  local key_list="${GEMINI_API_KEYS:-}"
  key_list="${key_list//,/ }"
  for candidate in $key_list; do
    if is_usable_gemini_api_key "$candidate"; then
      EFFECTIVE_GEMINI_API_KEY="$candidate"
      return
    fi
  done

  local index
  for index in {1..10}; do
    local key_name="GEMINI_API_KEY_${index}"
    candidate="${!key_name:-}"
    if is_usable_gemini_api_key "$candidate"; then
      EFFECTIVE_GEMINI_API_KEY="$candidate"
      return
    fi
  done
}

select_gemini_api_key

resolve_run_service_account() {
  if [[ -n "${RUN_SERVICE_ACCOUNT:-}" ]]; then
    return
  fi

  RUN_SERVICE_ACCOUNT="$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --project="$PROJECT_ID" --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null || true)"
  if [[ -z "$RUN_SERVICE_ACCOUNT" ]]; then
    PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)' 2>/dev/null || true)"
    if [[ -n "$PROJECT_NUMBER" ]]; then
      RUN_SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
    fi
  fi
}

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

if [[ "$SYNC_GEMINI_FILE_SEARCH" != "0" && "$SYNC_GEMINI_FILE_SEARCH" != "1" ]]; then
  echo "SYNC_GEMINI_FILE_SEARCH must be 0 or 1. Received: $SYNC_GEMINI_FILE_SEARCH"
  exit 1
fi

if [[ -z "${GEMINI_FILE_SEARCH_STORE:-}" ]]; then
  echo "GEMINI_FILE_SEARCH_STORE is empty. Set it in .env.local or the environment before deploy."
  exit 1
fi

if [[ ( "$SYNC_GEMINI_SECRET" == "1" || "$SYNC_GEMINI_FILE_SEARCH" == "1" ) && -z "$EFFECTIVE_GEMINI_API_KEY" ]]; then
  echo "Gemini API key is empty. Set GEMINI_API_KEY, GOOGLE_API_KEY, GEMINI_API_KEYS, or GEMINI_API_KEY_1 in .env.local."
  echo "File Search sync and Secret Manager sync can be skipped separately with SYNC_GEMINI_FILE_SEARCH=0 and SYNC_GEMINI_SECRET=0."
  exit 1
fi

echo "==> Deploy configuration"
echo "PROJECT_ID=$PROJECT_ID"
echo "REGION=$REGION"
echo "ARTIFACT_REPOSITORY=$ARTIFACT_REPOSITORY"
echo "IMAGE_NAME=$IMAGE_NAME"
echo "SERVICE_NAME=$SERVICE_NAME"
echo "DEPLOY_HOSTING=$DEPLOY_HOSTING"
echo "RUN_MAX_INSTANCES=$RUN_MAX_INSTANCES"
echo "GEMINI_MODEL=$GEMINI_MODEL"
echo "GEMINI_FALLBACK_MODEL=$GEMINI_FALLBACK_MODEL"
echo "GEMINI_FILE_SEARCH_STORE=${GEMINI_FILE_SEARCH_STORE}"
echo "GEMINI_SECRET_NAME=$GEMINI_SECRET_NAME"
echo "SYNC_GEMINI_SECRET=$SYNC_GEMINI_SECRET"
echo "SYNC_GEMINI_FILE_SEARCH=$SYNC_GEMINI_FILE_SEARCH"
echo "ASK_LOG_STORAGE=$ASK_LOG_STORAGE"
echo "ASK_LOG_PROJECT_ID=$ASK_LOG_PROJECT_ID"
echo "ASK_LOG_COLLECTION=$ASK_LOG_COLLECTION"
echo

echo "==> Building frontend and search assets"
npm run build

if [[ ! -f "public/search-index.json" ]]; then
  echo "Missing public/search-index.json after build."
  exit 1
fi

if [[ "$SYNC_GEMINI_FILE_SEARCH" == "1" ]]; then
  echo "==> Syncing Gemini File Search documents"
  npm run gemini:file-search:sync
else
  echo "==> Skipping Gemini File Search sync because SYNC_GEMINI_FILE_SEARCH=$SYNC_GEMINI_FILE_SEARCH"
fi

echo "==> Building and pushing search API image"
gcloud builds submit \
  --region="$REGION" \
  --config cloudbuild.search-api.yaml \
  --substitutions="_IMAGE=${IMAGE_URI}" \
  .

if [[ "$SYNC_GEMINI_SECRET" == "1" ]]; then
  echo "==> Syncing Gemini API key to Secret Manager"
  if ! gcloud secrets describe "$GEMINI_SECRET_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
    gcloud secrets create "$GEMINI_SECRET_NAME" \
      --project="$PROJECT_ID" \
      --replication-policy="automatic"
  fi

  printf '%s' "$EFFECTIVE_GEMINI_API_KEY" | gcloud secrets versions add "$GEMINI_SECRET_NAME" \
    --project="$PROJECT_ID" \
    --data-file=-

  resolve_run_service_account

  if [[ -n "$RUN_SERVICE_ACCOUNT" ]]; then
    gcloud secrets add-iam-policy-binding "$GEMINI_SECRET_NAME" \
      --project="$PROJECT_ID" \
      --member="serviceAccount:${RUN_SERVICE_ACCOUNT}" \
      --role="roles/secretmanager.secretAccessor" >/dev/null
  else
    echo "Could not resolve Cloud Run service account. Grant Secret Manager access manually if the service cannot read the secret."
  fi
fi

if [[ "$ASK_LOG_STORAGE" == "firestore" && "$SYNC_FIRESTORE_IAM" == "1" ]]; then
  echo "==> Granting Firestore access for ask logs"
  resolve_run_service_account
  if [[ -n "${RUN_SERVICE_ACCOUNT:-}" ]]; then
    if ! gcloud projects add-iam-policy-binding "$ASK_LOG_PROJECT_ID" \
      --member="serviceAccount:${RUN_SERVICE_ACCOUNT}" \
      --role="roles/datastore.user" >/dev/null; then
      echo "Could not grant Firestore access automatically. Grant roles/datastore.user to ${RUN_SERVICE_ACCOUNT} manually if ask logs fail."
    fi
  else
    echo "Could not resolve Cloud Run service account. Grant Firestore access manually if ask logs fail."
  fi
fi

echo "==> Deploying Cloud Run service"
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE_URI" \
  --region "$REGION" \
  --allow-unauthenticated \
  --cpu 1 \
  --memory 512Mi \
  --min-instances 0 \
  --max-instances "$RUN_MAX_INSTANCES" \
  --set-env-vars="GEMINI_FILE_SEARCH_STORE=${GEMINI_FILE_SEARCH_STORE},GEMINI_MODEL=${GEMINI_MODEL},GEMINI_FALLBACK_MODEL=${GEMINI_FALLBACK_MODEL},RATE_LIMIT_WINDOW_MS=${RATE_LIMIT_WINDOW_MS},RATE_LIMIT_MAX_REQUESTS=${RATE_LIMIT_MAX_REQUESTS},ASK_RATE_LIMIT_WINDOW_MS=${ASK_RATE_LIMIT_WINDOW_MS},ASK_RATE_LIMIT_MAX_REQUESTS=${ASK_RATE_LIMIT_MAX_REQUESTS},ASK_GLOBAL_RATE_LIMIT_WINDOW_MS=${ASK_GLOBAL_RATE_LIMIT_WINDOW_MS},ASK_GLOBAL_RATE_LIMIT_MAX_REQUESTS=${ASK_GLOBAL_RATE_LIMIT_MAX_REQUESTS},ASK_DAILY_LIMIT_WINDOW_MS=${ASK_DAILY_LIMIT_WINDOW_MS},ASK_DAILY_LIMIT_MAX_REQUESTS=${ASK_DAILY_LIMIT_MAX_REQUESTS},GEMINI_RETRY_COUNT=${GEMINI_RETRY_COUNT},GEMINI_RETRY_INITIAL_DELAY_MS=${GEMINI_RETRY_INITIAL_DELAY_MS},GEMINI_RETRY_MAX_DELAY_MS=${GEMINI_RETRY_MAX_DELAY_MS},GEMINI_PROVIDER_COOLDOWN_MS=${GEMINI_PROVIDER_COOLDOWN_MS},GEMINI_COUNT_TOKENS_BEFORE_REQUEST=${GEMINI_COUNT_TOKENS_BEFORE_REQUEST},ASK_LOG_STORAGE=${ASK_LOG_STORAGE},ASK_LOG_PROJECT_ID=${ASK_LOG_PROJECT_ID},ASK_LOG_DATABASE_ID=${ASK_LOG_DATABASE_ID},ASK_LOG_COLLECTION=${ASK_LOG_COLLECTION},ASK_LOG_DEFAULT_STATUS=${ASK_LOG_DEFAULT_STATUS},ASK_LOG_INCLUDE_PROMPT=${ASK_LOG_INCLUDE_PROMPT},ASK_LOG_INCLUDE_ANSWER=${ASK_LOG_INCLUDE_ANSWER},ASK_LOG_WRITE_TIMEOUT_MS=${ASK_LOG_WRITE_TIMEOUT_MS}" \
  --set-secrets="GEMINI_API_KEY=${GEMINI_SECRET_NAME}:latest"

if [[ "$DEPLOY_HOSTING" == "1" ]]; then
  echo "==> Deploying Firebase Hosting"
  firebase deploy --only hosting
else
  echo "==> Skipping Firebase Hosting deploy because DEPLOY_HOSTING=$DEPLOY_HOSTING"
fi

echo
echo "Deployment completed."
