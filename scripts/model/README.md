# Readiness model — training pipeline

The app ships a small trained neural net that predicts AI-readiness from a
page's structural features (`src/lib/model/`). There are two ways to train it,
and a path from the first to the second as real data accrues.

## 1. Distilled model (what ships today)

Trained to imitate **Claude's judgment** of AI-citability. Honest but not
ground truth — it inherits Claude's reasoning, not measured outcomes.

```bash
npx tsx scripts/model/generate-dataset.ts   # seeded synthetic corpus → dataset.jsonl
npx tsx scripts/model/train.ts              # → src/lib/model/model.json (version distill-*)
```

- `teacher.ts` (in `src/lib/model/`) encodes the citability judgment, including
  the non-linear crawl gates a linear scorer can't express.
- Both scripts are deterministic (fixed seeds); re-running reproduces the same
  weights (only the `generatedAt` timestamp changes).
- `dataset.jsonl` is committed (reproducible, no private data).

## 2. Real-outcome model (the calibrated goal)

Trained on **measured AI-surfacing outcomes**: every Keyword Visibility run is
persisted (`visibility_outcomes`), recording whether an answer engine actually
surfaced the brand. Once enough have accrued:

```bash
DATABASE_URL=... npx tsx scripts/model/export-real-dataset.ts   # DB outcomes + crawl → real-dataset.jsonl
npx tsx scripts/model/train-real.ts                             # → src/lib/model/model.json (version real-*)
git add src/lib/model/model.json && git commit                  # promote it (the app scores with it)
```

- **Export** groups outcomes by domain, takes a coverage-weighted measured
  score as the label, crawls each domain once for its current features, and
  writes `real-dataset.jsonl`. It refuses below 40 usable domains.
- **Train-real** uses a smaller net + stronger L2 (real datasets start small),
  refuses below 40 samples, and **hard-refuses to write the model** if it
  fails to beat a predict-the-mean baseline on held-out data — a model that
  can't beat a constant hasn't learned a generalizable signal, so it never
  overwrites the working model. (`--force` is inspection-only and still won't
  promote a failed gate.)
- `real-dataset.jsonl` is git-ignored — it's derived from customer domains.

## Shared pieces

- `train-core.ts` — the standardize → MLP (F→H tanh→sigmoid) → backprop/GD →
  held-out eval logic, used by both trainers.
- `src/lib/model/features.ts` — the fixed feature vector. Changing `FEATURE_NAMES`
  is a breaking change: regenerate the dataset and retrain, and the model
  version must change (inference guards against a width mismatch at load).

The whole thing is honest by construction: the distilled model is labeled as
Claude's judgment (not citations), and the real model only exists once real
outcomes do — the guards make sure of it.
