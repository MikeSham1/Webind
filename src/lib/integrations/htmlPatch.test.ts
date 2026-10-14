import { describe, it, expect } from "vitest";
import { htmlFileCandidates, missingMetaTags, patchHtmlHead, upsertHeadBlock } from "./htmlPatch";

const PAGE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>Acme</title>
  </head>
  <body><h1>Acme</h1></body>
</html>
`;
const SCHEMA = '<script type="application/ld+json">\n{"@type":"Organization"}\n</script>';

describe("htmlFileCandidates", () => {
  it("maps page URLs to the static files that could serve them", () => {
    expect(htmlFileCandidates("https://acme.com/")).toEqual(["index.html", "public/index.html", "docs/index.html"]);
    expect(htmlFileCandidates("https://acme.com/shop.html")).toEqual(["shop.html", "public/shop.html", "docs/shop.html"]);
    expect(htmlFileCandidates("https://acme.com/about/")).toEqual([
      "about/index.html", "public/about/index.html", "docs/about/index.html",
    ]);
    expect(htmlFileCandidates("https://acme.com/about").slice(0, 2)).toEqual(["about.html", "about/index.html"]);
  });

  it("refuses server templates and path tricks", () => {
    expect(htmlFileCandidates("https://acme.com/index.php")).toEqual([]);
    // The URL parser resolves encoded dot-segments first, so they can never
    // climb out of the site: no candidate path ever contains "..".
    for (const url of ["https://acme.com/a/%2e%2e/%2e%2e/secret.html", "https://acme.com/a/../../x"]) {
      expect(htmlFileCandidates(url).every((p) => !p.split("/").includes(".."))).toBe(true);
    }
    expect(htmlFileCandidates("not a url")).toEqual([]);
  });
});

describe("upsertHeadBlock", () => {
  it("inserts a marked block just before </head>, matching indentation", () => {
    const out = upsertHeadBlock(PAGE, "schema", SCHEMA)!;
    expect(out).toContain('    <!-- WeBind:schema:start -->\n    <script type="application/ld+json">');
    expect(out).toContain("    <!-- WeBind:schema:end -->\n  </head>");
    // Nothing else moved.
    expect(out.replace(/\n\s*<!-- WeBind:schema:start -->[\s\S]*<!-- WeBind:schema:end -->/, "")).toBe(PAGE);
  });

  it("replaces its own block on a re-run instead of stacking a second one", () => {
    const once = upsertHeadBlock(PAGE, "schema", SCHEMA)!;
    const twice = upsertHeadBlock(once, "schema", SCHEMA.replace("Organization", "Store"))!;
    expect(twice.match(/WeBind:schema:start/g)).toHaveLength(1);
    expect(twice).toContain('"@type":"Store"');
    expect(twice).not.toContain('"@type":"Organization"');
  });

  it("refuses a file with no </head> (a fragment or template partial)", () => {
    expect(upsertHeadBlock("<div>partial</div>", "schema", SCHEMA)).toBeNull();
  });
});

describe("missingMetaTags", () => {
  const meta = '<title>Acme</title>\n<meta name="description" content="Widgets.">';

  it("never duplicates a title or description the owner already wrote", () => {
    expect(missingMetaTags(PAGE, meta)).toBe('<meta name="description" content="Widgets.">');
    const withDesc = PAGE.replace("<title>", '<meta content="Hi" name="description">\n<title>');
    expect(missingMetaTags(withDesc, meta)).toBe("");
  });

  it("adds a title when the existing one is empty", () => {
    expect(missingMetaTags(PAGE.replace("<title>Acme</title>", "<title> </title>"), meta)).toContain("<title>Acme</title>");
  });
});

describe("patchHtmlHead", () => {
  it("adds schema and only the missing meta tags", () => {
    const out = patchHtmlHead(PAGE, { schema: SCHEMA, meta: '<title>X</title>\n<meta name="description" content="Widgets.">' })!;
    expect(out).toContain("WeBind:schema:start");
    expect(out).toContain('<meta name="description" content="Widgets.">');
    expect(out.match(/<title>/g)).toHaveLength(1);
  });

  it("returns null when nothing would change or the file can't be patched", () => {
    const patched = patchHtmlHead(PAGE, { schema: SCHEMA })!;
    expect(patchHtmlHead(patched, { schema: SCHEMA })).toBeNull();
    expect(patchHtmlHead("<p>no head</p>", { schema: SCHEMA })).toBeNull();
    expect(patchHtmlHead(PAGE, { meta: "<title>Acme</title>" })).toBeNull();
  });
});
