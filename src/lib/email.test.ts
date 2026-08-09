import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "./email";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sendEmail", () => {
  it("returns not_configured when RESEND_API_KEY is unset, without calling fetch", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendEmail({ to: "a@example.com", subject: "Hi", text: "Body" });
    expect(result).toEqual({ delivered: false, reason: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("delivers via Resend when configured and the API accepts it", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: "abc" }), { status: 200 })),
    );

    const result = await sendEmail({ to: "a@example.com", subject: "Hi", text: "Body" });
    expect(result).toEqual({ delivered: true });
  });

  it("reports failure without throwing when the provider rejects the request", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad request", { status: 400 })),
    );

    const result = await sendEmail({ to: "a@example.com", subject: "Hi", text: "Body" });
    expect(result.delivered).toBe(false);
    expect(result.reason).toMatch(/400/);
  });

  it("reports failure without throwing on a network error", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const result = await sendEmail({ to: "a@example.com", subject: "Hi", text: "Body" });
    expect(result).toEqual({ delivered: false, reason: "network down" });
  });
});
