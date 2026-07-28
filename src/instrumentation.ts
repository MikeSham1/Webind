/**
 * Runs once when the server starts. We use it to seed the configured accounts
 * (see SEED_* env vars) after migrations have applied. Guarded to the Node.js
 * runtime and dynamically imported so the edge runtime never pulls in the DB
 * driver.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { seedAccounts } = await import("@/lib/db/seed");
  await seedAccounts();
}
