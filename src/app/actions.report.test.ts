import { describe, expect, it } from "vitest";
import { runReport } from "./actions";
import { initialReportState } from "./report-state";

/**
 * runReport must reject anything except a bare domain before any crawl, cookie
 * read, or rate-limit work, which is why this can run without mocking those
 * dependencies.
 */
function form(url: string): FormData {
  const fd = new FormData();
  fd.set("url", url);
  return fd;
}

describe("runReport domain validation", () => {
  it.each([
    "https://example.com",
    "http://example.com",
    "HTTPS://example.com",
    "  https://example.com  ",
    "https://https://example.com",
    "ftp://example.com",
    "example.com/path",
    "example.com?ref=test",
    "example.com:443",
    "not a domain",
  ])("rejects malformed or non-domain input: %s", async (url) => {
    const state = await runReport(initialReportState, form(url));
    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.error).toMatch(/only a domain/i);
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
