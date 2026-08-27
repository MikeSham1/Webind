import { describe, expect, it } from "vitest";
import { runReport } from "./actions";
import { initialReportState } from "./report-state";

/**
 * The report form supplies the scheme (the https:// shown beside the input), so
 * a typed-in scheme means a doubled address. runReport must reject it up front
 * with a specific message — before any crawl, cookie read, or rate-limit work,
 * which is why this can run without mocking those dependencies.
 */
function form(url: string): FormData {
  const fd = new FormData();
  fd.set("url", url);
  return fd;
}

describe("runReport scheme rejection", () => {
  it.each([
    "https://example.com",
    "http://example.com",
    "HTTPS://example.com",
    "  https://example.com  ",
    "https://https://example.com",
    "ftp://example.com",
  ])("rejects a typed-in scheme: %s", async (url) => {
    const state = await runReport(initialReportState, form(url));
    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.error).toMatch(/leave off the https/i);
    }
  });
});
