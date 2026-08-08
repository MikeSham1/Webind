import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// scrypt via Node's crypto — no native dependency, works in the container.
// Async so hashing (deliberately CPU-heavy) never blocks the event loop, which
// matters under concurrent logins on an anonymous-facing server.
const scrypt = promisify(scryptCb) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const KEYLEN = 64;

/** Hash a password as `scrypt$<salt>$<hash>` (salt + derived key, hex). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, KEYLEN)).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

/** Verify a password against a stored `scrypt$salt$hash`. Timing-safe. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hashHex] = parts;
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;
  const actual = await scrypt(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
