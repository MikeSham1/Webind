/**
 * Provider-neutral text generation.
 *
 * The product must not be coupled to any one model vendor. Every generator call
 * goes through this small interface; provider SDK response objects never leak
 * out of the adapters. Adding a model (or a fine-tuned endpoint) is a new
 * adapter + a config value, not a change to callers.
 */

export type AiProviderName = "gemini" | "anthropic" | "fake";

export interface GenerateRequest {
  /** System instruction — the operator/role frame. Trusted. */
  system: string;
  /** The user/task content. Treated as data by the model, never as instructions. */
  prompt: string;
  maxOutputTokens?: number;
  /** Ask for strict JSON output. Still parsed + validated deterministically downstream. */
  json?: boolean;
  /**
   * Let the model consult live web search ("data from online"). Gemini uses
   * Google Search grounding; providers without a grounding tool ignore it.
   * Use for tasks that benefit from current external information (writing new
   * content), NOT for tasks that must stay grounded only in supplied data.
   */
  grounded?: boolean;
  /**
   * Reasoning depth for models that support it (Gemini's thinkingLevel). Quick
   * text tasks (narrating a report, auditing scores) should use "low"/"minimal"
   * to cut latency; leave unset to use the provider's configured default.
   */
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
  /** Short label for observability (ai_call.ok/error), e.g. "fix_generate". */
  purpose: string;
}

export interface GenerateResult {
  provider: AiProviderName;
  model: string;
  text: string;
  inputTokens: number;
  /**
   * Billable output tokens — INCLUDING reasoning/"thinking" tokens, which the
   * provider reports separately but which are still generated output and still
   * consume `maxOutputTokens`. Counting only the visible text under-reports
   * cost and hides the budget exhaustion that produces an empty response.
   */
  outputTokens: number;
  /** Of `outputTokens`, how many were reasoning tokens (0 when not reported). */
  thinkingTokens?: number;
  durationMs: number;
  purpose: string;
  /** True when the result did NOT come from the requested provider succeeding
   *  (unconfigured, the call threw, or it returned no usable text) — callers
   *  must handle this, never treat a fallback as a real generation. */
  fallback: boolean;
  /** Provider stop reason when available (e.g. "MAX_TOKENS"), for diagnosis. */
  finishReason?: string;
  error?: string;
}

export interface AiProvider {
  readonly name: AiProviderName;
  /** The model id this provider will call (resolved from env at construction). */
  readonly model: string;
  /** Whether the provider has the credentials it needs, checked per call. */
  isConfigured(): boolean;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}
