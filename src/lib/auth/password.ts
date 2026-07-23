import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt via Node's crypto — no native dependency, works in the container.
const KEYLEN = 64;

/** Hash a password as `scrypt$<salt>$<hash>` (salt + derived key, hex). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, KEYLEN).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

/** Verify a password against a stored `scrypt$salt$hash`. Timing-safe. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hashHex] = parts;
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
