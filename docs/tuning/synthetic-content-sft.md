# Webind synthetic content SFT

Date: 2026-08-28

## Why this exists

Webind does not require proprietary customer writing data to bootstrap its content writer. The initial supervised-tuning corpus is generated from fictional briefs, public empirical/official guidance, and Webind's auditable quantitative evaluator.

This is a bootstrap dataset, not proof of a universal ranking formula. The research registry in `src/lib/content/research.ts` records each behavior, source, scope, evidence strength, and review date.

## Architecture

1. `buildSyntheticBriefs` creates deterministic fictional briefs across page type, industry, intent, audience, evidence density, and YMYL/ordinary slices.
2. Base Gemini 3.7 Flash generates multiple candidates with MEDIUM thinking.
3. An independent judge checks factual grounding, usefulness, intent fit, and extractability. Claude is preferred when configured; otherwise a separate Gemini judge prompt is used.
4. `scoreContentQuality` supplies the Webind algorithmic signal. It is intentionally only 30% of the composite selection score.
5. Candidates hard-fail for unsupported claims, low usefulness/intent fit, keyword repetition, or a very low Webind content score.
6. The highest-scoring passing candidate becomes the SFT target.
7. A stable hash splits accepted examples into train, validation, and a locked benchmark. The locked benchmark is never sent to Vertex for training.
8. Every accepted row gets a provenance record containing the research version, source principle IDs, teacher/judge models, quality dimensions, judge output, and slice metadata.

## Build the corpus

```bash
npm run tuning:synthetic -- --count=500 --candidates=4 --out=tuning/synthetic-v1
```

A production-sized first run should normally target at least 500 accepted examples; 2,000 requested briefs with four candidates each provides substantially more slice coverage if budget allows.

Outputs:

- `train.jsonl` — Vertex SFT training rows.
- `validation.jsonl` — Vertex validation rows.
- `locked-benchmark.jsonl` — offline evaluation only; never upload as training data.
- `provenance.jsonl` — audit trail for every accepted example.
- `rejected-briefs.json` — briefs for which no candidate passed all gates.
- `manifest.json` — counts and split metadata.

Generated `/tuning/` output is gitignored.

## Submit Gemini 3.5 Flash SFT

Google currently lists Gemini 3.5 Flash as supporting supervised fine-tuning. The checked-in submit script follows the Vertex `tuningJobs.create` REST shape.

Prerequisites:

```bash
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable aiplatform.googleapis.com storage.googleapis.com
```

Then:

```bash
PROJECT_ID=YOUR_PROJECT_ID \
GCS_BUCKET=YOUR_BUCKET_NAME \
npm run tuning:submit
```

Defaults:

- base model: `gemini-3.5-flash`
- region: `us-central1`
- epochs: `2`
- learning-rate multiplier: `1.0`
- display name: `webind-seo-writer-v1`

The script uploads only `train.jsonl` and `validation.jsonl`. It deliberately does not upload the locked benchmark.

## Runtime wiring: Developer API vs Vertex

The existing Webind Gemini integration uses `GEMINI_API_KEY` with the Gemini Developer API. That remains the base Gemini 3.7 path for conversational planning and the untuned fallback.

A supervised-tuned Gemini 3.5 model created by Vertex is served through a Vertex endpoint and must **not** be addressed by merely swapping a model ID into the API-key client. The app therefore has a separate runtime adapter:

- `GEMINI_API_KEY` -> Gemini Developer API -> base Gemini 3.7 planner / fallback.
- `CONTENT_WRITER_VERTEX_ENDPOINT` -> Vertex AI -> tuned Gemini writer.
- Vertex authentication -> Application Default Credentials, such as workload identity, an attached service account, or `GOOGLE_APPLICATION_CREDENTIALS`.

After the tuning job reaches `JOB_STATE_SUCCEEDED`, fetch the job and copy its exact `tunedModel.endpoint`, for example:

```text
projects/123456789012/locations/us-central1/endpoints/123456789012345
```

Set that value as:

```bash
CONTENT_WRITER_VERTEX_ENDPOINT=projects/123456789012/locations/us-central1/endpoints/123456789012345
```

When that variable is absent, Content Studio keeps using the current 3.7 API-key path. When it is present, only the final content writer is routed through Vertex; the conversational planner remains on the base 3.7 Developer API path.

The Vertex tuned writer intentionally does not attach live Google Search grounding. Its factual universe is the supplied writing brief, matching the SFT corpus and reducing the risk that inference-time retrieval breaks the grounding contract.

## Promotion

Do not set `CONTENT_WRITER_VERTEX_ENDPOINT` merely because tuning completed. Compare the tuned 3.5 model against base 3.7 and base 3.5 on the locked benchmark.

Promotion requires:

- no unsupported-claim regression;
- no critical page-type/risk slice regression;
- higher or equal blinded usefulness;
- improved composite/algorithmic quality without keyword-stuffing regressions;
- acceptable latency, failure rate, and cost;
- a limited real-world canary before broad rollout.

For tuned Gemini 3+ inference, Webind defaults the Vertex writer to MINIMAL thinking. The untuned Gemini 3.7 planner remains MEDIUM thinking.

## Scientific limits

Public GEO evidence is heterogeneous and platform-dependent. Webind therefore distinguishes official guidance, systematic reviews, and experimental findings and avoids teaching unsupported rules such as fixed word counts, required AI-specific chunking, universal citation-density targets, or llms.txt as a Google ranking requirement.

The synthetic corpus is meant to encode robust writing behavior: relevance, completeness, grounding, useful organization, differentiated information, clear evidence scope, and natural terminology. Future measured Webind visibility outcomes can recalibrate the evaluator, but they are not required to bootstrap v1.
