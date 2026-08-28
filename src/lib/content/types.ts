export type PageType = "landing" | "blog" | "product" | "about" | "faq";

export type DraftStatus = "pending_review" | "approved" | "rejected";

/** Everything the user supplies in the guided Q&A. The ONLY factual source. */
export interface ContentInputs {
  topic: string; // what the page is about (becomes the title)
  pageType: PageType;
  audience: string; // who it's for
  tone: string; // e.g. "professional", "friendly"
  keyFacts: string[]; // grounding facts — content may only assert these
  keywords?: string[];
  brandName?: string;
  existingContent?: string; // optional, enables the originality check
  targetUrl?: string;
}

export type GateStatus = "pass" | "warn" | "block" | "info";

export interface GateResult {
  key: "fabrication" | "ymyl" | "originality" | "approval";
  label: string;
  status: GateStatus;
  detail: string;
}

export interface GateReport {
  results: GateResult[];
  /** True if any gate blocks — the draft cannot be approved until resolved. */
  blocked: boolean;
}

export interface ContentDraft {
  title: string;
  markdown: string;
  gates: GateReport;
  /**
   * How the draft was produced — an AI writer, or the deterministic fallback.
   * Set on fresh generation; absent on a reloaded draft (not persisted).
   */
  writtenBy?: "model" | "template";
}
