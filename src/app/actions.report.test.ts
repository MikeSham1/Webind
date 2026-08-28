import { describe, expect, it } from "vitest";
import { runReport } from "./actions";
import { initialReportState } from "./report-state";

/**
 * runReport accepts a domain OR a specific page (example.com/blog/post) but not
 * a scheme or a port, and rejects adult-content hosts — all before any crawl,
 * cookie read, or rate-limit work, which is why this runs without mocking those.
 */
function form(url: string): FormData {
  const fd = new FormData();
  fd.set("url", url);
  return fd;
}

describe("runReport page-input validation", () => {
  it.each([
    "https://example.com", // scheme (the field supplies it)
    "http://example.com",
    "HTTPS://example.com",
    "  https://example.com  ",
    "https://https://example.com",
    "ftp://example.com",
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
