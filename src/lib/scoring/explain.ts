import Anthropic from "@anthropic-ai/sdk";
import type { ReportResult } from "./types";

/**
 * Turn a report's scores into a short, friendly narrative for a non-technical
 * site owner.
 *
 * When `ANTHROPIC_API_KEY` is set, Claude (`claude-opus-4-8`) narrates the
 * report's own numbers and reasons. The raw scores stay authoritative — Claude
 * is instructed only to narrate, never to invent figures or facts. When the
 * key is absent, or the call fails for any reason, a deterministic fallback
 * narrative is composed from the report itself (no network). Never throws.
 */
export async function explainReport(report: ReportResult): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return fallbackNarrative(report);
  }

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 600,
      system:
        "You explain website authority reports to non-technical business " +
        "owners. Write 2-3 short, plain-English, encouraging sentences. Use " +
        "ONLY the scores, reasons, and fixes provided — never invent numbers, " +
        "facts, or claims beyond the report. No headings, no lists, no " +
        "markdown; just the sentences.",
      messages: [{ role: "user", content: buildPrompt(report) }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    return text || fallbackNarrative(report);
  } catch {
    return fallbackNarrative(report);
  }
}

/** Render a 0-1 coverage fraction as a whole percentage. */
function pct(coverage: number): string {
  return `${Math.round(coverage * 100)}%`;
}

/** Serialize the report into a compact prompt of facts Claude may narrate. */
function buildPrompt(report: ReportResult): string {
  const lines: string[] = [];
  lines.push(`Website: ${report.url}`);
  lines.push(
    `AI authority score: ${report.ai.total}/100 ` +
      `(from ${pct(report.ai.coverage)} of the AI model's signals)`,
  );
  lines.push(
    `Traditional (search) authority score: ${report.traditional.total}/100 ` +
      `(from ${pct(report.traditional.coverage)} of that model's signals)`,
  );
  lines.push("");
  lines.push("Signal notes:");
  for (const s of [...report.ai.signals, ...report.traditional.signals]) {
    // Unmeasured signals are passed through as such so the summary never
    // implies we checked something we didn't.
    const value = s.score === null ? "not measured" : `${s.score}/100`;
    lines.push(`- ${s.label} (${value}): ${s.reason}`);
  }
  const topFixes = report.prioritizedFixes.slice(0, 3);
  if (topFixes.length > 0) {
    lines.push("");
    lines.push("Top recommended fixes (already ranked by impact):");
    for (const fix of topFixes) lines.push(`- ${fix}`);
  }
  lines.push("");
  lines.push(
    "Write the 2-3 sentence summary now, leading with how the site is doing " +
      "overall and then the single most important next step.",
  );
  return lines.join("\n");
}

/** Deterministic, network-free narrative built from the report's own data. */
function fallbackNarrative(report: ReportResult): string {
  const ai = report.ai.total;
  const trad = report.traditional.total;

  const standing =
    ai >= 70 && trad >= 70
      ? "is in strong shape"
      : ai >= 40 && trad >= 40
        ? "has a solid foundation with room to grow"
        : "has clear room to improve";

  let narrative =
    `Your site ${standing}: it scores ${ai}/100 for AI authority ` +
    `(how likely AI models are to trust and cite you) and ${trad}/100 for ` +
    `traditional search authority.`;

  const topFix = report.prioritizedFixes[0];
  if (topFix) {
    narrative += ` The highest-impact next step is to ${lowerFirst(topFix)}`;
    const secondFix = report.prioritizedFixes[1];
    if (secondFix) {
      narrative += ` Then: ${lowerFirst(secondFix)}`;
    }
  } else {
    narrative +=
      " Every signal we checked already looks healthy — keep it up.";
  }

  return narrative;
}

/** Lowercase the first letter and ensure the clause ends with a period. */
function lowerFirst(text: string): string {
  const t = text.trim();
  const cased = t.charAt(0).toLowerCase() + t.slice(1);
  return /[.!?]$/.test(cased) ? cased : `${cased}.`;
}
