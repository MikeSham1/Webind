#!/usr/bin/env bash
set -euo pipefail

# Submit the generated Webind corpus to Vertex AI supervised fine-tuning.
# Required:
#   PROJECT_ID, GCS_BUCKET
# Optional:
#   REGION=us-central1
#   CORPUS_DIR=tuning/synthetic-v1
#   DISPLAY_NAME=webind-seo-writer-v1
#   EPOCH_COUNT=2
#   LEARNING_RATE_MULTIPLIER=1.0
#
# Prerequisites:
#   gcloud auth application-default login (or workload identity/service account)
#   gcloud services enable aiplatform.googleapis.com storage.googleapis.com

: "${PROJECT_ID:?Set PROJECT_ID}"
: "${GCS_BUCKET:?Set GCS_BUCKET, e.g. webind-gemini-tuning}"

REGION="${REGION:-us-central1}"
CORPUS_DIR="${CORPUS_DIR:-tuning/synthetic-v1}"
DISPLAY_NAME="${DISPLAY_NAME:-webind-seo-writer-v1}"
EPOCH_COUNT="${EPOCH_COUNT:-2}"
LEARNING_RATE_MULTIPLIER="${LEARNING_RATE_MULTIPLIER:-1.0}"
BASE_MODEL="gemini-3.5-flash"

TRAIN_FILE="${CORPUS_DIR}/train.jsonl"
VALIDATION_FILE="${CORPUS_DIR}/validation.jsonl"

[[ -s "${TRAIN_FILE}" ]] || { echo "Missing ${TRAIN_FILE}. Build the synthetic corpus first." >&2; exit 1; }
[[ -s "${VALIDATION_FILE}" ]] || { echo "Missing ${VALIDATION_FILE}. Build the synthetic corpus first." >&2; exit 1; }

gcloud storage buckets describe "gs://${GCS_BUCKET}" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://${GCS_BUCKET}" --location="${REGION}" --project="${PROJECT_ID}"

gcloud storage cp "${TRAIN_FILE}" "gs://${GCS_BUCKET}/webind-sft/train.jsonl"
gcloud storage cp "${VALIDATION_FILE}" "gs://${GCS_BUCKET}/webind-sft/validation.jsonl"

REQUEST_FILE="$(mktemp)"
trap 'rm -f "${REQUEST_FILE}"' EXIT

cat >"${REQUEST_FILE}" <<JSON
{
  "baseModel": "${BASE_MODEL}",
  "supervisedTuningSpec": {
    "trainingDatasetUri": "gs://${GCS_BUCKET}/webind-sft/train.jsonl",
    "validationDatasetUri": "gs://${GCS_BUCKET}/webind-sft/validation.jsonl",
    "hyperParameters": {
      "epochCount": ${EPOCH_COUNT},
      "learningRateMultiplier": ${LEARNING_RATE_MULTIPLIER}
    }
  },
  "tunedModelDisplayName": "${DISPLAY_NAME}"
}
JSON

echo "Submitting ${BASE_MODEL} SFT job in ${REGION}..."
curl --fail-with-body -sS \
  -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json; charset=utf-8" \
  "https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/tuningJobs" \
  --data-binary "@${REQUEST_FILE}"
echo
