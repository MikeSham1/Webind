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
 * Create the seed accounts if they don't exist yet; never rewrite an
 * existing one's password. This runs on every server boot (see
 * instrumentation.ts) — a Railway restart, redeploy, or scale event — not
 * just once, and it used to reset an existing account's password to the env
 * value every single time. That silently undid a real password change the
 * moment the process next restarted, for as long as anyone forgot to unset
 * SEED_*_PASSWORD after initial setup. Password RECOVERY for a seeded
 * account is the normal forgot-password flow, same as any other account —
 * this seeder's job is only "does the account exist at all yet."
 *
 * `isAdmin` is still synced on an existing account: unlike a password, an
 * operator flipping SEED_ADMIN_EMAIL to a different address (or wanting to
 * grant/revoke admin) is a deliberate config decision to apply, not a
 * self-service action of the account holder's that this could clobber.
 * Never throws — a seed failure must not stop the server from booting.
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
        .select({ id: users.id, isAdmin: users.isAdmin })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existing) {
        if (existing.isAdmin !== spec.isAdmin) {
          await db.update(users).set({ isAdmin: spec.isAdmin }).where(eq(users.id, existing.id));
          console.log(`[seed] updated admin flag for ${email} -> ${spec.isAdmin}`);
        }
      } else {
        // Pre-verified: this account was provisioned by whoever controls the
        // deployment's env vars, not self-registered, so there's no email
        // ownership left to confirm.
        await db.insert(users).values({
          email,
          passwordHash: await hashPassword(spec.password),
          isAdmin: spec.isAdmin,
          emailVerifiedAt: new Date(),
        });
        console.log(`[seed] created ${email}${spec.isAdmin ? " (admin)" : ""}`);
      }
    } catch (err) {
      console.error(`[seed] failed for ${email}:`, err);
    }
  }
}
