import { describe, expect, it } from "vitest";
import { runReport } from "./actions";
import { initialReportState } from "./report-state";

/**
 * runReport accepts a domain OR a specific page (example.com/blog/post),
 * strips a leading http(s) scheme rather than rejecting it (pasting or
 * autocompleting a URL routinely includes one), but still rejects a port,
 * embedded credentials, or a non-http(s) scheme — and rejects adult-content
 * hosts. All of that happens before any crawl, cookie read, or rate-limit
 * work, which is why this runs without mocking those; the accepted-scheme
 * case specifically is covered at the parser level in domainInput.test.ts,
 * since accepting it here means runReport proceeds into work this file
 * deliberately doesn't mock.
 */
function form(url: string): FormData {
  const fd = new FormData();
  fd.set("url", url);
  return fd;
}

describe("runReport page-input validation", () => {
  it.each([
    "https://https://example.com", // scheme survives the strip once, still rejected
    "ftp://example.com", // non-http(s) scheme
    "example.com:8080", // explicit non-default port
    "user@example.com", // embedded credentials
    "not a domain", // whitespace
    "localhost", // single-label / internal
  ])("rejects malformed or non-page input: %s", async (url) => {
    const state = await runReport(initialReportState, form(url));
    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.error).toMatch(/domain or page|https:\/\/ or a port/i);
    }
  });

  it("rejects an adult-content domain before crawling", async () => {
    const state = await runReport(initialReportState, form("porn-example.com"));
    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.error).toMatch(/adult-content/i);
    }
  });
});
