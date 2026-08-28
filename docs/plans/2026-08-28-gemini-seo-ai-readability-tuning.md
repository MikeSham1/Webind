# Gemini SEO + AI-readability tuning plan

Date: 2026-08-28

## Decision

Use Gemini 3.5 Flash as the supervised fine-tuning base for the production content writer. Keep Gemini 3.7 Flash as the untuned default/teacher/fallback until a tuned endpoint passes the promotion gates.

Why:

- Google currently lists Gemini 3.5 Flash as supporting supervised fine-tuning.
- Gemini 3.7 Flash is not currently listed as a supervised-tuning base.
- Reinforcement learning fine-tuning on Gemini 3.5 Flash is a strong conceptual fit for Webind's quantitative reward, but Google's current Pre-GA terms limit it to testing/evaluation and prohibit commercial/production use.
- Therefore the production path is supervised fine-tuning plus quantitative curation/evaluation, not production RFT.

## Training objective

The writer should produce content that is simultaneously:

1. factually grounded in the supplied brief,
2. useful and complete for the human search intent,
3. semantically clear and easy to retrieve,
4. structured so answer engines can extract a passage without losing context,
5. evidence-aware without citation spam,
6. naturally optimized for relevant search terms without keyword stuffing,
7. appropriate to the page type.

The quantitative Webind readiness model is retained as a useful proxy, not treated as search-engine ground truth. The new `scoreContentQuality` evaluator mirrors only the dimensions a Markdown writer can influence, including substance, extractability, readability, evidence and intent fit. Site-level features such as robots access, rendering, schema, metadata and canonical tags remain in the crawler/readiness layer where they belong.

## Dataset strategy

Training data remains high precision rather than high volume.

- Curated seed examples teach the format and behavior.
- Collected examples are eligible only when a human approved them.
- If the human edited a draft before approval, the human final is the target.
- Rejected and pending drafts are never training targets.
- Locked evaluation examples must never enter training.
- Quantitative quality scores should be used to inspect, stratify and curate data, not to silently convert mediocre model output into labels.

As real data grows, sample across page types, industries, query intent, content length and risk classes instead of letting the most common customer use case dominate the tune.

## Quantitative evaluation

Compare base Gemini 3.7 Flash, base Gemini 3.5 Flash, and the tuned 3.5 endpoint on a locked holdout.

Required deterministic metrics:

- factual/unsupported-claim failures: zero tolerance for promotion,
- safety-gate block rate,
- content-quality score and each dimension,
- target-term stuffing warnings,
- originality overlap,
- page-type structural fit,
- fallback/error rate.

Required preference metrics:

- blinded human pairwise preference,
- task completion / usefulness,
- factual faithfulness,
- passage-level answerability and context independence.

Do not use BLEU or ROUGE as primary quality metrics for open-ended web writing.

## Real-world outcome loop

The strongest validation is measured behavior after publication, not an offline proxy. Feed aggregated post-publication outcomes back into evaluation and future data selection:

- Search Console impressions, clicks and query coverage where available,
- Webind Keyword Visibility / answer-engine surfacing outcomes,
- citation/mention coverage by query family,
- user approval/edit rate,
- downstream engagement or conversion metrics when the customer has them.

Use controlled before/after or matched-page tests when possible. Avoid attributing ranking changes to the writer alone when technical SEO, links, crawlability, freshness, competition and site authority also changed.

## Research basis

Implementation choices were checked against current Google Search and Gemini documentation plus peer-reviewed/preprint information-retrieval research.

Key conclusions:

- Google's current guidance emphasizes helpful, reliable, people-first and non-commodity content rather than content written to manipulate rankings.
- Google's generative-AI search guidance similarly emphasizes unique value and first-hand or differentiated information.
- Structured data helps search systems understand page meaning, but accurate and complete markup matters more than adding more properties for their own sake.
- GEO research shows that generative-engine visibility can be influenced by presentation and evidence strategies, but effects vary by domain. This argues for domain-aware evaluation rather than a universal content formula.
- The safest production tuning approach is supervised learning from high-quality human-approved targets, with Webind's quantitative algorithm used as a supplemental diagnostic and selection signal.

## Promotion rule

Do not set `CONTENT_WRITER_MODEL` to a tuned endpoint unless it:

1. has zero unsupported-claim regressions on the locked holdout,
2. beats or matches the current 3.7 writer on human pairwise usefulness,
3. improves the aggregate content-quality score without worsening any critical page-type slice,
4. passes existing content safety gates,
5. shows acceptable latency/cost/reliability,
6. survives a limited real-world canary before full rollout.

For tuned Gemini 3+ inference, default to `MINIMAL` thinking unless an evaluation demonstrates a better setting.
