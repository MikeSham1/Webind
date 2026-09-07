import { describe, it, expect, vi } from "vitest";
import { discoverSitemapUrls, parseSitemap, sitemapsFromRobots } from "./sitemap";

describe("parseSitemap", () => {
  it("extracts <loc> URLs from a urlset and classifies it", () => {
    const xml = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://acme.com/</loc></url>
        <url><loc>https://acme.com/about</loc><lastmod>2026-01-01</lastmod></url>
      </urlset>`;
    const p = parseSitemap(xml);
    expect(p.kind).toBe("urlset");
    expect(p.locs).toEqual(["https://acme.com/", "https://acme.com/about"]);
  });

  it("classifies a sitemap index and reads its child sitemaps", () => {
    const xml = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://acme.com/sitemap-1.xml</loc></sitemap>
      <sitemap><loc>https://acme.com/sitemap-2.xml</loc></sitemap>
    </sitemapindex>`;
    const p = parseSitemap(xml);
    expect(p.kind).toBe("sitemapindex");
    expect(p.locs).toHaveLength(2);
  });

  it("unwraps CDATA, decodes entities, and ignores namespaced <image:loc>", () => {
    const xml = `<urlset>
      <url><loc><![CDATA[https://acme.com/a?x=1&amp;y=2]]></loc>
        <image:image><image:loc>https://acme.com/img.png</image:loc></image:image>
      </url>
    </urlset>`;
    const p = parseSitemap(xml);
    expect(p.locs).toEqual(["https://acme.com/a?x=1&y=2"]);
  });
});

describe("sitemapsFromRobots", () => {
  it("reads Sitemap: directives, case-insensitively", () => {
    const robots =
      "User-agent: *\nDisallow: /admin\nSitemap: https://acme.com/sitemap.xml\nsitemap: https://acme.com/news.xml\n";
    expect(sitemapsFromRobots(robots)).toEqual([
      "https://acme.com/sitemap.xml",
      "https://acme.com/news.xml",
    ]);
  });
});

/** Bypasses the real (DNS-resolving) SSRF check so tests stay offline. */
const allowAll = async () => true;

/** Build an injectable fetch that serves a fixed map of URL → xml/text. */
function fakeFetch(routes: Record<string, string>): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = routes[url];
    if (body === undefined) {
      return new Response("not found", { status: 404 });
    }
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

describe("discoverSitemapUrls", () => {
  it("follows robots.txt → sitemap → page URLs, same-host only", async () => {
    const fetchImpl = fakeFetch({
      "https://acme.com/robots.txt": "Sitemap: https://acme.com/sitemap.xml\n",
      "https://acme.com/sitemap.xml": `<urlset>
        <url><loc>https://acme.com/</loc></url>
        <url><loc>https://acme.com/pricing</loc></url>
        <url><loc>https://evil.example/phish</loc></url>
      </urlset>`,
    });
    const out = await discoverSitemapUrls("acme.com", { fetchImpl, isUrlAllowed: allowAll });
    expect(out.sitemaps).toEqual(["https://acme.com/sitemap.xml"]);
    // The third-party URL is dropped — a sitemap can't make us crawl other hosts.
    expect(out.urls).toEqual(["https://acme.com/", "https://acme.com/pricing"]);
    expect(out.truncated).toBe(false);
  });

  it("recurses into a sitemap index", async () => {
    const fetchImpl = fakeFetch({
      "https://acme.com/robots.txt": "",
      "https://acme.com/sitemap.xml": `<sitemapindex>
        <sitemap><loc>https://acme.com/sitemap-a.xml</loc></sitemap>
      </sitemapindex>`,
      "https://acme.com/sitemap-a.xml": `<urlset>
        <url><loc>https://acme.com/a</loc></url>
      </urlset>`,
    });
    const out = await discoverSitemapUrls("https://acme.com", {
      fetchImpl,
      isUrlAllowed: allowAll,
    });
    expect(out.urls).toEqual(["https://acme.com/a"]);
  });

  it("caps the number of page URLs and flags truncation", async () => {
    const locs = Array.from(
      { length: 30 },
      (_, i) => `<url><loc>https://acme.com/p${i}</loc></url>`,
    ).join("");
    const fetchImpl = fakeFetch({
      "https://acme.com/robots.txt": "",
      "https://acme.com/sitemap.xml": `<urlset>${locs}</urlset>`,
    });
    const out = await discoverSitemapUrls("acme.com", {
      fetchImpl,
      maxUrls: 10,
      isUrlAllowed: allowAll,
    });
    expect(out.urls).toHaveLength(10);
    expect(out.truncated).toBe(true);
  });

  it("returns empty (never throws) when nothing is reachable", async () => {
    const fetchImpl = fakeFetch({}); // everything 404s
    const out = await discoverSitemapUrls("acme.com", { fetchImpl, isUrlAllowed: allowAll });
    expect(out).toEqual({ sitemaps: [], urls: [], truncated: false });
  });

  it("rejects an internal/invalid site without fetching", async () => {
    const fetchImpl = fakeFetch({ "any": "x" });
    const out = await discoverSitemapUrls("not a url", { fetchImpl });
    expect(out.urls).toEqual([]);
  });

  it("never contacts an internal address a redirect points at", async () => {
    // An attacker-controlled site can make its own robots.txt (a URL that
    // passes the SSRF check) 302 to an internal address. If we fetch with
    // `redirect: "follow"`, the underlying fetch chases that Location header
    // itself, with no chance for us to validate the hop first.
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      if (url === "https://acme.com/robots.txt") {
        if (init?.redirect === "manual") {
          return new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data/" },
          });
        }
        // Models what a real `redirect: "follow"` fetch does: it transparently
        // issues the follow-up request itself before we ever see a response.
        calls.push("http://169.254.169.254/latest/meta-data/");
        return new Response("secret", { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    // Models the real structural check (block the internal literal, allow the
    // rest) without doing a real DNS lookup on acme.com.
    const isUrlAllowed = async (u: string) => {
      try {
        return new URL(u).hostname !== "169.254.169.254";
      } catch {
        return false;
      }
    };

    await discoverSitemapUrls("acme.com", { fetchImpl, isUrlAllowed });

    expect(calls).not.toContain("http://169.254.169.254/latest/meta-data/");
  });

  it("uses an injected isUrlAllowed instead of a real DNS lookup", async () => {
    // Without injection, every fetch does a live DNS resolution of the site's
    // hostname — slow and flaky in a sandboxed/offline test run. An injectable
    // predicate (mirroring crawl.ts's isUrlAllowed) lets tests stay offline.
    const fetchImpl = fakeFetch({
      "https://acme.com/robots.txt": "Sitemap: https://acme.com/sitemap.xml\n",
      "https://acme.com/sitemap.xml": `<urlset>
        <url><loc>https://acme.com/</loc></url>
      </urlset>`,
    });
    const isUrlAllowed = vi.fn(async () => true);

    const out = await discoverSitemapUrls("acme.com", { fetchImpl, isUrlAllowed });

    expect(isUrlAllowed).toHaveBeenCalledWith("https://acme.com/robots.txt");
    expect(out.urls).toEqual(["https://acme.com/"]);
  });

  it("skips a URL the injected isUrlAllowed refuses", async () => {
    const fetchImpl = fakeFetch({
      "https://acme.com/robots.txt": "Sitemap: https://acme.com/sitemap.xml\n",
    });
    const out = await discoverSitemapUrls("acme.com", {
      fetchImpl,
      isUrlAllowed: async () => false,
    });
    expect(out).toEqual({ sitemaps: [], urls: [], truncated: false });
  });
});
