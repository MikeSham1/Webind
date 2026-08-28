"use server";

import { generate } from "@/lib/ai/generator";
import { gemini37Provider } from "@/lib/ai/gemini";
import { checkRateLimit, formatRetryAfter } from "@/lib/rateLimit";
import { getCurrentUser } from "@/lib/auth";
import { getClientIp } from "@/lib/requestIp";
import type { PlannerState } from "./planner-state";

const PLANNER_SYSTEM = [
  "You are Webind's content strategist. Help the user think through what they are going to write before a drafting model produces the page.",
  "Your job is discovery and clarification, not drafting the finished page.",
  "Ask only questions whose answers would materially improve search intent fit, usefulness, factual grounding, differentiation, or AI/search readability.",
  "Do not interrogate the user. Ask at most 3 concise questions at a time, and skip questions already answered in the conversation.",
  "Prioritize: the page goal and search intent, target audience, concrete facts/evidence, differentiation, desired conversion/action, and important subtopics or objections.",
  "If the brief is already sufficient, say so clearly and summarize the writing direction in a compact brief instead of inventing more questions.",
  "Never invent business facts, statistics, customer results, credentials, prices, dates, or citations.",
  "Be conversational and concise.",
].join("\n");

export async function planContentAction(
  prev: PlannerState,
  formData: FormData,
): Promise<PlannerState> {
  const message = String(formData.get("message") ?? "").trim();
  const prior = prev.transcript;
  if (!message) return { status: "error", error: "Tell Gemini what you want to write.", transcript: prior };

  const user = await getCurrentUser();
  const key = user ? `content-plan:user:${user.id}` : `content-plan:ip:${await getClientIp()}`;
  const limit = checkRateLimit(key, 60 * 60 * 1000, 40);
  if (!limit.allowed) {
    return { status: "error", error: formatRetryAfter(limit.retryAfterMs), transcript: prior };
  }

  const transcript = [prior, `User: ${message}`].filter(Boolean).join("\n\n");
  const result = await generate(
    {
      system: PLANNER_SYSTEM,
      prompt: `Conversation so far:\n${transcript}\n\nRespond to the user's latest message.`,
      maxOutputTokens: 700,
      purpose: "content_plan",
    },
    { provider: gemini37Provider() },
  );

  if (result.fallback || !result.text.trim()) {
    return {
      status: "error",
      error: "Gemini planning is unavailable right now. You can still fill in the writing brief below.",
      transcript,
    };
  }

  const reply = result.text.trim();
  return {
    status: "reply",
    reply,
    transcript: `${transcript}\n\nWebind: ${reply}`,
  };
}
