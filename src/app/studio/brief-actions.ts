"use server";

import { generate } from "@/lib/ai/generator";
import { gemini37Provider } from "@/lib/ai/gemini";
import { getCurrentUser } from "@/lib/auth";
import { getClientIp } from "@/lib/requestIp";
import { checkRateLimit, formatRetryAfter } from "@/lib/rateLimit";
import { logWarn } from "@/lib/log";
import { BRIEF_SYSTEM, parseBrief, type DraftBrief } from "./brief";
import { plannerErrorFor } from "./planner-errors";
import { transcriptText, type PlannerMessage } from "./planner-state";

export type BriefResult =
  | { status: "ok"; brief: DraftBrief }
  | { status: "error"; error: string };

/**
 * Turn the planning conversation into the draft form's starting values.
 *
 * Deliberately a separate, explicit step rather than something that happens as
 * you chat: the brief decides what the drafting model is allowed to assert, so
 * the user should see it land in the form and be able to correct it before
 * anything is generated.
 */
export async function buildBriefAction(
  messages: PlannerMessage[],
): Promise<BriefResult> {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { status: "error", error: "Plan something with the AI first." };
  }

  const user = await getCurrentUser();
  const key = user ? `brief:user:${user.id}` : `brief:ip:${await getClientIp()}`;
  const limit = checkRateLimit(key, 60 * 60 * 1000, 40);
  if (!limit.allowed) {
    return { status: "error", error: formatRetryAfter(limit.retryAfterMs) };
  }

  const result = await generate(
    {
      system: BRIEF_SYSTEM,
      prompt: `Planning conversation:\n${transcriptText(messages)}\n\nReturn the writing brief as JSON.`,
      json: true,
      maxOutputTokens: 2048,
      thinkingLevel: "low",
      purpose: "content_brief",
    },
    { provider: gemini37Provider() },
  );

  if (result.fallback || !result.text.trim()) {
    logWarn("content_brief.unavailable", {
      userId: user?.id,
      model: result.model,
      finishReason: result.finishReason,
      error: result.error,
    });
    return { status: "error", error: plannerErrorFor(result.error) };
  }

  const brief = parseBrief(result.text);
  if (!brief) {
    logWarn("content_brief.unparseable", { userId: user?.id, model: result.model });
    return {
      status: "error",
      error: "Couldn't turn that conversation into a brief yet — try saying what the page is about.",
    };
  }

  return { status: "ok", brief };
}
