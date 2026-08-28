import { describe, expect, it } from "vitest";
import {
  DOMAIN_INPUT_ERROR,
  RESTRICTED_DOMAIN_ERROR,
  isRestrictedHostname,
  parseDomainInput,
  parsePageInput,
} from "./domainInput";

describe("parseDomainInput", () => {
  it.each([
    ["example.com", "example.com"],
    ["  EXAMPLE.COM  ", "example.com"],
    ["www.example.co.uk", "www.example.co.uk"],
    ["münich.example", "xn--mnich-kva.example"],
  ])("accepts a bare domain: %s", (raw, domain) => {
    expect(parseDomainInput(raw)).toEqual({
      ok: true,
      domain,
      url: `https://${domain}/`,
    });
  });

  it.each([
    "",
    "example",
    "https://example.com",
    "example.com/",
    "example.com/pricing",
    "example.com?ref=test",
    "example.com#section",
    "example.com:443",
    "user@example.com",
    "two domains.com",
    "-example.com",
    "example-.com",
    "example..com",
    "example.123",
    "127.0.0.1",
    "localhost.local",
  ])("rejects malformed or non-public domain input: %s", (raw) => {
    expect(parseDomainInput(raw)).toEqual({
      ok: false,
      error: DOMAIN_INPUT_ERROR,
      reason: "invalid",
    });
  });

  it.each([
    "example.xxx",
    "porn-example.com",
    "nsfw.example.com",
    "subdomain.pornhub.com",
  ])("rejects adult-content domains: %s", (raw) => {
    expect(parseDomainInput(raw)).toEqual({
      ok: false,
      error: RESTRICTED_DOMAIN_ERROR,
      reason: "restricted",
    });
  });

  it("does not reject benign domains that merely contain 'sex'", () => {
    expect(isRestrictedHostname("essex.ac.uk")).toBe(false);
    expect(isRestrictedHostname("sussex.com")).toBe(false);
  });
});

describe("parsePageInput", () => {
  it("accepts a bare domain and canonicalizes to the root", () => {
    expect(parsePageInput("Example.com")).toEqual({
      ok: true,
      domain: "example.com",
      url: "https://example.com/",
    });
  });

  it("accepts a specific page path and preserves it (with query, minus fragment)", () => {
    expect(parsePageInput("example.com/blog/my-post?ref=x#top")).toEqual({
      ok: true,
      domain: "example.com",
      url: "https://example.com/blog/my-post?ref=x",
    });
  });

  it.each([
    "https://example.com", // scheme
    "example.com:8080", // explicit port
    "user@example.com", // credentials
    "has space.com", // whitespace
    "localhost", // internal / single-label
  ])("rejects non-page input: %s", (raw) => {
    const r = parsePageInput(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid");
  });

  it("rejects an adult-content host with the restricted reason", () => {
    const r = parsePageInput("pornhub.com/page");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("restricted");
      expect(r.error).toBe(RESTRICTED_DOMAIN_ERROR);
    }
  });
});
