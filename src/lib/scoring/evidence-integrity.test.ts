import { describe, expect, it } from "vitest";
import { analyzeEvidence, scoreEvidence } from "./evidence-integrity";
import { makePage } from "./test-fixtures";

/** A page whose HTML body is `body`, on host acme.com, citing `outbound`. */
function page(body: string, outbound: string[] = []) {
  return makePage({
    url: "https://acme.com/article",
    html: `<html><body>${body}</body></html>`,
    outboundLinks: outbound,
  });
}

describe("analyzeEvidence", () => {
  it("counts claim-bearing blocks and their in-place citations", () => {
    const p = page(
      `<p>Revenue grew 42% last year, per <a href="https://sec.gov/filing">the SEC filing</a>.</p>
       <p>We processed 1,200 orders in Q3.</p>
       <p>Our team loves coffee.</p>`,
      ["https://sec.gov/filing"],
    );
    const a = analyzeEvidence(p);
    expect(a.claims).toBe(2); // two blocks carry figures; the coffee line doesn't
    expect(a.supportedClaims).toBe(1); // only the first cites a source in place
    expect(a.coverage).toBeCloseTo(0.5, 6);
    expect(a.distinctSources).toBe(1);
  });

  it("does not count a self-link as an external citation", () => {
    const p = page(
      `<p>We shipped 500 units, see <a href="https://acme.com/stats">our stats</a>.</p>`,
      ["https://acme.com/stats"],
    );
    const a = analyzeEvidence(p);
    expect(a.claims).toBe(1);
    expect(a.supportedClaims).toBe(0); // same host — not an independent source
    expect(a.distinctSources).toBe(0);
  });
});

describe("scoreEvidence", () => {
  it("no longer rewards stacking unsourced numbers", () => {
    const stuffed = page(
      `<p>10 20 30 40 things. 55% of 99 items at $123 each over 2024 and 2025.</p>`,
    );
    // Many figures, zero citations → low, not high.
    expect(scoreEvidence(stuffed).score).toBeLessThan(40);
  });

  it("rewards claims that are cited in place", () => {
    const sourced = page(
      `<p>LCP improved 30%, per <a href="https://web.dev/lcp">web.dev</a>.</p>
       <p>Conversions rose 12%, per <a href="https://research.org/x">the study</a>.</p>`,
      ["https://web.dev/lcp", "https://research.org/x"],
    );
    const r = scoreEvidence(sourced);
    expect(r.analysis.coverage).toBe(1);
    expect(r.score).toBeGreaterThan(70);
    expect(r.fix).toBeNull();
  });

  it("flags the count of unsupported claims in its fix", () => {
    const r = scoreEvidence(
      page(`<p>Grew 42%.</p><p>Cut costs 18%.</p><p>Added 90 features.</p>`),
    );
    expect(r.fix).toMatch(/cite the primary source/i);
    expect(r.reason).toMatch(/3 of 3/);
  });

  it("doesn't tank a claim-free ARTICLE, but doesn't inflate it either", () => {
    const prose = makePage({
      url: "https://acme.com/blog/thoughts", // article by URL
      html: `<html><body><p>We believe in craft and care for our customers.</p></body></html>`,
      outboundLinks: [],
    });
    const s = scoreEvidence(prose).score;
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(30);
  });

  it("does not penalize a homepage for lacking cited claims", () => {
    const home = makePage({
      url: "https://acme.com/",
      html: `<html><body><p>We build widgets for small businesses.</p></body></html>`,
      outboundLinks: [],
    });
    const r = scoreEvidence(home);
    expect(r.score).toBeGreaterThanOrEqual(60); // neutral, not tanked
    expect(r.fix).toBeNull(); // no "cite your sources" nag on a homepage
    expect(r.reason).toMatch(/not an evidence-first page/i);
  });

  it("keeps the strict citation standard for articles", () => {
    const article = makePage({
      url: "https://acme.com/blog/data", // article
      html: `<html><body><p>Grew 42%.</p><p>Cut costs 18%.</p></body></html>`,
      outboundLinks: [],
    });
    const r = scoreEvidence(article);
    expect(r.fix).toMatch(/cite the primary source/i);
  });
});
