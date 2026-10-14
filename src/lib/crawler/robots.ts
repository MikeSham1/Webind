/**
 * robots.txt parsing and matching (RFC 9309).
 *
 * Two consumers: crawl.ts reports whether each AI bot is shut out of a site
 * (a scoring signal about the site), and the site scan checks whether OUR
 * crawler may fetch a given path before crawling it (our own etiquette).
 */

export interface RobotsGroup {
  /** User-agent tokens, lowercased. */
  agents: string[];
  disallows: string[];
  allows: string[];
  /** Seconds from a `Crawl-delay` line, when present and valid. */
  crawlDelay: number | null;
  hasRules: boolean;
}

/** Parse robots.txt into user-agent groups (agents lowercased). */
export function parseRobotsGroups(robotsTxt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;

  const startGroup = (): RobotsGroup => {
    const group: RobotsGroup = {
      agents: [],
      disallows: [],
      allows: [],
      crawlDelay: null,
      hasRules: false,
    };
    groups.push(group);
    return group;
  };

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      // A user-agent line after rules starts a fresh group.
      if (!current || current.hasRules) current = startGroup();
      current.agents.push(value.toLowerCase());
    } else if (field === "disallow") {
      if (!current) current = startGroup();
      current.hasRules = true;
      current.disallows.push(value);
    } else if (field === "allow") {
      if (!current) current = startGroup();
      current.hasRules = true;
      current.allows.push(value);
    } else if (field === "crawl-delay") {
      if (!current) current = startGroup();
      current.hasRules = true;
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) current.crawlDelay = seconds;
    }
  }

  return groups;
}

/**
 * The groups that govern `ua`: every group naming it (RFC 9309 merges them),
 * otherwise the `*` wildcard groups.
 */
export function groupsFor(groups: RobotsGroup[], ua: string): RobotsGroup[] {
  const b = ua.toLowerCase();
  const named = groups.filter((g) => g.agents.includes(b));
  return named.length > 0 ? named : groups.filter((g) => g.agents.includes("*"));
}

/**
 * Whether a robots.txt rule pattern matches a path. Supports the `*` wildcard
 * and a trailing `$` end anchor; otherwise a rule is a path prefix.
 */
function ruleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const pattern = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}${anchored ? "$" : ""}`).test(path);
}

/**
 * RFC 9309 path check for `ua`: the longest matching rule wins, and `Allow`
 * wins a tie. An empty `Disallow:` blocks nothing. No matching rule → allowed.
 */
export function isPathAllowed(groups: RobotsGroup[], ua: string, path: string): boolean {
  let best: { length: number; allow: boolean } | null = null;
  for (const group of groupsFor(groups, ua)) {
    const rules = [
      ...group.allows.map((r) => ({ r, allow: true })),
      ...group.disallows.map((r) => ({ r, allow: false })),
    ];
    for (const { r, allow } of rules) {
      if (!r || !ruleMatches(r, path)) continue;
      if (
        !best ||
        r.length > best.length ||
        (r.length === best.length && allow && !best.allow)
      ) {
        best = { length: r.length, allow };
      }
    }
  }
  return best ? best.allow : true;
}

/** The largest `Crawl-delay` (seconds) set for `ua`, or null when none is. */
export function crawlDelayFor(groups: RobotsGroup[], ua: string): number | null {
  const delays = groupsFor(groups, ua)
    .map((g) => g.crawlDelay)
    .filter((d): d is number => d !== null);
  return delays.length > 0 ? Math.max(...delays) : null;
}

/**
 * The product token robots.txt groups address, taken from a full user-agent
 * string: "WebindBot/1.0 (+https://…)" → "webindbot".
 */
export function productToken(userAgent: string): string {
  return (userAgent.trim().split(/[\s/]/)[0] ?? "").toLowerCase();
}

/**
 * Paths that close off the whole site. `Disallow: /*` is as common in the wild
 * as `Disallow: /` and means the same thing, so matching only the bare slash
 * read a fully-blocked site as wide open.
 */
const ROOT_PATHS = new Set(["/", "/*"]);

/**
 * True when a group shuts out the entire site. An explicit `Allow:` of the root
 * within the same group re-opens what the `Disallow` closed, which is how sites
 * express "block everything except…" — treating that as a full block was a
 * false positive.
 */
function groupBlocksRoot(group: RobotsGroup): boolean {
  if (!group.disallows.some((d) => ROOT_PATHS.has(d))) return false;
  return !group.allows.some((a) => ROOT_PATHS.has(a));
}

/**
 * Per RFC 9309, a crawler is evaluated against ITS OWN most-specific group: a
 * group naming that bot if one exists, otherwise the `*` wildcard group. Bots
 * are independent — naming GPTBot does not change how ClaudeBot is judged, so
 * `User-agent: * Disallow: /` plus an `Allow` for GPTBot alone blocks every
 * other bot but not GPTBot.
 */
export function robotsBlocksBot(groups: RobotsGroup[], ua: string): boolean {
  return groupsFor(groups, ua).some(groupBlocksRoot);
}
