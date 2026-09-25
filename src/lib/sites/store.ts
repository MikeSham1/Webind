import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { reportRequests, sites, type SiteRow } from "@/lib/db/schema";
import { canonicalHost } from "@/lib/domainInput";

export { canonicalHost };

/**
 * A user's websites — the context that lets the product know which site
 * someone means without asking them to re-enter a URL.
 *
 * Sites are discovered rather than requested: `touchSite` records the host on
 * every report/scan a signed-in user runs, and `syncSitesFromReports` backfills
 * a new account from report history it already has. Every function is
 * fail-soft (returns empty/false when persistence is off) and never throws.
 */

type Database = NonNullable<ReturnType<typeof getDb>>;

async function withDb<T>(label: string, fallback: T, fn: (db: Database) => Promise<T>): Promise<T> {
  const db = getDb();
  if (!db) return fallback;
  try {
    return await fn(db);
  } catch (err) {
    console.error(`${label} failed:`, err);
    return fallback;
  }
}

/** Every site for a user: primary first, then most recently seen. */
export async function listSites(userId: string): Promise<SiteRow[]> {
  return withDb("listSites", [], (db) =>
    db
      .select()
      .from(sites)
      .where(eq(sites.userId, userId))
      .orderBy(desc(sites.isPrimary), desc(sites.lastSeenAt)),
  );
}

/**
 * Record that a user just worked on `url`. Inserts the site the first time and
 * bumps `lastSeenAt` after that. The user's FIRST site becomes primary
 * automatically, so a single-site user never has to choose anything.
 */
export async function touchSite(userId: string, url: string): Promise<void> {
  const host = canonicalHost(url);
  if (!host) return;
  await withDb("touchSite", undefined, async (db) => {
    const existing = await db.select().from(sites).where(eq(sites.userId, userId)).limit(1);
    const isFirst = existing.length === 0;
    await db
      .insert(sites)
      .values({ userId, host, isPrimary: isFirst })
      .onConflictDoUpdate({
        target: [sites.userId, sites.host],
        set: { lastSeenAt: new Date() },
      });
  });
}

/**
 * Backfill a user's sites from the reports they've already run. Called when an
 * account first needs site context, so an existing user doesn't start empty —
 * this is how we "ascertain how many websites the user is using" without
 * interrogating them.
 *
 * Returns the number of sites the user has afterwards.
 */
export async function syncSitesFromReports(userId: string): Promise<number> {
  return withDb("syncSitesFromReports", 0, async (db) => {
    const rows = await db
      .select({ url: reportRequests.url, createdAt: reportRequests.createdAt })
      .from(reportRequests)
      .where(eq(reportRequests.userId, userId))
      .orderBy(desc(reportRequests.createdAt));

    // Most recent first, so the newest host wins the "first site is primary" rule.
    const seen = new Set<string>();
    for (const row of rows) {
      const host = canonicalHost(row.url);
      if (!host || seen.has(host)) continue;
      seen.add(host);
      await touchSite(userId, host);
    }
    const all = await db.select({ id: sites.id }).from(sites).where(eq(sites.userId, userId));
    return all.length;
  });
}

/**
 * The site to use as context right now: the primary one, else the most recent.
 * Backfills from report history once if the user has no sites yet, so the
 * first Studio conversation after signup already knows the site.
 */
export async function resolveActiveSite(userId: string): Promise<SiteRow | null> {
  const existing = await listSites(userId);
  if (existing.length > 0) return existing[0];
  await syncSitesFromReports(userId);
  const backfilled = await listSites(userId);
  return backfilled[0] ?? null;
}

/** Make one of the user's sites the default context. Returns false if not theirs. */
export async function setPrimarySite(userId: string, siteId: string): Promise<boolean> {
  return withDb("setPrimarySite", false, async (db) => {
    const [owned] = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.id, siteId), eq(sites.userId, userId)))
      .limit(1);
    if (!owned) return false;
    // Clear then set, so the "at most one primary" invariant always holds.
    await db.update(sites).set({ isPrimary: false }).where(eq(sites.userId, userId));
    await db.update(sites).set({ isPrimary: true }).where(eq(sites.id, siteId));
    return true;
  });
}

/** Add a site by hand (e.g. before the first report has been run on it). */
export async function addSite(userId: string, url: string): Promise<SiteRow | null> {
  const host = canonicalHost(url);
  if (!host) return null;
  await touchSite(userId, host);
  return withDb("addSite", null, async (db) => {
    const [row] = await db
      .select()
      .from(sites)
      .where(and(eq(sites.userId, userId), eq(sites.host, host)))
      .limit(1);
    return row ?? null;
  });
}

/** Remove a site. Re-points `isPrimary` at the next one so context survives. */
export async function removeSite(userId: string, siteId: string): Promise<boolean> {
  return withDb("removeSite", false, async (db) => {
    const [row] = await db
      .select()
      .from(sites)
      .where(and(eq(sites.id, siteId), eq(sites.userId, userId)))
      .limit(1);
    if (!row) return false;
    await db.delete(sites).where(eq(sites.id, siteId));
    if (row.isPrimary) {
      const [next] = await db
        .select({ id: sites.id })
        .from(sites)
        .where(eq(sites.userId, userId))
        .orderBy(desc(sites.lastSeenAt))
        .limit(1);
      if (next) await db.update(sites).set({ isPrimary: true }).where(eq(sites.id, next.id));
    }
    return true;
  });
}

/**
 * The most recent report for a site, so AI context can include real scores
 * ("acme.com scored 62 AI readiness") instead of just a hostname.
 *
 * Filters in application code against canonicalHost(row.url), not a SQL
 * `LIKE %host%` — a substring match on the raw URL made "example.com" match
 * "notexample.com" or a path containing that text, and it also never
 * recognized a www-prefixed report as the same site as its canonical host.
 * `reportRequests` has no dedicated host column, so this reads a bounded
 * recent window per user (same trade-off `listReportsForUserHost` already
 * makes) rather than every report ever run.
 */
export async function latestReportForHost(
  userId: string,
  host: string,
): Promise<{ url: string; aiTotal: number | null; traditionalTotal: number | null } | null> {
  return withDb("latestReportForHost", null, async (db) => {
    const rows = await db
      .select({
        url: reportRequests.url,
        aiTotal: reportRequests.aiTotal,
        traditionalTotal: reportRequests.traditionalTotal,
      })
      .from(reportRequests)
      .where(eq(reportRequests.userId, userId))
      .orderBy(desc(reportRequests.createdAt))
      .limit(200);
    return rows.find((r) => canonicalHost(r.url) === host) ?? null;
  });
}
