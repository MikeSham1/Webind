"use client";

/**
 * Last-resort boundary: an error in the ROOT LAYOUT itself.
 *
 * This replaces the root layout when it renders, so the fonts and
 * globals.css it imports are not available — everything here is inline and
 * self-contained on purpose. It must also supply its own <html> and <body>.
 *
 * Rare by design, and the reason it exists is that the alternative is a
 * completely blank white page.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#f2f1ed",
          color: "#1a1a18",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: "32rem" }}>
          <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#e8461e" }}>
            WeBind Design
          </p>
          <h1 style={{ margin: "8px 0 0", fontSize: "2rem", lineHeight: 1.2, fontWeight: 600 }}>
            The site hit an unexpected error
          </h1>
          <p style={{ margin: "16px 0 0", fontSize: "15px", lineHeight: 1.6, color: "#5c5c57" }}>
            This one is on us. Reloading usually clears it.
          </p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              marginTop: "24px",
              height: "44px",
              padding: "0 24px",
              borderRadius: "999px",
              border: "none",
              background: "#e8461e",
              color: "#fff",
              fontSize: "15px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ margin: "24px 0 0", fontSize: "12px", color: "#5c5c57" }}>
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
