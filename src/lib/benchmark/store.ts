import { and, desc, eq, gte } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { benchmarkRuns } from "@/lib/db/schema";
import { EMPTY_BENCHMARK_PROGRESS, type BenchmarkProgress } from "./benchmark";

/**
 * Persistence for resumable benchmark runs. Every function is fail-soft (never
 * throws, and a missing database just means "not resumable" rather than
 * blocking the run) — matching every other store in this codebase.
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

/** A `running` row is only offered for resume within this window — older ones are treated as abandoned. */
const RESUMABLE_WINDOW_MS = 30 * 60 * 1000;

/**
 * Find an in-progress run for this exact user + url + query, or start a fresh
 * one. `id` is null when persistence is off — callers should still run
 * end-to-end (just without checkpointing) rather than blocking on it.
 */
export async function startOrResumeBenchmarkRun(
  userId: string,
  url: string,
  query: string,
): Promise<{ id: string | null; progress: BenchmarkProgress }> {
  const fallback: { id: string | null; progress: BenchmarkProgress } = {
    id: null,
    progress: EMPTY_BENCHMARK_PROGRESS,
  };
  return withDb("startOrResumeBenchmarkRun", fallback, async (db) => {
    const cutoff = new Date(Date.now() - RESUMABLE_WINDOW_MS);
    const [existing] = await db
      .select()
      .from(benchmarkRuns)
      .where(
        and(
          eq(benchmarkRuns.userId, userId),
          eq(benchmarkRuns.url, url),
          eq(benchmarkRuns.query, query),
          eq(benchmarkRuns.status, "running"),
          gte(benchmarkRuns.updatedAt, cutoff),
        ),
      )
      .orderBy(desc(benchmarkRuns.updatedAt))
      .limit(1);
    if (existing) return { id: existing.id, progress: existing.progress };

    const [row] = await db
      .insert(benchmarkRuns)
      .values({ userId, url, query, status: "running", progress: EMPTY_BENCHMARK_PROGRESS })
      .returning({ id: benchmarkRuns.id });
    return { id: row?.id ?? null, progress: EMPTY_BENCHMARK_PROGRESS };
  });
}

/** Checkpoint progress after a unit of work completes. Best-effort. */
export async function saveBenchmarkProgress(id: string | null, progress: BenchmarkProgress): Promise<void> {
  if (!id) return;
  await withDb("saveBenchmarkProgress", undefined, async (db) => {
    await db
      .update(benchmarkRuns)
      .set({ progress, updatedAt: new Date() })
      .where(eq(benchmarkRuns.id, id));
  });
}

/**
 * Mark a run finished. `failed` means it errored cleanly (nothing left to
 * resume — the next request starts fresh); a run that never reaches either
 * status (the process died mid-flight) stays `running` with its last
 * checkpoint, which is exactly the resumable case.
 */
export async function finishBenchmarkRun(id: string | null, status: "done" | "failed"): Promise<void> {
  if (!id) return;
  await withDb("finishBenchmarkRun", undefined, async (db) => {
    await db.update(benchmarkRuns).set({ status, updatedAt: new Date() }).where(eq(benchmarkRuns.id, id));
  });
}
