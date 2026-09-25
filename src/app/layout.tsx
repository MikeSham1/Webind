import type { Metadata } from "next";
import { Space_Grotesk, Hanken_Grotesk, Archivo_Narrow } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// The label/caption face: eyebrows, gauge readouts, tiny uppercase tags. A
// condensed grotesk instead of a code-editor mono — same instrument-panel
// role (tight, technical, at home next to a scan-frame or a score dial)
// without reading as literal terminal output.
const archivoNarrow = Archivo_Narrow({
  variable: "--font-archivo-narrow",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const TITLE = "WeBind Design — AI Readiness Report";
const DESCRIPTION =
  "See how well your website is structured for AI models and search engines to understand and cite. Get your AI readiness and traditional authority scores in seconds, plus the highest-impact fixes.";

export const metadata: Metadata = {
  // Without this, the generated OpenGraph image resolves to a relative URL and
  // most scrapers drop it. APP_BASE_URL is already required in production; the
  // localhost fallback only affects local previews.
  metadataBase: new URL(process.env.APP_BASE_URL || "http://localhost:3000"),
  title: TITLE,
  description: DESCRIPTION,
  // Pre-launch: keep the whole site out of search indexes.
  robots: { index: false, follow: false, nocache: true },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "WeBind Design",
    type: "website",
  },
  twitter: {
    // The generated card is 1200x630, which is the large format — "summary"
    // would crop it to a small square thumbnail.
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${hanken.variable} ${archivoNarrow.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
