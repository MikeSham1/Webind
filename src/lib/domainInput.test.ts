import { describe, expect, it } from "vitest";
import {
  DOMAIN_INPUT_ERROR,
  RESTRICTED_DOMAIN_ERROR,
  isRestrictedHostname,
  parseDomainInput,
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
