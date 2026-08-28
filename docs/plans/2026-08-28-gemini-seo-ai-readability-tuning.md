# Gemini SEO + AI-readability tuning plan

Date: 2026-08-28

## Decision

Use Gemini 3.5 Flash as the supervised fine-tuning base for the production content writer. Keep Gemini 3.7 Flash as the untuned conversational planner, synthetic-data teacher, baseline, and fallback until a tuned endpoint passes the promotion gates.

Why:

- Google currently lists Gemini 3.5 Flash as supporting supervised fine-tuning.
- Gemini 3.7 Flash is not currently listed as a supervised-tuning base.
- Reinforcement learning fine-tuning on Gemini 3.5 Flash is a strong conceptual fit for Webind's quantitative reward, but Google's current Pre-GA terms limit it to testing/evaluation rather than the production path.
- Webind has no proprietary training corpus today, so v1 is bootstrapped with reproducible fictional briefs, public research constraints, best-of-N teacher generation, independent judging, and Webind's quantitative evaluator.
- The production path is therefore supervised fine-tuning plus multi-signal curation/evaluation, not production RFT and not waiting for customer data.

## Training objective

The writer should produce content that is simultaneously:

1. factually grounded in the supplied brief,
2. useful and complete for the human search intent,
3. semantically clear and easy to retrieve,
4. structured so an answer system can extract a passage without losing necessary context,
5. evidence-aware without citation spam,
6. naturally optimized for relevant terminology without keyword stuffing,
7. appropriate to the page type.

The quantitative Webind readiness model is retained as a useful proxy, not treated as search-engine ground truth. `scoreContentQuality` mirrors only the dimensions a Markdown writer can influence: substance, extractability, readability, evidence, and intent fit. Site-level features such as robots access, rendering, schema, metadata, canonical tags, and identity remain in the crawler/readiness layer where they belong.

## Evidence policy

The behavior policy is versioned in `src/lib/content/research.ts`. Every principle records its source, scope, evidence strength, and review date.

Use official search-platform guidance for claims about that platform. Use systematic reviews and experimental research for broader hypotheses, while preserving their limitations. Do not convert a correlational GEO finding into a universal ranking rule.

In particular, do not teach fixed word counts, required AI-specific chunk sizes, mandatory citation density, or formatting tricks as ranking laws. Google-specific guidance about `llms.txt` must not be generalized to every answer engine.

## Synthetic dataset strategy

The v1 training corpus does not require customer data.

1. Generate deterministic fictional briefs across page type, industry, intent, audience, evidence density, and ordinary/YMYL risk slices.
2. Give each brief an explicit set of fictional key facts. Those facts are the complete universe for business-specific factual claims.
3. Have pinned base Gemini 3.7 Flash generate multiple candidate pages with MEDIUM thinking through the existing `GEMINI_API_KEY` Developer API path.
4. Evaluate each candidate with a separate judge prompt for factual grounding, usefulness, intent fit, and extractability. Default to pinned Gemini 3.7 so the presence of an existing production `ANTHROPIC_API_KEY` cannot silently opt the offline workload into Claude. Use `TUNING_JUDGE_PROVIDER=anthropic` only as an explicit cross-vendor evaluation choice.
5. Score the same candidate with Webind's content-only quantitative evaluator.
6. Hard-reject unsupported claims, weak usefulness/intent fit, keyword-stuffing warnings, and very low Webind content scores.
7. Select the highest-scoring passing candidate as the supervised target.
8. Record provenance for every accepted target: research-policy version, principle IDs, teacher/judge models, slice metadata, judge result, and Webind quality dimensions.
9. Split accepted examples deterministically into train, validation, and a locked benchmark before tuning. The locked benchmark never enters the Vertex training job.

The current composite selector weights Webind's quantitative score at 30%, with the remainder coming from independent grounding/usefulness/intent/extractability judgments. The exact weights are implementation parameters to evaluate, not scientific constants.

Human-approved production examples can supplement later tuning rounds if they become available, but they are not a prerequisite for v1 and should not replace the locked synthetic benchmark.

## Corpus generation

Run:

```bash
npm run tuning:synthetic -- --count=500 --candidates=4 --out=tuning/synthetic-v1
```

The default build uses the existing `GEMINI_API_KEY`; Vertex credentials are not required until job submission. An existing `.env.local` does not need to be replaced or regenerated. Optional new variables use safe defaults when absent.

For broader first-run coverage, request 2,000 fictional briefs with four candidates each if generation budget permits. Generated files are build artifacts and are gitignored.

Outputs include Vertex-ready `train.jsonl` and `validation.jsonl`, a local-only `locked-benchmark.jsonl`, provenance, rejection records, and a manifest.

See `docs/tuning/synthetic-content-sft.md` for the executable workflow.

## Vertex tuning and runtime authentication

The checked-in `scripts/tuning/submit-vertex-sft.sh` uploads only train and validation JSONL and creates a Vertex supervised tuning job using Gemini 3.5 Flash.

Defaults are deliberately conservative for the first experiment: two epochs and a learning-rate multiplier of 1.0. Tune these only by validation/locked-benchmark results rather than assuming larger values are better.

The actual managed job requires a Google Cloud project, billing, Vertex permissions, a GCS bucket, and authenticated Google credentials. Those credentials are infrastructure inputs, not repository data and must never be committed.

The runtime has two intentionally separate Gemini transports:

- `GEMINI_API_KEY` stays on the Gemini Developer API and serves pinned base Gemini 3.7 planning, synthetic generation, and the untuned writer fallback.
- `CONTENT_WRITER_VERTEX_ENDPOINT` identifies the tuned model's `tunedModel.endpoint` and is served through Vertex AI using Application Default Credentials.

A Vertex-tuned endpoint must not be passed into the API-key-only 3.7 client. The app routes it through `src/lib/ai/vertex-gemini.ts` instead. Generic Fix Generator overrides such as `GEMINI_GENERATOR_MODEL` and `GEMINI_THINKING_LEVEL` retain their existing behavior for that subsystem but cannot silently change the Content Studio planner, synthetic teacher, or base writer fallback.

The final-drafting factual boundary is also consistent across transports: neither the 3.7 writer fallback nor the tuned Vertex writer attaches live search. Both are constrained to the explicit brief. Gemini Keyword Visibility remains separately Google-Search-grounded because that subsystem is measuring live answer-engine surfacing rather than drafting user content.

A tuned endpoint is an optional enhancement, not a new single point of failure. If its endpoint, ADC, quota, or network call fails, Content Studio retries the same draft on the existing Gemini 3.7 API-key provider before using the deterministic template.

## Quantitative evaluation

Compare base Gemini 3.7 Flash, base Gemini 3.5 Flash, and the tuned 3.5 endpoint on the locked holdout.

Required deterministic metrics:

- factual/unsupported-claim failures: zero tolerance for promotion,
- safety-gate block rate,
- content-quality score and each dimension,
- target-term stuffing warnings,
- originality overlap where a comparison text exists,
- page-type structural fit,
- fallback/error rate,
- slice results for page type, industry, evidence density, and YMYL risk.

Required preference metrics:

- blinded pairwise usefulness,
- task completion,
- factual faithfulness,
- passage-level answerability and context independence.

Do not use BLEU or ROUGE as primary quality metrics for open-ended web writing.

## Conversational planning

Base Gemini 3.7 Flash remains the pre-writing planner at MEDIUM thinking. It can discuss the user's goal and ask up to three material clarifying questions at a time. It should stop questioning when the brief is sufficient.

The grounded draft form remains the explicit factual boundary. Planning conversation can shape intent, audience, structure, differentiation, and questions to answer, but inferred information is not silently promoted into business facts.

The tuned Gemini 3.5 writer is the final drafting path and defaults to MINIMAL thinking at inference.

## Real-world outcome loop

The strongest later validation is measured behavior after publication, not an offline proxy. As outcomes become available, use them to recalibrate evaluation and future data selection:

- Search Console impressions, clicks, and query coverage where available,
- Webind Keyword Visibility / answer-engine surfacing outcomes,
- citation/mention coverage by query family,
- user approval/edit rate,
- downstream engagement or conversion metrics when available.

Use controlled before/after or matched-page tests when possible. Do not attribute ranking changes to the writer alone when technical SEO, links, crawlability, freshness, competition, or site authority also changed.

## Research basis

Implementation choices were checked against current Google Search and Gemini documentation plus information-retrieval / GEO research.

Key conclusions:

- Google's current guidance emphasizes helpful, reliable, people-first, differentiated content rather than material produced mainly to manipulate rankings.
- Core SEO and crawlability remain foundational to generative search visibility; there is no required special AI prose format.
- GEO findings are heterogeneous and stage-dependent. Topical relevance is more reproducible than generic formatting heuristics, and citation-oriented rewrites can sometimes damage retrieval.
- Synthetic instruction bootstrapping is useful when candidate generation is filtered, diverse, provenance-tracked, and evaluated on a held-out set.
- Webind's quantitative algorithm is valuable as a supplemental selection/evaluation signal, not as the sole training target or a claim about a hidden search-engine formula.

## Promotion rule

Do not set `CONTENT_WRITER_VERTEX_ENDPOINT` to a tuned endpoint unless it:

1. has zero unsupported-claim regression on the locked holdout,
2. beats or matches the current 3.7 writer on blinded usefulness,
3. improves aggregate quality without worsening a critical page-type or risk slice,
4. passes existing content safety gates,
5. shows acceptable latency, cost, and reliability,
6. survives a limited real-world canary before broad rollout.

For tuned Gemini 3+ inference, default to `MINIMAL` thinking unless evaluation demonstrates a better setting.
