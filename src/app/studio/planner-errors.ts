/**
 * Provider failure -> something the reader can act on.
 *
 * Deliberately NOT in planner-actions.ts: that file carries a top-level
 * `use server`, which marks every export as a Server Function and requires it
 * to be async. This is a pure function, and keeping it here makes it directly
 * testable instead of reachable only through a server action.
 */

const BRIEF_FALLBACK = "You can still fill in the writing brief below.";

/**
 * Never echoes the raw provider message (it can carry request URLs and other
 * noise) and never touches the key. The distinction that matters to a reader
 * is: is this mine to fix, or should I just try again?
 */
export function plannerErrorFor(raw: string | undefined): string {
  // Google returns the same condition in several spellings — PERMISSION_DENIED,
  // "permission denied", api_key_invalid — so flatten separators once rather
  // than trying to list every variant at each branch.
  const e = (raw ?? "").toLowerCase().replace(/[_-]+/g, " ");

  if (!raw || e.includes("not configured")) {
    return `AI planning isn't switched on for this deployment — GEMINI_API_KEY is missing. ${BRIEF_FALLBACK}`;
  }
  if (
    e.includes("api key not valid") ||
    e.includes("api key invalid") ||
    e.includes("unauthenticated") ||
    e.includes("permission denied") ||
    e.includes("401") ||
    e.includes("403")
  ) {
    return `Google rejected this deployment's Gemini key. Check GEMINI_API_KEY and that the Generative Language API is enabled for its project. ${BRIEF_FALLBACK}`;
  }
  if (
    e.includes("quota") ||
    e.includes("resource exhausted") ||
    e.includes("rate limit") ||
    e.includes("429")
  ) {
    return `The Gemini quota for this deployment is used up. It resets on Google's schedule — or raise the limit on the API project. ${BRIEF_FALLBACK}`;
  }
  if (e.includes("maxoutputtokens") || e.includes("max tokens")) {
    return `The planner ran out of room before it finished answering. Try a shorter message. ${BRIEF_FALLBACK}`;
  }
  if (e.includes("not found") || e.includes("404")) {
    return `This deployment is pointed at a Gemini model Google doesn't serve (check GEMINI_GENERATOR_MODEL). ${BRIEF_FALLBACK}`;
  }
  if (e.includes("safety")) {
    return `Gemini declined to answer that one. Try rephrasing. ${BRIEF_FALLBACK}`;
  }
  return `Gemini planning is temporarily unavailable — please try again. ${BRIEF_FALLBACK}`;
}
