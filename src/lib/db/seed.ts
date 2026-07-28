import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";

interface SeedSpec {
  email: string;
  password: string;
  isAdmin: boolean;
}

/**
 * Seed accounts come from env, so no credentials live in the repo:
 *   SEED_USER_EMAIL  / SEED_USER_PASSWORD   → a regular account
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD  → an admin account
 * A pair is only seeded when both halves are present.
 */
function seedsFromEnv(): SeedSpec[] {
  const specs: SeedSpec[] = [];
  const { SEED_USER_EMAIL, SEED_USER_PASSWORD, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } =
    process.env;
  if (SEED_USER_EMAIL && SEED_USER_PASSWORD) {
    specs.push({ email: SEED_USER_EMAIL, password: SEED_USER_PASSWORD, isAdmin: false });
  }
  if (SEED_ADMIN_EMAIL && SEED_ADMIN_PASSWORD) {
    specs.push({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD, isAdmin: true });
  }
  return specs;
}

/**
 * Create (or re-sync) the seed accounts. Idempotent: an existing account has
 * its password and admin flag reset to match env, so rotating the env values
 * and redeploying updates the account. Never throws — a seed failure must not
 * stop the server from booting.
 */
export async function seedAccounts(): Promise<void> {
  const db = getDb();
  if (!db) return;
  const specs = seedsFromEnv();
  if (specs.length === 0) return;

  for (const spec of specs) {
    const email = spec.email.trim().toLowerCase();
    try {
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existing) {
        await db
          .update(users)
          .set({ passwordHash: hashPassword(spec.password), isAdmin: spec.isAdmin })
          .where(eq(users.id, existing.id));
        console.log(`[seed] synced ${email}${spec.isAdmin ? " (admin)" : ""}`);
      } else {
        await db
          .insert(users)
          .values({ email, passwordHash: hashPassword(spec.password), isAdmin: spec.isAdmin });
        console.log(`[seed] created ${email}${spec.isAdmin ? " (admin)" : ""}`);
      }
    } catch (err) {
      console.error(`[seed] failed for ${email}:`, err);
    }
  }
}
