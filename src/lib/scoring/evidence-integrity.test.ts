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

describe("analyzeEvidence: what is and isn't a claim", () => {
  it("doesn't read WordPress's encoded punctuation as statistics", () => {
    // wptexturize serves every curly apostrophe/quote/dash as a numeric entity.
    const a = analyzeEvidence(
      page(
        `<p>It&#8217;s the way we&#8217;ve always worked &#8212; slowly.</p>
         <p>&#8220;Quality first&#8221; is more than a slogan.</p>
         <p>Plans start at &#36;19 a month.</p>`,
      ),
    );
    expect(a.claims).toBe(1); // only the decoded "$19" is a figure
  });

  it("ignores years, dates, phone numbers, and reading time, but not figures beside them", () => {
    const a = analyzeEvidence(
      page(
        `<p>Since 2019 we have helped teams across the 1990s web.</p>
         <p>Updated 2026-03-03 · 12 min read</p>
         <p>Posted 03/03/2026. Call (512) 555-0142.</p>
         <p>Revenue grew 40% in 2023.</p>
         <p>Seats cost $2000 each.</p>`,
      ),
    );
    expect(a.claims).toBe(2); // the 40% and the $2000
  });

  it("excludes nav, header, and footer chrome from claims and sources", () => {
    const a = analyzeEvidence(
      page(
        `<header><nav><ul><li><a href="/pricing">Pricing from $19/mo</a></li>
           <li>Top 10 tools</li></ul></nav></header>
         <p>Cut costs 18%, per <a href="https://bls.gov/x">BLS data</a>.</p>
         <footer><p>123 Main St, Austin, TX 78701</p>
           <a href="https://facebook.com/acme">Facebook</a>
           <a href="https://linkedin.com/company/acme">LinkedIn</a></footer>`,
      ),
    );
    expect(a.claims).toBe(1);
    expect(a.supportedClaims).toBe(1);
    expect(a.distinctSources).toBe(1); // bls.gov, not the footer's social icons
  });

  it("never counts a share button as a citation or a source", () => {
    const a = analyzeEvidence(
      page(
        `<blockquote>73% of buyers research online first.
           <a href="https://twitter.com/intent/tweet?text=73%25">Tweet this</a></blockquote>
         <p><a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a></p>`,
      ),
    );
    expect(a.claims).toBe(1);
    expect(a.supportedClaims).toBe(0);
    expect(a.distinctSources).toBe(0);
  });

  it("counts a data table as one claim, supported by its figure caption", () => {
    // The WordPress table block: <figure><table/><figcaption/></figure>.
    const table = `<table><tr><th>Metric</th><th>Good</th></tr>
      <tr><td>LCP</td><td>2.5 s</td></tr><tr><td>CLS</td><td>0.10</td></tr></table>`;
    const captioned = analyzeEvidence(
      page(
        `<figure class="wp-block-table">${table}
           <figcaption>Source: <a href="https://web.dev/vitals">web.dev</a></figcaption></figure>`,
      ),
    );
    expect(captioned.claims).toBe(1);
    expect(captioned.supportedClaims).toBe(1);

    const bare = analyzeEvidence(page(table));
    expect(bare.claims).toBe(1); // one table, not one claim per numeric cell
    expect(bare.supportedClaims).toBe(0);
  });

  it("treats a table of paragraphs as layout and grades the paragraphs", () => {
    const a = analyzeEvidence(
      page(
        `<table><tr><td><p>Grew 42%, per <a href="https://sec.gov/f">the filing</a>.</p>
           <p>Cut costs 18%.</p></td></tr></table>`,
      ),
    );
    expect(a.claims).toBe(2);
    expect(a.supportedClaims).toBe(1);
  });
});

describe("scoreEvidence on a realistic article", () => {
  it("doesn't tell a fully cited article that its claims are unsourced", () => {
    const article = makePage({
      url: "https://acme.com/blog/page-speed",
      html: `<html><body>
        <header><nav><ul><li><a href="/pricing">Pricing from $19/mo</a></li></ul></nav></header>
        <main><article>
          <p>By Jane Doe · Updated March 3, 2026 · 8 min read</p>
          <p>Pages that load in under 2.5 seconds convert 32% better, according to
             <a href="https://web.dev/vitals">Google&#8217;s research</a>.</p>
          <p>A 100ms delay cut conversions by 7% in
             <a href="https://akamai.com/report">Akamai&#8217;s 2017 study</a>.</p>
          <p>Since 2019 we&#8217;ve helped teams speed up their sites.</p>
        </article></main>
        <footer><p>© 2026 Acme Inc.</p><p>123 Main St, Austin, TX 78701</p></footer>
      </body></html>`,
      outboundLinks: ["https://web.dev/vitals", "https://akamai.com/report"],
    });
    const r = scoreEvidence(article);
    expect(r.analysis.claims).toBe(2);
    expect(r.analysis.coverage).toBe(1);
    expect(r.fix).toBeNull();
    expect(r.score).toBeGreaterThan(70);
  });
});
