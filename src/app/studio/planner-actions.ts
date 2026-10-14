"use server";

import { generate } from "@/lib/ai/generator";
import { gemini37Provider } from "@/lib/ai/gemini";
import { checkRateLimit, formatRetryAfter } from "@/lib/rateLimit";
import { getCurrentUser } from "@/lib/auth";
import { getClientIp } from "@/lib/requestIp";
import { logWarn } from "@/lib/log";
import { plannerErrorFor } from "./planner-errors";
import { latestReportForHost, listSites, resolveActiveSite } from "@/lib/sites/store";
import { clearPlannerConversation, savePlannerConversation } from "@/lib/content/planner-store";
import { transcriptText, type PlannerMessage, type PlannerState } from "./planner-state";

const PLANNER_SYSTEM = [
  "You are Webind's content strategist. Help the user think through what they are going to write before a drafting model produces the page.",
  "Your job is discovery and clarification, not drafting the finished page.",
  "Ask only questions whose answers would materially improve search intent fit, usefulness, factual grounding, differentiation, or AI/search readability.",
  "Do not interrogate the user. Ask at most 3 concise questions at a time, and skip questions already answered in the conversation.",
  "Prioritize: the page goal and search intent, target audience, concrete facts/evidence, differentiation, desired conversion/action, and important subtopics or objections.",
  "If the brief is already sufficient, say so clearly and summarize the writing direction in a compact brief instead of inventing more questions.",
  "Never invent business facts, statistics, customer results, credentials, prices, dates, or citations.",
  "Be conversational and concise.",
  "No markdown — the reply renders as plain chat text, so write emphasis in plain words instead of *asterisks* or **bold**.",
].join("\n");

/**
 * A short, factual note telling the model which website the user means — their
 * active site plus its latest scores, and the other sites they own so "the
 * other one" is resolvable. Returns null when we genuinely don't know, so the
 * model is never told a site that isn't theirs.
 */
async function buildSiteContext(userId: string, active: { id: string; host: string }): Promise<string> {
  const lines = [
    `The user's website is ${active.host}. When they say "my site", "the site",`,
    `or "the page" without naming a domain, they mean ${active.host} — do not ask`,
    `them which website they mean.`,
  ];

  const report = await latestReportForHost(userId, active.host);
  if (report?.aiTotal !== null && report?.aiTotal !== undefined) {
    lines.push(
      `Its most recent WeBind scores: AI Readiness ${report.aiTotal}/100, ` +
        `Traditional Authority ${report.traditionalTotal ?? "n/a"}/100.`,
    );
  }

  const all = await listSites(userId);
  if (all.length > 1) {
    const others = all.filter((s) => s.id !== active.id).map((s) => s.host);
    lines.push(
      `They also work on: ${others.join(", ")}. If it's ambiguous which of these ` +
        `a request is about, ask once rather than guessing.`,
    );
  }

  lines.push("Never invent facts about the site beyond what is stated here.");
  return lines.join(" ");
}

export async function planContentAction(
  prev: PlannerState,
  formData: FormData,
): Promise<PlannerState> {
  const message = String(formData.get("message") ?? "").trim();
  const prior = prev.messages;
  if (!message) {
    return { status: "error", error: "Tell Gemini what you want to write.", messages: prior };
  }

  const user = await getCurrentUser();
  const key = user ? `content-plan:user:${user.id}` : `content-plan:ip:${await getClientIp()}`;
  const limit = checkRateLimit(key, 60 * 60 * 1000, 40);
  if (!limit.allowed) {
    return { status: "error", error: formatRetryAfter(limit.retryAfterMs), messages: prior };
  }

  // Which website is this conversation about? Nobody should have to paste a URL
  // into every message, so resolve it from the user's known sites (discovered
  // from their own reports) and hand it to the model as context. Also the
  // scope key for saving this conversation — see the siteId comment on the
  // planner_conversations schema for why the conversation itself is
  // per-site, not just per-user.
  let siteContext: string | null = null;
  let siteId: string | null = null;
  if (user) {
    const activeSite = await resolveActiveSite(user.id);
    if (activeSite) {
      siteContext = await buildSiteContext(user.id, activeSite);
      siteId = activeSite.id;
    }
  }

  const messages: PlannerMessage[] = [...prior, { role: "user", text: message }];
  const result = await generate(
    {
      system: siteContext ? `${PLANNER_SYSTEM}\n\n${siteContext}` : PLANNER_SYSTEM,
      prompt: `Conversation so far:\n${transcriptText(messages)}\n\nRespond to the user's latest message.`,
      // Reasoning tokens are drawn from this same budget. At the old 700 with
      // the provider's MEDIUM thinking, a turn could spend the whole budget
      // thinking and return NO text — which surfaced as "unavailable" even
      // though the call succeeded. Ask for low thinking (this is conversational
      // discovery, not deep reasoning) and leave real headroom for the reply.
      maxOutputTokens: 2048,
      thinkingLevel: "low",
      purpose: "content_plan",
    },
    { provider: gemini37Provider() },
  );

  if (result.fallback || !result.text.trim()) {
    // The cause used to be thrown away here, so a missing key, a rejected key,
    // an exhausted quota and a starved token budget all read as one unexplained
    // "unavailable" — with nothing to act on. Log the provider's own message,
    // and tell the user which KIND of failure it is so they know whether it's
    // theirs to fix (config) or just transient (retry).
    logWarn("content_plan.unavailable", {
      userId: user?.id,
      provider: result.provider,
      model: result.model,
      finishReason: result.finishReason,
      error: result.error,
    });
    // The user's message still counts as part of the conversation even though
    // the model failed to reply — save it so a retry doesn't also lose it.
    if (user) await savePlannerConversation(user.id, siteId, messages);
    return { status: "error", error: plannerErrorFor(result.error), messages };
  }

  const reply = result.text.trim();
  const withReply = [...messages, { role: "assistant" as const, text: reply }];
  if (user) await savePlannerConversation(user.id, siteId, withReply);
  return { status: "reply", reply, messages: withReply };
}

/**
 * "Start over" in the planner: clears the saved conversation so a fresh page
 * load doesn't resurrect it. Anonymous visitors have nothing saved server-side
 * (see planContentAction) — this is a no-op for them, matching the client's
 * own reset of its local state either way.
 */
export async function clearPlannerConversationAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const activeSite = await resolveActiveSite(user.id);
  await clearPlannerConversation(user.id, activeSite?.id ?? null);
}
