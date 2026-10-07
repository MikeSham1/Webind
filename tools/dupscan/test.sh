#!/usr/bin/env bash
# Test suite for dupscan. No framework: a compiled binary with a JSON stdout
# contract is exactly what a shell script is good at testing.
set -uo pipefail

BIN=./dupscan
pass=0; fail=0
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then
    pass=$((pass+1)); printf '  ok   %s\n' "$1"
  else
    fail=$((fail+1)); printf '  FAIL %s\n       expected: %s\n       actual:   %s\n' "$1" "$2" "$3"
  fi
}

# A paragraph long enough to clear --min-grams.
BODY="managed it support for law firms in denver with a twenty four hour helpdesk \
and a response time under fifteen minutes backed by soc two certification and \
onsite engineers who understand legal software and document management systems"

echo "dupscan tests"

# --- identical pages -------------------------------------------------------
out=$(printf '{"url":"/a","text":"%s"}\n{"url":"/b","text":"%s"}\n' "$BODY" "$BODY" | $BIN 2>/dev/null)
code=$?
check "identical pages are flagged" "1" "$code"
check "identical pages score 1.0" "1.0000" "$(echo "$out" | grep -o '"similarity": [0-9.]*' | head -1 | awk '{print $2}')"
echo "$out" > "$TMP/clusters.json"
check "identical pages form one cluster" "1" "$(node -e 'const fs=require("fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log(r.clusters.length)' "$TMP/clusters.json")"
check "the cluster holds both pages" "/a,/b" "$(node -e 'const fs=require("fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log(r.clusters[0].join(","))' "$TMP/clusters.json")"

# --- unrelated pages -------------------------------------------------------
OTHER="a completely different page about baking sourdough bread at home using a \
wild yeast starter cultivated over two weeks with regular feeding of flour and \
water kept at room temperature until it doubles reliably between feedings"
printf '{"url":"/a","text":"%s"}\n{"url":"/c","text":"%s"}\n' "$BODY" "$OTHER" | $BIN >/dev/null 2>&1
check "unrelated pages exit 0" "0" "$?"

# --- the size-ratio prune must not change results --------------------------
# A short page and a long page can never reach the threshold; the bound skips
# them. Verify the bound prunes AND that the verdict is still correct.
SHORT="managed it support for law firms"
out=$(printf '{"url":"/a","text":"%s"}\n{"url":"/long","text":"%s %s"}\n' "$BODY" "$BODY" "$OTHER" | $BIN --threshold 0.95 2>/dev/null)
check "prune leaves no false positive" "0" "$(echo "$out" | grep -c '"similarity"')"

# --- thin pages are reported, not silently dropped -------------------------
out=$(printf '{"url":"/thin","text":"%s"}\n{"url":"/a","text":"%s"}\n' "$SHORT" "$BODY" | $BIN 2>/dev/null)
check "thin page is reported separately" "1" "$(echo "$out" | grep -c '"/thin"')"
check "thin page excluded from page count" "1" "$(echo "$out" | grep -o '"pages": [0-9]*' | awk '{print $2}')"

# --- JSON escapes in input -------------------------------------------------
# Real page text contains quotes, newlines and non-ASCII punctuation.
ESC="he said \\\"hello\\\" then\\nleft \\u2014 abruptly $BODY"
out=$(printf '{"url":"/q","text":"%s"}\n{"url":"/q2","text":"%s"}\n' "$ESC" "$ESC" | $BIN 2>/dev/null)
check "escaped input parses and matches" "1.0000" "$(echo "$out" | grep -o '"similarity": [0-9.]*' | head -1 | awk '{print $2}')"

# --- field order and extra fields ------------------------------------------
# The crawler emits more than url/text, and not necessarily in that order.
out=$(printf '{"score":91,"text":"%s","url":"/x"}\n{"url":"/y","text":"%s","note":"t"}\n' "$BODY" "$BODY" | $BIN 2>/dev/null)
check "extra/reordered fields still parse" "1.0000" "$(echo "$out" | grep -o '"similarity": [0-9.]*' | head -1 | awk '{print $2}')"

# --- a URL containing the literal text "url" must not confuse the scanner ---
out=$(printf '{"url":"/a?q=%%22url%%22:fake","text":"%s"}\n{"url":"/b","text":"%s"}\n' "$BODY" "$BODY" | $BIN 2>/dev/null)
check "key-like substring in a value is ignored" "1.0000" "$(echo "$out" | grep -o '"similarity": [0-9.]*' | head -1 | awk '{print $2}')"

# --- malformed input -------------------------------------------------------
printf 'not json at all\n' | $BIN >/dev/null 2>&1
check "garbage line is skipped, not fatal" "0" "$?"
printf '' | $BIN >/dev/null 2>&1
check "empty input exits 0" "0" "$?"
$BIN --threshold 5 </dev/null >/dev/null 2>&1
check "out-of-range threshold exits 2" "2" "$?"
$BIN --bogus </dev/null >/dev/null 2>&1
check "unknown flag exits 2" "2" "$?"

# --- output is valid JSON --------------------------------------------------
if command -v node >/dev/null 2>&1; then
  # Not a pipeline: dupscan exits 1 on purpose when it finds duplicates, and
  # `pipefail` would report that as the parser's failure.
  printf '{"url":"/a","text":"%s"}\n{"url":"/b","text":"%s"}\n' "$BODY" "$ESC" > "$TMP/in.jsonl"
  $BIN < "$TMP/in.jsonl" > "$TMP/out.json" 2>/dev/null
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$TMP/out.json" >/dev/null 2>&1
  check "stdout is parseable JSON" "0" "$?"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
