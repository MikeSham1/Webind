import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies a correct password", () => {
    const stored = hashPassword("s3cret-pw");
    expect(verifyPassword("s3cret-pw", stored)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const stored = hashPassword("s3cret-pw");
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("produces a unique salted hash each time", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("rejects malformed stored values", () => {
    expect(verifyPassword("x", "not-a-valid-hash")).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
  });
});
