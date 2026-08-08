import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const stored = await hashPassword("s3cret-pw");
    expect(await verifyPassword("s3cret-pw", stored)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("s3cret-pw");
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  it("produces a unique salted hash each time", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects malformed stored values", async () => {
    expect(await verifyPassword("x", "not-a-valid-hash")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
  });
});
