import { describe, it, expect } from "vitest";
import { isFollowableLink, isLowValuePath, pageKey, siteHost } from "./links";

describe("siteHost", () => {
  it("lowercases and strips a leading www.", () => {
    expect(siteHost("WWW.Acme.com")).toBe("acme.com");
    expect(siteHost("blog.acme.com")).toBe("blog.acme.com");
  });
});

describe("pageKey", () => {
  it("treats www, trailing slash, and fragment variants as one page", () => {
    const key = pageKey("https://acme.com/about");
    expect(pageKey("https://www.acme.com/about/")).toBe(key);
    expect(pageKey("http://acme.com/about#team")).toBe(key);
  });

  it("treats a directory index file as the directory", () => {
    expect(pageKey("https://www.acme.com/index.html")).toBe(pageKey("https://acme.com/"));
    expect(pageKey("https://acme.com/blog/index.php")).toBe(pageKey("https://acme.com/blog/"));
    expect(pageKey("https://acme.com/index-of-things")).toBe("acme.com/index-of-things");
  });

  it("keeps the root path and distinguishes queries", () => {
    expect(pageKey("https://acme.com")).toBe("acme.com/");
    expect(pageKey("https://acme.com/?p=1")).not.toBe(pageKey("https://acme.com/?p=2"));
  });
});

describe("isFollowableLink", () => {
  it("accepts same-site pages, www-insensitive", () => {
    expect(isFollowableLink("https://acme.com/pricing", "acme.com")).toBe(true);
    expect(isFollowableLink("https://www.acme.com/blog/post.html", "acme.com")).toBe(true);
  });

  it("rejects other hosts, including subdomains", () => {
    expect(isFollowableLink("https://other.com/", "acme.com")).toBe(false);
    expect(isFollowableLink("https://shop.acme.com/", "acme.com")).toBe(false);
  });

  it("rejects files, query-string variants, and non-http links", () => {
    expect(isFollowableLink("https://acme.com/brochure.PDF", "acme.com")).toBe(false);
    expect(isFollowableLink("https://acme.com/logo.png", "acme.com")).toBe(false);
    expect(isFollowableLink("https://acme.com/shop?sort=price", "acme.com")).toBe(false);
    expect(isFollowableLink("mailto:hi@acme.com", "acme.com")).toBe(false);
    expect(isFollowableLink("not a url", "acme.com")).toBe(false);
  });
});

describe("isLowValuePath", () => {
  it("flags utility, archive and pagination pages", () => {
    for (const path of ["/cart", "/checkout/", "/account.html", "/my-account/orders", "/wp-login.php", "/tag/sale", "/author/jane/", "/feed", "/blog/page/3", "/search"]) {
      expect(isLowValuePath(`https://acme.com${path}`), path).toBe(true);
    }
  });

  it("leaves real pages alone, including ones that merely contain those words", () => {
    for (const path of ["/", "/products", "/about.html", "/blog/how-to-tag-photos", "/cartography", "/accountants", "/pages/faq"]) {
      expect(isLowValuePath(`https://acme.com${path}`), path).toBe(false);
    }
  });
});
