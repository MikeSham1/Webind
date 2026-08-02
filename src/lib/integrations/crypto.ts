import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // NIST-recommended for GCM
const KEY_LENGTH = 32; // AES-256

/**
 * The configured credential-encryption key, or null when unset (fail closed).
 *
 * Generate one with `openssl rand -base64 32`. Required to store a WordPress
 * Application Password — without it, connecting a site is refused rather than
 * writing the secret to the database unencrypted.
 */
function encryptionKey(): Buffer | null {
  const raw = process.env.CREDENTIALS_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === KEY_LENGTH ? key : null;
}

export function hasEncryptionKey(): boolean {
  return encryptionKey() !== null;
}

/**
 * Encrypt a secret (e.g. a WordPress Application Password) for storage.
 * Returns `iv:authTag:ciphertext`, each base64. Throws if CREDENTIALS_KEY is
 * unset or malformed — callers must check {@link hasEncryptionKey} first so
 * that's a configuration error, not a runtime surprise.
 */
export function encryptSecret(plaintext: string): string {
  const key = encryptionKey();
  if (!key) {
    throw new Error(
      "CREDENTIALS_KEY is not configured — cannot encrypt a secret for storage.",
    );
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString("base64")).join(":");
}

/**
 * Decrypt a secret produced by {@link encryptSecret}. Returns null (never
 * throws) on a missing key or any tampering/corruption — a failed decrypt
 * should read as "connection unusable," not crash whatever called it.
 */
export function decryptSecret(payload: string): string | null {
  const key = encryptionKey();
  if (!key) return null;
  const parts = payload.split(":");
  if (parts.length !== 3) return null;
  try {
    const [iv, authTag, ciphertext] = parts.map((p) => Buffer.from(p, "base64"));
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
