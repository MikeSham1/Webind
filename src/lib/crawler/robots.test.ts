import { describe, it, expect } from "vitest";
import {
  crawlDelayFor,
  isPathAllowed,
  parseRobotsGroups,
  productToken,
  robotsBlocksBot,
} from "./robots";

const allowed = (txt: string, path: string, ua = "webindbot") =>
  isPathAllowed(parseRobotsGroups(txt), ua, path);

describe("isPathAllowed", () => {
  it("allows everything when there are no rules", () => {
    expect(allowed("", "/anything")).toBe(true);
    expect(allowed("User-agent: *\nDisallow:\n", "/anything")).toBe(true);
  });

  it("blocks by path prefix", () => {
    const txt = "User-agent: *\nDisallow: /admin\n";
    expect(allowed(txt, "/admin")).toBe(false);
    expect(allowed(txt, "/admin/users")).toBe(false);
    expect(allowed(txt, "/about")).toBe(true);
  });

  it("lets the longest matching rule win, with Allow winning a tie", () => {
    const txt = "User-agent: *\nDisallow: /blog\nAllow: /blog/public\n";
    expect(allowed(txt, "/blog/private")).toBe(false);
    expect(allowed(txt, "/blog/public/post")).toBe(true);
    expect(allowed("User-agent: *\nDisallow: /a\nAllow: /a\n", "/a")).toBe(true);
  });

  it("supports * wildcards and the $ end anchor", () => {
    const txt = "User-agent: *\nDisallow: /*.pdf$\nDisallow: /*/drafts/\n";
    expect(allowed(txt, "/files/report.pdf")).toBe(false);
    expect(allowed(txt, "/files/report.pdf?x=1")).toBe(true);
    expect(allowed(txt, "/team/drafts/one")).toBe(false);
    expect(allowed(txt, "/team/final/one")).toBe(true);
  });

  it("uses a group naming our bot instead of the wildcard", () => {
    const txt = "User-agent: *\nDisallow: /\n\nUser-agent: WebindBot\nDisallow: /private\n";
    expect(allowed(txt, "/pricing")).toBe(true);
    expect(allowed(txt, "/private")).toBe(false);
    expect(allowed(txt, "/pricing", "otherbot")).toBe(false);
  });

  it("matches rule characters literally, not as regex", () => {
    expect(allowed("User-agent: *\nDisallow: /a.b\n", "/axb")).toBe(true);
    expect(allowed("User-agent: *\nDisallow: /a.b\n", "/a.b")).toBe(false);
  });
});

describe("crawlDelayFor", () => {
  it("reads Crawl-delay from the governing group", () => {
    const groups = parseRobotsGroups("User-agent: *\nCrawl-delay: 5\nDisallow: /x\n");
    expect(crawlDelayFor(groups, "webindbot")).toBe(5);
  });

  it("returns null when absent or invalid", () => {
    expect(crawlDelayFor(parseRobotsGroups("User-agent: *\nDisallow: /x\n"), "webindbot")).toBeNull();
    expect(crawlDelayFor(parseRobotsGroups("User-agent: *\nCrawl-delay: soon\n"), "webindbot")).toBeNull();
  });
});

describe("productToken", () => {
  it("extracts the lowercased token robots.txt groups address", () => {
    expect(productToken("WebindBot/1.0 (+https://webind.design/bot)")).toBe("webindbot");
    expect(productToken("Custom-Crawler")).toBe("custom-crawler");
  });
});

describe("robotsBlocksBot", () => {
  it("still detects a whole-site block for a named bot", () => {
    const groups = parseRobotsGroups("User-agent: GPTBot\nDisallow: /\n");
    expect(robotsBlocksBot(groups, "gptbot")).toBe(true);
    expect(robotsBlocksBot(groups, "claudebot")).toBe(false);
  });
});
