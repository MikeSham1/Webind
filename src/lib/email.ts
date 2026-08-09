import { logInfo, logWarn } from "./log";

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

export interface SendEmailResult {
  delivered: boolean;
  /** Present when `delivered` is false — why nothing went out. */
  reason?: string;
}

const FROM_ADDRESS = process.env.EMAIL_FROM?.trim() || "WeBind <no-reply@webind.design>";

/**
 * Send a transactional email via Resend's HTTP API (plain fetch — no SDK
 * dependency, same pattern as the WordPress/GitHub clients). Configured with
 * `RESEND_API_KEY`; when it's unset, this degrades to a documented no-op
 * (`delivered: false, reason: "not_configured"`) rather than throwing, so
 * every caller must already handle "the email didn't actually go out" — see
 * passwordReset.ts, which logs the link server-side as a fallback.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { delivered: false, reason: "not_configured" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logWarn("email.error", { status: res.status, body: body.slice(0, 300) });
      return { delivered: false, reason: `provider returned ${res.status}` };
    }

    logInfo("email.sent", { subject: input.subject });
    return { delivered: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn("email.error", { error: message });
    return { delivered: false, reason: message };
  }
}
