import { afterEach, describe, expect, it, vi } from "vitest";
import { attachEmail, saveReportRequest } from "./leads";
import { getDb } from "./db";
import type { ReportResult } from "./scoring/types";

afterEach(() => {
  vi.unstubAllEnvs();
});

const report: ReportResult = {
  url: "https://example.com",
  ai: { total: 40, signals: [] },
  traditional: { total: 55, signals: [] },
  prioritizedFixes: [],
};

describe("persistence without DATABASE_URL (fail-soft)", () => {
  it("getDb returns null when DATABASE_URL is unset", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(getDb()).toBeNull();
  });

  it("saveReportRequest returns null and never throws", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await expect(saveReportRequest(report)).resolves.toBeNull();
  });

  it("attachEmail returns false and never throws", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await expect(attachEmail("some-id", "a@b.com")).resolves.toBe(false);
  });
});
