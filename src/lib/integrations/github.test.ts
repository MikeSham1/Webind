import { describe, it, expect } from "vitest";
import { mergeRobotsTxt } from "./github";

const FRAGMENT = "User-agent: GPTBot\nAllow: /";

describe("mergeRobotsTxt", () => {
  it("uses the generated fragment when there is no existing file", () => {
    expect(mergeRobotsTxt("", FRAGMENT)).toBe(FRAGMENT);
  });

  it("preserves every existing line and appends only missing AI bots", () => {
    const existing = [
      "User-agent: *",
      "Disallow: /admin/",
      "",
      "Sitemap: https://acme.com/sitemap.xml",
    ].join("\n");

    const merged = mergeRobotsTxt(existing, FRAGMENT);

    // Nothing existing is lost.
    expect(merged).toContain("Disallow: /admin/");
    expect(merged).toContain("Sitemap: https://acme.com/sitemap.xml");
    // Each AI bot without a group is added.
    for (const bot of ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "OAI-SearchBot"]) {
      expect(merged).toContain(`User-agent: ${bot}`);
    }
  });

  it("does not duplicate a bot that already has a group", () => {
    const existing = "User-agent: GPTBot\nDisallow: /private/";
    const merged = mergeRobotsTxt(existing, FRAGMENT);
    // The existing GPTBot rule is respected (not overridden or duplicated).
    expect(merged.match(/User-agent:\s*GPTBot/gi)?.length).toBe(1);
    expect(merged).toContain("Disallow: /private/");
    // Other AI bots are still added.
    expect(merged).toContain("User-agent: ClaudeBot");
  });

  it("leaves the file untouched when every AI bot is already addressed", () => {
    const existing = [
      "User-agent: GPTBot",
      "Allow: /",
      "User-agent: OAI-SearchBot",
      "Allow: /",
      "User-agent: ClaudeBot",
      "Allow: /",
      "User-agent: PerplexityBot",
      "Allow: /",
      "User-agent: Google-Extended",
      "Allow: /",
    ].join("\n");
    expect(mergeRobotsTxt(existing, FRAGMENT)).toBe(existing);
  });
});
