/**
 * Turn a raw User-Agent string into a short, human label ("Chrome on
 * Windows") for a session list. Deliberately a small heuristic, not a full
 * parser dependency — this is display-only, never used for any decision.
 */
export function summarizeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";

  const browser = /edg\//i.test(userAgent)
    ? "Edge"
    : /chrome\//i.test(userAgent)
      ? "Chrome"
      : /firefox\//i.test(userAgent)
        ? "Firefox"
        : /safari\//i.test(userAgent) && !/chrome/i.test(userAgent)
          ? "Safari"
          : "A browser";

  // iOS checked before macOS: an iPhone/iPad UA always includes "like Mac OS X"
  // for WebKit compatibility, so checking macOS first would misclassify it.
  const os = /windows/i.test(userAgent)
    ? "Windows"
    : /iphone|ipad|ipod/i.test(userAgent)
      ? "iOS"
      : /mac os x|macintosh/i.test(userAgent)
        ? "macOS"
        : /android/i.test(userAgent)
          ? "Android"
          : /linux/i.test(userAgent)
            ? "Linux"
            : null;

  return os ? `${browser} on ${os}` : browser;
}
