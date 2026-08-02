import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hasEncryptionKey } from "./crypto";

const VALID_KEY = Buffer.alloc(32, 7).toString("base64");

describe("credential encryption", () => {
  afterEach(() => {
    delete process.env.CREDENTIALS_KEY;
  });

  it("reports no key configured when CREDENTIALS_KEY is unset", () => {
    delete process.env.CREDENTIALS_KEY;
    expect(hasEncryptionKey()).toBe(false);
  });

  it("round-trips a secret", () => {
    process.env.CREDENTIALS_KEY = VALID_KEY;
    const ciphertext = encryptSecret("xxxx xxxx xxxx xxxx xxxx xxxx");
    expect(ciphertext).not.toContain("xxxx");
    expect(decryptSecret(ciphertext)).toBe("xxxx xxxx xxxx xxxx xxxx xxxx");
  });

  it("throws encrypting without a configured key", () => {
    delete process.env.CREDENTIALS_KEY;
    expect(() => encryptSecret("secret")).toThrow();
  });

  it("fails closed (null, not throw) decrypting without a configured key", () => {
    process.env.CREDENTIALS_KEY = VALID_KEY;
    const ciphertext = encryptSecret("secret");
    delete process.env.CREDENTIALS_KEY;
    expect(decryptSecret(ciphertext)).toBeNull();
  });

  it("fails closed on tampered ciphertext", () => {
    process.env.CREDENTIALS_KEY = VALID_KEY;
    const ciphertext = encryptSecret("secret");
    const [iv, tag, data] = ciphertext.split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 0xff;
    const tampered = [iv, tag, flipped.toString("base64")].join(":");
    expect(decryptSecret(tampered)).toBeNull();
  });

  it("fails closed decrypting with the wrong key", () => {
    process.env.CREDENTIALS_KEY = VALID_KEY;
    const ciphertext = encryptSecret("secret");
    process.env.CREDENTIALS_KEY = Buffer.alloc(32, 9).toString("base64");
    expect(decryptSecret(ciphertext)).toBeNull();
  });
});
