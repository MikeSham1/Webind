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
  /** Short label for observability (ai_call.ok/error), e.g. "fix_generate". */
  purpose: string;
}

export interface GenerateResult {
  provider: AiProviderName;
  model: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  purpose: string;
  /** True when the result did NOT come from the requested provider succeeding
   *  (unconfigured, or the call threw) — callers must handle this, never treat
   *  a fallback as a real generation. */
  fallback: boolean;
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
