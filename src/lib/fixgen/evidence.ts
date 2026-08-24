import { createHash } from "node:crypto";
import type { PageSnapshot } from "./snapshot";

/**
 * Immutable evidence spans.
 *
 * Before the generator runs, we deterministically turn the page's own material
 * into numbered, hashed evidence objects. The generator may only introduce a
 * factual claim by citing the span(s) that support it, and the validator
 * verifies those ids exist in this exact snapshot. This is the grounding
 * contract: no evidence id → the "fact" is fabricated → the candidate is rejected.
 */
export interface EvidenceSpan {
  spanId: string;
  source: "title" | "meta" | "heading" | "visible_body" | "json_ld";
  text: string;
  textHash: string;
  /** Char offsets into the snapshot's renderedText, when the span came from it. */
  startChar?: number;
  endChar?: number;
}

function hash(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

/** Pull short string leaves out of a JSON-LD block (values, not keys). */
function jsonLdStrings(block: unknown, out: string[], depth = 0): void {
  if (depth > 6 || out.length > 40) return;
  if (typeof block === "string") {
    const t = block.trim();
    if (t.length >= 2 && t.length <= 200 && !/^https?:\/\//i.test(t)) out.push(t);
    return;
  }
  if (Array.isArray(block)) {
    for (const v of block) jsonLdStrings(v, out, depth + 1);
    return;
  }
  if (block && typeof block === "object") {
    for (const v of Object.values(block as Record<string, unknown>)) {
      jsonLdStrings(v, out, depth + 1);
    }
  }
}

/**
 * Extract evidence spans from a snapshot. Body text is chunked on sentence
 * boundaries with real char offsets, so a validator can point a claim at an
 * exact location. Deterministic and total.
 */
export function extractEvidenceSpans(snapshot: PageSnapshot): EvidenceSpan[] {
  const spans: EvidenceSpan[] = [];
  let n = 0;
  const nextId = () => `ev_${String(++n).padStart(3, "0")}`;
  const add = (span: Omit<EvidenceSpan, "spanId" | "textHash">) => {
    const text = span.text.trim();
    if (!text) return;
    spans.push({ spanId: nextId(), textHash: hash(text), ...span, text });
  };

  if (snapshot.title) add({ source: "title", text: snapshot.title });
  if (snapshot.metaDescription) add({ source: "meta", text: snapshot.metaDescription });
  for (const h of snapshot.headings) add({ source: "heading", text: h.text });

  // Body: split into sentence-ish chunks and record offsets into renderedText.
  const body = snapshot.renderedText;
  const re = /[^.!?\n]+[.!?]?/g;
  let m: RegExpExecArray | null;
  let bodyCount = 0;
  while ((m = re.exec(body)) !== null && bodyCount < 60) {
    const text = m[0].trim();
    if (text.length < 12) continue;
    const start = m.index + m[0].indexOf(text[0]);
    add({
      source: "visible_body",
      text,
      startChar: start,
      endChar: start + text.length,
    });
    bodyCount++;
  }

  const ldStrings: string[] = [];
  for (const block of snapshot.jsonLdBlocks) jsonLdStrings(block, ldStrings);
  for (const s of ldStrings) add({ source: "json_ld", text: s });

  return spans;
}

/** Concatenated, lowercased text of the given evidence ids — for support checks. */
export function evidenceCorpus(spans: EvidenceSpan[], ids: string[]): string {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  return ids
    .map((id) => byId.get(id)?.text ?? "")
    .join(" • ")
    .toLowerCase();
}
