import { generate } from "@/lib/ai/generator";
import { anthropicProvider } from "@/lib/ai/anthropic";
import { gemini37Provider } from "@/lib/ai/gemini";
import type { AiProvider } from "@/lib/ai/types";
import { CONTENT_WRITER_SYSTEM, serializeContentInputs, toTuningRow, type TuningRow } from "./prompt";
import { scoreContentQuality, type ContentQualityScore } from "./quality";
import {
  CONTENT_RESEARCH_PRINCIPLES,
  CONTENT_RESEARCH_VERSION,
  researchWritingRules,
} from "./research";
import type { ContentInputs, PageType } from "./types";

export interface SyntheticBrief {
  id: string;
  inputs: ContentInputs;
  slice: {
    industry: string;
    intent: string;
    evidenceDensity: "sparse" | "normal" | "rich";
    risk: "ordinary" | "ymyl";
  };
}

export interface CandidateJudge {
  grounded: boolean;
  unsupportedClaims: string[];
  usefulness: number;
  intentFit: number;
  extractability: number;
  notes: string[];
}

export interface SyntheticCandidate {
  markdown: string;
  quality: ContentQualityScore;
  judge: CandidateJudge;
  compositeScore: number;
  rejected: boolean;
  rejectionReasons: string[];
}

export interface SelectedSyntheticExample {
  brief: SyntheticBrief;
  winner: SyntheticCandidate;
  row: TuningRow;
  provenance: {
    researchVersion: string;
    principleIds: string[];
    teacherModel: string;
    judgeModel: string;
    candidateCount: number;
  };
}

export interface SyntheticSplits {
  train: SelectedSyntheticExample[];
  validation: SelectedSyntheticExample[];
  locked: SelectedSyntheticExample[];
}

const PAGE_TYPES: PageType[] = ["landing", "blog", "product", "about", "faq"];
const INDUSTRIES = [
  "commercial facilities",
  "B2B software",
  "industrial equipment",
  "professional services",
  "home services",
  "education technology",
  "logistics",
  "hospitality",
  "consumer electronics",
  "nonprofit operations",
];
const INTENTS = [
  "compare options before buying",
  "understand a process",
  "evaluate a provider",
  "solve a practical problem",
  "learn product capabilities",
  "decide whether a service fits",
  "answer common pre-purchase objections",
];
const AUDIENCES = [
  "operations leaders",
  "small business owners",
  "technical evaluators",
  "procurement teams",
  "first-time buyers",
  "experienced practitioners",
  "department managers",
];
const TONES = ["clear and professional", "plainspoken", "technical but accessible", "confident and restrained"];

function hash32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(items: readonly T[], seed: number, salt: number): T {
  const mixed = (seed + Math.imul(salt, 2654435761)) >>> 0;
  return items[mixed % items.length] as T;
}

function titleCase(text: string): string {
  return text.replace(/\b\w/g, (m) => m.toUpperCase());
}

function fictionalFacts(seed: number, industry: string, density: SyntheticBrief["slice"]["evidenceDensity"]): string[] {
  const brand = `Northstar ${titleCase(industry.split(" ")[0])}`;
  const facts = [
    `${brand} was founded in ${2011 + (seed % 13)}.`,
    `${brand} serves customers in ${4 + (seed % 27)} states.`,
    `Standard onboarding takes ${5 + (seed % 16)} business days.`,
    `Support is available ${8 + (seed % 5)} hours per business day.`,
    `The standard contract term is ${6 + (seed % 19)} months.`,
    `The product includes ${3 + (seed % 8)} configurable workflow templates.`,
    `Customers receive a written implementation plan before launch.`,
    `Pricing is provided by quote after requirements are reviewed.`,
  ];
  if (density === "sparse") return facts.slice(0, 2);
  if (density === "normal") return facts.slice(0, 5);
  return facts;
}

/** Deterministic fictional briefs: reproducible, diverse, and free of customer data. */
export function buildSyntheticBriefs(count: number, seedText = "webind-v1"): SyntheticBrief[] {
  const briefs: SyntheticBrief[] = [];
  for (let i = 0; i < count; i++) {
    const seed = hash32(`${seedText}:${i}`);
    const pageType = PAGE_TYPES[i % PAGE_TYPES.length];
    const industry = pick(INDUSTRIES, seed, 1);
    const intent = pick(INTENTS, seed, 2);
    const audience = pick(AUDIENCES, seed, 3);
    const tone = pick(TONES, seed, 4);
    const evidenceDensity = (["sparse", "normal", "rich"] as const)[i % 3];
    const risk: "ordinary" | "ymyl" = i % 19 === 0 ? "ymyl" : "ordinary";
    const topicRoot = `${industry} ${pageType === "blog" ? "guide" : pageType === "faq" ? "questions" : "solution"}`;
    const topic = risk === "ymyl" ? `General information about ${industry} compliance considerations` : `${titleCase(topicRoot)} for ${audience}`;
    const keyFacts = fictionalFacts(seed, industry, evidenceDensity);
    if (risk === "ymyl") keyFacts.push("The page must provide general information only and must not provide legal, medical, or financial advice.");

    briefs.push({
      id: `synthetic-${String(i + 1).padStart(6, "0")}`,
      inputs: {
        topic,
        pageType,
        audience,
        tone,
        keyFacts,
        brandName: `Northstar ${titleCase(industry.split(" ")[0])}`,
        keywords: [industry, `${industry} ${pageType}`],
      },
      slice: { industry, intent, evidenceDensity, risk },
    });
  }
  return briefs;
}

const TEACHER_SYSTEM = [
  CONTENT_WRITER_SYSTEM,
  "",
  `Research policy version: ${CONTENT_RESEARCH_VERSION}.`,
  "Apply these evidence-backed constraints:",
  ...researchWritingRules(),
  "The business in the brief is fictional. Treat the supplied key facts as the complete factual universe for business-specific claims.",
].join("\n");

const JUDGE_SYSTEM = [
  "You are an independent evaluator for a supervised-tuning corpus.",
  "Judge the candidate only against the supplied brief and evaluation criteria.",
  "A business-specific factual claim is unsupported unless it follows directly from a supplied key fact.",
  "Generic advice may be allowed when it is clearly framed as general guidance rather than a fact about the fictional business.",
  "Return JSON with exactly: grounded:boolean, unsupportedClaims:string[], usefulness:number, intentFit:number, extractability:number, notes:string[].",
  "Scores are 0..100. Do not reward keyword repetition, arbitrary length, citation count, or formatting for its own sake.",
].join("\n");

function defaultJudgeProvider(): AiProvider {
  // Existing production keys must not silently opt a new offline workload into
  // another vendor. Gemini 3.7 is the default; use TUNING_JUDGE_PROVIDER=anthropic
  // deliberately when an independent Claude judge is desired.
  return process.env.TUNING_JUDGE_PROVIDER?.trim().toLowerCase() === "anthropic"
    ? anthropicProvider()
    : gemini37Provider();
}

function parseJudge(text: string): CandidateJudge | null {
  try {
    const raw = JSON.parse(text) as Partial<CandidateJudge>;
    if (typeof raw.grounded !== "boolean") return null;
    const score = (x: unknown) => Math.max(0, Math.min(100, Number(x) || 0));
    return {
      grounded: raw.grounded,
      unsupportedClaims: Array.isArray(raw.unsupportedClaims) ? raw.unsupportedClaims.map(String).slice(0, 20) : [],
      usefulness: score(raw.usefulness),
      intentFit: score(raw.intentFit),
      extractability: score(raw.extractability),
      notes: Array.isArray(raw.notes) ? raw.notes.map(String).slice(0, 10) : [],
    };
  } catch {
    return null;
  }
}

function composite(quality: ContentQualityScore, judge: CandidateJudge): number {
  const score =
    0.30 * quality.score +
    0.25 * judge.usefulness +
    0.20 * (judge.grounded ? 100 : 0) +
    0.15 * judge.intentFit +
    0.10 * judge.extractability;
  return Math.round(score * 10) / 10;
}

export async function evaluateSyntheticCandidate(
  brief: SyntheticBrief,
  markdown: string,
  judgeProvider: AiProvider,
): Promise<SyntheticCandidate> {
  const quality = scoreContentQuality(brief.inputs, markdown);
  const judgeResult = await generate(
    {
      system: JUDGE_SYSTEM,
      prompt: [
        "BRIEF:",
        serializeContentInputs(brief.inputs),
        `Search intent: ${brief.slice.intent}`,
        "",
        "CANDIDATE:",
        markdown,
      ].join("\n"),
      json: true,
      maxOutputTokens: 1200,
      purpose: "content_tuning_judge",
    },
    { provider: judgeProvider },
  );
  const parsed = !judgeResult.fallback ? parseJudge(judgeResult.text.trim()) : null;
  const judge: CandidateJudge = parsed ?? {
    grounded: false,
    unsupportedClaims: ["Judge unavailable or returned invalid JSON"],
    usefulness: 0,
    intentFit: 0,
    extractability: 0,
    notes: ["Candidate rejected because independent evaluation failed."],
  };

  const rejectionReasons: string[] = [];
  if (!judge.grounded || judge.unsupportedClaims.length > 0) rejectionReasons.push("unsupported factual claim");
  if (judge.usefulness < 70) rejectionReasons.push("usefulness below 70");
  if (judge.intentFit < 70) rejectionReasons.push("intent fit below 70");
  if (quality.warnings.some((w) => w.includes("unusually often"))) rejectionReasons.push("keyword repetition warning");
  if (quality.score < 55) rejectionReasons.push("Webind content score below 55");

  return {
    markdown,
    quality,
    judge,
    compositeScore: composite(quality, judge),
    rejected: rejectionReasons.length > 0,
    rejectionReasons,
  };
}

export async function generateSyntheticExample(
  brief: SyntheticBrief,
  opts: {
    candidateCount?: number;
    teacherProvider?: AiProvider;
    judgeProvider?: AiProvider;
  } = {},
): Promise<SelectedSyntheticExample | null> {
  const candidateCount = Math.max(2, Math.min(8, opts.candidateCount ?? 4));
  const teacher = opts.teacherProvider ?? gemini37Provider();
  const judge = opts.judgeProvider ?? defaultJudgeProvider();
  if (!teacher.isConfigured() || !judge.isConfigured()) return null;

  const evaluated: SyntheticCandidate[] = [];
  for (let i = 0; i < candidateCount; i++) {
    const generated = await generate(
      {
        system: TEACHER_SYSTEM,
        prompt: [
          serializeContentInputs(brief.inputs),
          `Search intent: ${brief.slice.intent}`,
          `Evidence density: ${brief.slice.evidenceDensity}`,
          "Write one complete candidate. Prefer a genuinely different organization or angle from other possible candidates while preserving the same facts.",
        ].join("\n"),
        json: false,
        grounded: false,
        maxOutputTokens: 4096,
        purpose: "content_tuning_teacher",
      },
      { provider: teacher },
    );
    if (generated.fallback || !generated.text.trim()) continue;
    evaluated.push(await evaluateSyntheticCandidate(brief, generated.text.trim(), judge));
  }

  const winner = evaluated
    .filter((c) => !c.rejected)
    .sort((a, b) => b.compositeScore - a.compositeScore)[0];
  if (!winner) return null;

  return {
    brief,
    winner,
    row: toTuningRow(brief.inputs, winner.markdown),
    provenance: {
      researchVersion: CONTENT_RESEARCH_VERSION,
      principleIds: CONTENT_RESEARCH_PRINCIPLES.map((p) => p.id),
      teacherModel: teacher.model,
      judgeModel: judge.model,
      candidateCount,
    },
  };
}

/** Stable hash split; locked rows are isolated before validation/train assignment. */
export function splitSyntheticExamples(examples: SelectedSyntheticExample[]): SyntheticSplits {
  const train: SelectedSyntheticExample[] = [];
  const validation: SelectedSyntheticExample[] = [];
  const locked: SelectedSyntheticExample[] = [];
  for (const example of examples) {
    const bucket = hash32(`split:${example.brief.id}`) % 100;
    if (bucket < 10) locked.push(example);
    else if (bucket < 20) validation.push(example);
    else train.push(example);
  }
  return { train, validation, locked };
}

export function tuningRows(examples: SelectedSyntheticExample[]): TuningRow[] {
  return examples.map((e) => e.row);
}
