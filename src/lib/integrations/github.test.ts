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
    // Each AI SEARCH crawler without a group is added (training crawlers are
    // deliberately never added — blocking those doesn't affect search).
    for (const bot of ["Googlebot", "OAI-SearchBot", "Claude-SearchBot", "PerplexityBot"]) {
      expect(merged).toContain(`User-agent: ${bot}`);
    }
    // A training crawler is NOT added by the merge.
    expect(merged).not.toContain("User-agent: GPTBot");
    expect(merged).not.toContain("User-agent: Google-Extended");
  });

  it("does not duplicate a bot that already has a group", () => {
    const existing = "User-agent: OAI-SearchBot\nDisallow: /private/";
    const merged = mergeRobotsTxt(existing, FRAGMENT);
    // The existing OAI-SearchBot rule is respected (not overridden or duplicated).
    expect(merged.match(/User-agent:\s*OAI-SearchBot/gi)?.length).toBe(1);
    expect(merged).toContain("Disallow: /private/");
    // Other AI search crawlers are still added.
    expect(merged).toContain("User-agent: Claude-SearchBot");
  });

  it("leaves the file untouched when every AI search crawler is already addressed", () => {
    const existing = [
      "User-agent: Googlebot",
      "Allow: /",
      "User-agent: OAI-SearchBot",
      "Allow: /",
      "User-agent: Claude-SearchBot",
      "Allow: /",
      "User-agent: PerplexityBot",
      "Allow: /",
    ].join("\n");
    expect(mergeRobotsTxt(existing, FRAGMENT)).toBe(existing);
  });
});
