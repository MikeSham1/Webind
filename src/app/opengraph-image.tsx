import { ImageResponse } from "next/og";

/**
 * The card that shows when someone shares a WeBind link in Slack, iMessage,
 * LinkedIn or X. Without one, links unfurl as a bare line of text — which is a
 * poor first impression for a product whose whole pitch is how your pages
 * present themselves to machines.
 *
 * Generated at request time rather than shipped as a binary, so it stays in
 * sync with the wordmark and palette and there's no asset to re-export.
 */

export const alt =
  "WeBind Design — find out if your site is built for AI to recommend";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Mirrors the light-theme tokens in globals.css. Inlined because ImageResponse
// renders in isolation — it has no access to the stylesheet.
const INK = "#1a1a18";
const MUTED = "#5c5c57";
const ACCENT = "#e8461e";
const PAPER = "#f2f1ed";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          padding: "72px",
        }}
      >
        <div style={{ display: "flex", fontSize: 32, fontWeight: 700, color: INK }}>
          WeBind Design
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              fontSize: 76,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              color: INK,
            }}
          >
            {/* The space belongs inside the text, not as a margin: a margin
                also indents the accent word when the line wraps to it. */}
            <span>Find out if your site is built for AI to&nbsp;</span>
            <span style={{ color: ACCENT }}>recommend.</span>
          </div>
          <div style={{ display: "flex", marginTop: 28, fontSize: 28, color: MUTED }}>
            AI readiness and traditional authority scores, plus the fixes to climb.
          </div>
        </div>

        {/* A rule in the accent, echoing the site's scan-frame edge. */}
        <div style={{ display: "flex", height: 8, width: 160, background: ACCENT }} />
      </div>
    ),
    size,
  );
}
