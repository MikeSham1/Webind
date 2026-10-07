// dupscan — near-duplicate page detection for a crawled site.
//
// WHY THIS IS NOT TYPESCRIPT
//
// The rest of WeBind scores each page on its own. Internal duplication is a
// different question that only an all-pairs comparison answers: which pages on
// this site are near-copies of each other? That is O(n^2) in the number of
// pages, and each comparison intersects two shingle sets of a few thousand
// entries. A 500-page sitemap is ~125k set intersections.
//
// The TypeScript equivalent (src/lib/content/gates.ts) builds a Set<string> of
// word trigrams per document and intersects by hashing every string. That is
// the right choice there — it compares exactly two documents, once. Applied
// across a whole site it allocates a string per trigram per page and re-hashes
// on every comparison.
//
// Here each trigram becomes one 64-bit hash, each document a sorted vector of
// them, and intersection is a linear merge over contiguous memory. No
// allocation and no hashing happen inside the O(n^2) loop.
//
// Deliberately standalone: it reads JSON Lines on stdin and writes JSON on
// stdout. The deployed app does not link against it, so it cannot affect the
// container build or a request.

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

// ---------------------------------------------------------------------------
// Minimal JSON reading
//
// Only what JSON Lines input needs: find a top-level string field and decode
// it. A full parser would be more code than the rest of this file. Escapes are
// handled properly, including surrogate pairs, because page text routinely
// contains quotes, newlines and non-ASCII punctuation.
// ---------------------------------------------------------------------------

void appendUtf8(std::string &out, uint32_t cp) {
  if (cp <= 0x7F) {
    out += static_cast<char>(cp);
  } else if (cp <= 0x7FF) {
    out += static_cast<char>(0xC0 | (cp >> 6));
    out += static_cast<char>(0x80 | (cp & 0x3F));
  } else if (cp <= 0xFFFF) {
    out += static_cast<char>(0xE0 | (cp >> 12));
    out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
    out += static_cast<char>(0x80 | (cp & 0x3F));
  } else {
    out += static_cast<char>(0xF0 | (cp >> 18));
    out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
    out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
    out += static_cast<char>(0x80 | (cp & 0x3F));
  }
}

bool hexQuad(const std::string &s, size_t i, uint32_t &out) {
  if (i + 4 > s.size()) return false;
  uint32_t v = 0;
  for (size_t k = i; k < i + 4; k++) {
    char c = s[k];
    v <<= 4;
    if (c >= '0' && c <= '9') v |= static_cast<uint32_t>(c - '0');
    else if (c >= 'a' && c <= 'f') v |= static_cast<uint32_t>(c - 'a' + 10);
    else if (c >= 'A' && c <= 'F') v |= static_cast<uint32_t>(c - 'A' + 10);
    else return false;
  }
  out = v;
  return true;
}

// Decode a JSON string starting at s[pos] == '"'. Advances pos past the close.
bool readString(const std::string &s, size_t &pos, std::string &out) {
  if (pos >= s.size() || s[pos] != '"') return false;
  pos++;
  out.clear();
  while (pos < s.size()) {
    char c = s[pos];
    if (c == '"') { pos++; return true; }
    if (c != '\\') { out += c; pos++; continue; }

    pos++;
    if (pos >= s.size()) return false;
    char e = s[pos++];
    switch (e) {
      case '"': out += '"'; break;
      case '\\': out += '\\'; break;
      case '/': out += '/'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'u': {
        uint32_t cp = 0;
        if (!hexQuad(s, pos, cp)) return false;
        pos += 4;
        // A high surrogate must be followed by its low pair to form one
        // code point; otherwise the text would be mangled mid-character.
        if (cp >= 0xD800 && cp <= 0xDBFF && pos + 1 < s.size() &&
            s[pos] == '\\' && s[pos + 1] == 'u') {
          uint32_t lo = 0;
          if (hexQuad(s, pos + 2, lo) && lo >= 0xDC00 && lo <= 0xDFFF) {
            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
            pos += 6;
          }
        }
        appendUtf8(out, cp);
        break;
      }
      default: return false;
    }
  }
  return false;
}

// Find `"<key>"` used as a key (followed by a colon) and decode its string
// value. Skips over matches that appear inside string values.
bool findField(const std::string &line, const std::string &key, std::string &out) {
  const std::string needle = "\"" + key + "\"";
  size_t i = 0;
  bool inString = false;
  while (i < line.size()) {
    char c = line[i];
    if (inString) {
      if (c == '\\') { i += 2; continue; }
      if (c == '"') inString = false;
      i++;
      continue;
    }
    if (c == '"') {
      if (line.compare(i, needle.size(), needle) == 0) {
        size_t j = i + needle.size();
        while (j < line.size() && std::isspace(static_cast<unsigned char>(line[j]))) j++;
        if (j < line.size() && line[j] == ':') {
          j++;
          while (j < line.size() && std::isspace(static_cast<unsigned char>(line[j]))) j++;
          if (j < line.size() && line[j] == '"') return readString(line, j, out);
          return false;  // present but not a string
        }
      }
      inString = true;
    }
    i++;
  }
  return false;
}

std::string escapeJson(const std::string &s) {
  std::string out;
  out.reserve(s.size() + 8);
  for (char ch : s) {
    const unsigned char c = static_cast<unsigned char>(ch);
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof(buf), "\\u%04x", c);
          out += buf;
        } else {
          out += static_cast<char>(c);
        }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shingling
// ---------------------------------------------------------------------------

// FNV-1a. Chosen for being dependency-free and well distributed over short
// strings; this is a similarity heuristic, not a security boundary.
uint64_t fnv1a(const char *data, size_t len) {
  uint64_t h = 1469598103934665603ULL;
  for (size_t i = 0; i < len; i++) {
    h ^= static_cast<uint64_t>(static_cast<unsigned char>(data[i]));
    h *= 1099511628211ULL;
  }
  return h;
}

// Matches the TypeScript gate's normalization (lowercase, non-alphanumerics to
// spaces) so a score here means the same thing as a score there. Bytes >= 0x80
// are kept so non-ASCII words survive as distinct tokens.
std::vector<std::string> tokenize(const std::string &text) {
  std::vector<std::string> out;
  std::string cur;
  for (char ch : text) {
    const unsigned char c = static_cast<unsigned char>(ch);
    bool keep = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') ||
                (c >= 'A' && c <= 'Z') || c >= 0x80;
    if (keep) {
      cur += static_cast<char>(std::tolower(c));
    } else if (!cur.empty()) {
      out.push_back(cur);
      cur.clear();
    }
  }
  if (!cur.empty()) out.push_back(cur);
  return out;
}

/** Sorted, de-duplicated 64-bit hashes of the document's word trigrams. */
std::vector<uint64_t> shingles(const std::string &text, int n) {
  std::vector<std::string> toks = tokenize(text);
  std::vector<uint64_t> out;
  if (static_cast<int>(toks.size()) < n) return out;

  out.reserve(toks.size());
  std::string gram;
  for (size_t i = 0; i + static_cast<size_t>(n) <= toks.size(); i++) {
    gram.clear();
    for (int k = 0; k < n; k++) {
      if (k) gram += ' ';
      gram += toks[i + static_cast<size_t>(k)];
    }
    out.push_back(fnv1a(gram.data(), gram.size()));
  }
  std::sort(out.begin(), out.end());
  out.erase(std::unique(out.begin(), out.end()), out.end());
  return out;
}

/** Jaccard over two sorted vectors: one linear merge, no allocation. */
double jaccard(const std::vector<uint64_t> &a, const std::vector<uint64_t> &b) {
  if (a.empty() || b.empty()) return 0.0;
  size_t i = 0, j = 0, inter = 0;
  while (i < a.size() && j < b.size()) {
    if (a[i] == b[j]) { inter++; i++; j++; }
    else if (a[i] < b[j]) i++;
    else j++;
  }
  const double uni = static_cast<double>(a.size() + b.size() - inter);
  return uni == 0.0 ? 0.0 : static_cast<double>(inter) / uni;
}

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

struct DisjointSet {
  std::vector<size_t> parent;
  explicit DisjointSet(size_t n) : parent(n) {
    for (size_t i = 0; i < n; i++) parent[i] = i;
  }
  size_t find(size_t x) {
    while (parent[x] != x) {
      parent[x] = parent[parent[x]];  // path halving
      x = parent[x];
    }
    return x;
  }
  void join(size_t a, size_t b) {
    const size_t ra = find(a), rb = find(b);
    if (ra != rb) parent[rb] = ra;
  }
};

struct Doc {
  std::string url;
  std::vector<uint64_t> grams;
};

struct Pair {
  size_t a, b;
  double score;
};

void usage() {
  std::fprintf(stderr,
      "dupscan — find near-duplicate pages in a crawled site\n\n"
      "Usage: dupscan [--threshold 0.80] [--ngram 3] [--min-grams 20] < pages.jsonl\n\n"
      "Input:  one JSON object per line with \"url\" and \"text\" fields.\n"
      "        Extra fields are ignored, so the crawler's own output can be\n"
      "        piped in unchanged.\n"
      "Output: a JSON report on stdout; diagnostics on stderr.\n\n"
      "Exit:   0 = no duplicates found, 1 = duplicates found, 2 = bad input.\n"
      "        The 1 lets CI fail a build that introduces duplicate pages.\n");
}

}  // namespace

int main(int argc, char **argv) {
  double threshold = 0.80;
  int ngram = 3;
  size_t minGrams = 20;

  for (int i = 1; i < argc; i++) {
    const std::string arg = argv[i];
    auto next = [&](double &dst) {
      if (i + 1 >= argc) { usage(); std::exit(2); }
      dst = std::atof(argv[++i]);
    };
    if (arg == "--threshold") next(threshold);
    else if (arg == "--ngram") { double v = 0; next(v); ngram = static_cast<int>(v); }
    else if (arg == "--min-grams") { double v = 0; next(v); minGrams = static_cast<size_t>(v); }
    else if (arg == "-h" || arg == "--help") { usage(); return 0; }
    else { std::fprintf(stderr, "dupscan: unknown option %s\n", arg.c_str()); usage(); return 2; }
  }

  if (threshold <= 0.0 || threshold > 1.0) {
    std::fprintf(stderr, "dupscan: --threshold must be in (0, 1]\n");
    return 2;
  }
  if (ngram < 1 || ngram > 10) {
    std::fprintf(stderr, "dupscan: --ngram must be between 1 and 10\n");
    return 2;
  }

  std::vector<Doc> docs;
  std::vector<std::string> skipped;
  std::string line;
  size_t lineNo = 0;

  while (std::getline(std::cin, line)) {
    lineNo++;
    if (line.find_first_not_of(" \t\r\n") == std::string::npos) continue;

    std::string url, text;
    if (!findField(line, "url", url)) {
      std::fprintf(stderr, "dupscan: line %zu has no \"url\" string field — skipped\n", lineNo);
      continue;
    }
    if (!findField(line, "text", text)) {
      std::fprintf(stderr, "dupscan: %s has no \"text\" string field — skipped\n", url.c_str());
      continue;
    }

    Doc d;
    d.url = url;
    d.grams = shingles(text, ngram);
    // Too little text to judge. Reported separately rather than silently
    // dropped — a page with almost no content is its own SEO problem, and
    // calling it "not a duplicate" would be misleading.
    if (d.grams.size() < minGrams) { skipped.push_back(url); continue; }
    docs.push_back(std::move(d));
  }

  const size_t n = docs.size();
  std::vector<Pair> pairs;
  size_t compared = 0, pruned = 0;

  // Compare by ascending shingle count so the size-ratio bound below prunes
  // the longest runs of hopeless pairs first.
  std::vector<size_t> order(n);
  for (size_t i = 0; i < n; i++) order[i] = i;
  std::sort(order.begin(), order.end(), [&](size_t a, size_t b) {
    return docs[a].grams.size() < docs[b].grams.size();
  });

  for (size_t ii = 0; ii < n; ii++) {
    const size_t i = order[ii];
    for (size_t jj = ii + 1; jj < n; jj++) {
      const size_t j = order[jj];
      const double small = static_cast<double>(docs[i].grams.size());
      const double large = static_cast<double>(docs[j].grams.size());

      // Exact bound, not a heuristic: with |A| <= |B|, the intersection is at
      // most |A|, so J <= |A| / |B|. Once that ceiling drops below the
      // threshold it stays below for every larger j, so the rest of the row
      // cannot qualify and is skipped wholesale.
      if (small / large < threshold) { pruned += n - jj; break; }

      compared++;
      const double s = jaccard(docs[i].grams, docs[j].grams);
      if (s >= threshold) pairs.push_back({i, j, s});
    }
  }

  DisjointSet ds(n);
  for (const Pair &p : pairs) ds.join(p.a, p.b);

  // Group every doc by its set root, then keep only the groups with more than
  // one member — a singleton root just means "no duplicates", not a cluster.
  std::unordered_map<size_t, std::vector<size_t>> clusters;
  for (size_t i = 0; i < n; i++) clusters[ds.find(i)].push_back(i);

  // Stable output, so a report can be diffed between runs: clusters ordered by
  // their first URL, members alphabetically, pairs by descending similarity.
  std::vector<std::vector<size_t>> ordered;
  for (auto &kv : clusters) {
    if (kv.second.size() < 2) continue;
    std::sort(kv.second.begin(), kv.second.end(),
              [&](size_t a, size_t b) { return docs[a].url < docs[b].url; });
    ordered.push_back(kv.second);
  }
  std::sort(ordered.begin(), ordered.end(),
            [&](const std::vector<size_t> &a, const std::vector<size_t> &b) {
              return docs[a[0]].url < docs[b[0]].url;
            });
  std::sort(pairs.begin(), pairs.end(), [&](const Pair &a, const Pair &b) {
    if (a.score != b.score) return a.score > b.score;
    return docs[a.a].url < docs[b.a].url;
  });

  std::printf("{\n");
  std::printf("  \"pages\": %zu,\n", n);
  std::printf("  \"threshold\": %.2f,\n", threshold);
  std::printf("  \"comparisons\": %zu,\n", compared);
  std::printf("  \"pruned\": %zu,\n", pruned);

  std::printf("  \"skippedThinPages\": [");
  for (size_t i = 0; i < skipped.size(); i++) {
    std::printf("%s\n    \"%s\"", i ? "," : "", escapeJson(skipped[i]).c_str());
  }
  std::printf("%s],\n", skipped.empty() ? "" : "\n  ");

  std::printf("  \"clusters\": [");
  for (size_t c = 0; c < ordered.size(); c++) {
    std::printf("%s\n    [", c ? "," : "");
    for (size_t k = 0; k < ordered[c].size(); k++) {
      std::printf("%s\n      \"%s\"", k ? "," : "", escapeJson(docs[ordered[c][k]].url).c_str());
    }
    std::printf("\n    ]");
  }
  std::printf("%s],\n", ordered.empty() ? "" : "\n  ");

  std::printf("  \"pairs\": [");
  for (size_t i = 0; i < pairs.size(); i++) {
    std::printf("%s\n    { \"a\": \"%s\", \"b\": \"%s\", \"similarity\": %.4f }",
                i ? "," : "", escapeJson(docs[pairs[i].a].url).c_str(),
                escapeJson(docs[pairs[i].b].url).c_str(), pairs[i].score);
  }
  std::printf("%s]\n}\n", pairs.empty() ? "" : "\n  ");

  std::fprintf(stderr, "dupscan: %zu pages, %zu comparisons (%zu pruned), %zu duplicate pair(s)\n",
               n, compared, pruned, pairs.size());
  return pairs.empty() ? 0 : 1;
}
