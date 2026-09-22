import { describe, expect, it } from "vitest";
import { canonicalHost } from "./store";

describe("canonicalHost", () => {
  it("collapses scheme, www, case, port, and path to one identity", () => {
    // These are all the SAME site — the whole point of storing a canonical
    // host is that a user doesn't end up with four copies of one website.
    const forms = [
      "acme.com",
      "www.acme.com",
      "https://Acme.com",
      "http://WWW.ACME.com:8080/pricing?a=1#x",
    ];
    for (const f of forms) expect(canonicalHost(f)).toBe("acme.com");
  });

  it("keeps distinct hosts distinct, including subdomains", () => {
    expect(canonicalHost("blog.acme.com")).toBe("blog.acme.com");
    expect(canonicalHost("acme.co.uk")).toBe("acme.co.uk");
    expect(canonicalHost("other.com")).toBe("other.com");
  });

  it("rejects input with no usable public host", () => {
    // A bare word or an internal name must never become someone's "site".
    expect(canonicalHost("")).toBeNull();
    expect(canonicalHost("   ")).toBeNull();
    expect(canonicalHost("localhost")).toBeNull();
    expect(canonicalHost("not a url")).toBeNull();
    expect(canonicalHost("http://")).toBeNull();
  });

  it("strips only a leading www., not a www-prefixed label", () => {
    expect(canonicalHost("wwwx.acme.com")).toBe("wwwx.acme.com");
  });
});
