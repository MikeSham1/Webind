# dupscan

Finds near-duplicate pages across a crawled site.

WeBind scores each page on its own. Internal duplication is a different
question, and only an all-pairs comparison answers it: *which pages on this
site are near-copies of each other?* The app already tells users that
"duplicate content hurts rankings" when a draft matches the page it would
replace (`src/lib/content/gates.ts`) — this applies the same measure across a
whole sitemap, which `src/lib/crawler/assess-site.ts` does not do.

## Why this one is C++

It is `O(n²)` in pages, and each comparison intersects two shingle sets of a
few thousand entries. A 500-page sitemap is ~125k set intersections.

The TypeScript gate builds a `Set<string>` of word trigrams per document and
intersects by hashing every string. That is the right design there — it
compares two documents, once. Run across a whole site it allocates a string per
trigram per page and re-hashes on every comparison.

Here each trigram is one 64-bit hash, each document a sorted `vector<uint64_t>`,
and intersection is a linear merge over contiguous memory. Nothing allocates or
hashes inside the `O(n²)` loop.

Measured on 500 pages of ~300 words (Apple M-series, `-O2`):

| | time | pairs found |
|---|---|---|
| TypeScript equivalent, all-pairs | 707 ms | 19 |
| `dupscan` (incl. process start, JSON parse) | 210 ms | 19 |

Same 19 pairs — verified as an identical set, not just an equal count.

### The prune is exact, not a heuristic

Documents are compared in ascending shingle count. With `|A| ≤ |B|` the
intersection is at most `|A|`, so

```
J(A,B) = |A∩B| / (|A| + |B| − |A∩B|)  ≤  |A| / |B|
```

Once that ceiling falls below the threshold it stays below for every larger
document, so the rest of the row is skipped. No qualifying pair can be lost.

Verified against a brute-force reference on a corpus of deliberately varied
page lengths: **8,999 of 11,175 comparisons pruned (80%), identical results,
zero missed pairs.**

## Build and test

```sh
make          # needs only a C++17 compiler
make test     # 16 cases
```

Nothing links against this. The Next.js build, the container image and the
request path are all unaffected — it is excluded from the Docker context.

## Use

```sh
# One JSON object per line with "url" and "text". Extra fields are ignored,
# so the crawler's own output pipes in unchanged.
dupscan --threshold 0.85 < pages.jsonl > duplicates.json

npm run dupscan -- --threshold 0.85 < pages.jsonl   # builds if needed
```

| Flag | Default | Meaning |
|---|---|---|
| `--threshold` | `0.80` | Jaccard score at or above which two pages are duplicates |
| `--ngram` | `3` | Words per shingle. Lower catches looser paraphrase, raises false positives |
| `--min-grams` | `20` | Below this a page is too thin to judge; reported separately |

Exit codes: `0` none found, `1` duplicates found, `2` bad usage. The `1` lets a
CI step fail a build that introduces duplicate pages.

### Output

```json
{
  "pages": 500,
  "threshold": 0.80,
  "comparisons": 124750,
  "pruned": 0,
  "skippedThinPages": ["/tag/archive"],
  "clusters": [["/services", "/services-2", "/it-services"]],
  "pairs": [{ "a": "/services", "b": "/services-2", "similarity": 0.9731 }]
}
```

`clusters` groups pages transitively (union-find): if A≈B and B≈C they are one
cluster even when A and C fall just under the threshold — which is usually the
set you want to consolidate behind one canonical URL. Ordering is stable, so
two reports can be diffed.

Thin pages are listed rather than dropped: a page with almost no content is its
own SEO problem, and calling it "not a duplicate" would be misleading.
