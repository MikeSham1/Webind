import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  fixCandidates,
  fixReviews,
  fixRuns,
  modelVersions,
  pageSnapshots,
  type FixCandidateRow,
  type FixRunRow,
} from "@/lib/db/schema";
import type { PageSnapshot } from "./snapshot";
import type { FixContextPackage } from "./types";
import type { GenerateFixesOutcome } from "./generate";
import { PROMPT_VERSION } from "./prompt";

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

/**
 * Persist a full generation: the immutable snapshot, the run, and every
 * candidate with its validation verdict. Best-effort — a DB hiccup never breaks
 * the user's fix flow. Returns the run id (and snapshot id) or nulls.
 *
 * The snapshot is stored HERE, at generation time, on purpose — the
 * recommendation is bound to the exact page state it was based on, never a
 * page re-crawled later.
 */
export async function persistFixRun(
  snapshot: PageSnapshot,
  ctx: FixContextPackage,
  outcome: GenerateFixesOutcome,
  userId: string | null = null,
): Promise<{ runId: string; snapshotId: string } | null> {
  return withDb("persistFixRun", null, async (db) => {
    const [snap] = await db
      .insert(pageSnapshots)
      .values({
        userId,
        url: snapshot.url,
        host: snapshot.host,
        contentHash: snapshot.contentHash,
        pageType: snapshot.pageType,
        locale: snapshot.locale,
        snapshot,
      })
      .returning({ id: pageSnapshots.id });
    if (!snap) return null;

    const [run] = await db
      .insert(fixRuns)
      .values({
        userId,
        snapshotId: snap.id,
        signalKey: ctx.signalKey,
        category: ctx.allowedCategory,
        diagnosis: ctx.diagnosis,
        generatorProvider: outcome.generation.provider,
        generatorModel: outcome.generation.model,
        promptVersion: PROMPT_VERSION,
        queryCluster: ctx.queryCluster ?? null,
        engine: null,
      })
      .returning({ id: fixRuns.id });
    if (!run) return null;

    const rows = [
      ...outcome.accepted.map((candidate) => ({ candidate, validationOk: true, failures: [] as string[] })),
      ...outcome.rejected.map((r) => ({
        candidate: r.candidate,
        validationOk: false,
        failures: r.result.failures,
      })),
    ];
    if (rows.length > 0) {
      await db.insert(fixCandidates).values(
        rows.map((r) => ({
          runId: run.id,
          candidate: r.candidate,
          validationOk: r.validationOk,
          validationFailures: r.failures,
        })),
      );
    }

    return { runId: run.id, snapshotId: snap.id };
  });
}

/** A run plus its candidates, for the review UI. */
export async function getRunWithCandidates(
  runId: string,
): Promise<{ run: FixRunRow; candidates: FixCandidateRow[] } | null> {
  return withDb("getRunWithCandidates", null, async (db) => {
    const [run] = await db.select().from(fixRuns).where(eq(fixRuns.id, runId)).limit(1);
    if (!run) return null;
    const candidates = await db
      .select()
      .from(fixCandidates)
      .where(eq(fixCandidates.runId, runId))
      .orderBy(desc(fixCandidates.validationOk));
    return { run, candidates };
  });
}

/**
 * The user who owns the run a candidate belongs to (via fix_runs.userId), or
 * null. Used to enforce that a review can only be submitted by the run's owner
 * — the same owner-only boundary the rest of the app uses.
 */
export async function candidateOwnerUserId(candidateId: string): Promise<string | null> {
  return withDb("candidateOwnerUserId", null, async (db) => {
    const [row] = await db
      .select({ userId: fixRuns.userId })
      .from(fixCandidates)
      .innerJoin(fixRuns, eq(fixCandidates.runId, fixRuns.id))
      .where(eq(fixCandidates.id, candidateId))
      .limit(1);
    return row?.userId ?? null;
  });
}

export type ReviewDecision =
  | "accepted_unedited"
  | "accepted_minor_edit"
  | "accepted_major_edit"
  | "rejected"
  | "skipped";

/**
 * Record the human's judgment on a candidate — the highest-value learning
 * signal. On an edit, `humanFinal` is the real training target, not the
 * model's original text. Never flattened into a downstream reward.
 */
export async function saveReview(input: {
  candidateId: string;
  reviewerUserId: string | null;
  decision: ReviewDecision;
  humanFinal?: string | null;
  rejectionReason?: string | null;
}): Promise<string | null> {
  return withDb("saveReview", null, async (db) => {
    const [row] = await db
      .insert(fixReviews)
      .values({
        candidateId: input.candidateId,
        reviewerUserId: input.reviewerUserId,
        decision: input.decision,
        humanFinal: input.humanFinal ?? null,
        rejectionReason: input.rejectionReason ?? null,
      })
      .returning({ id: fixReviews.id });
    return row?.id ?? null;
  });
}

/** Register a model/prompt/reranker version. Promotion is recorded, never a delete. */
export async function registerModelVersion(input: {
  kind: "generator" | "reranker" | "fix_value";
  provider: string;
  model: string;
  versionLabel: string;
  metadata?: Record<string, unknown>;
}): Promise<string | null> {
  return withDb("registerModelVersion", null, async (db) => {
    const [row] = await db
      .insert(modelVersions)
      .values({ ...input, metadata: input.metadata ?? null })
      .returning({ id: modelVersions.id });
    return row?.id ?? null;
  });
}
