import { afterEach, describe, it, expect, vi } from "vitest";
import {
  generate,
  selectProvider,
  fakeProvider,
  setFakeResponse,
} from "./generator";
import { geminiModelId } from "./gemini";

const req = { system: "s", prompt: "p", purpose: "test" };

afterEach(() => {
  setFakeResponse("{}");
  vi.unstubAllEnvs();
});

describe("selectProvider", () => {
  it("defaults to gemini", () => {
    vi.stubEnv("FIX_GENERATOR_PROVIDER", "");
    expect(selectProvider().name).toBe("gemini");
  });

  it("honors FIX_GENERATOR_PROVIDER", () => {
    expect(selectProvider("anthropic").name).toBe("anthropic");
    expect(selectProvider("fake").name).toBe("fake");
  });

  it("uses GEMINI_GENERATOR_MODEL when set, else the 3.7 Flash default", () => {
    vi.stubEnv("GEMINI_GENERATOR_MODEL", "");
    expect(geminiModelId()).toBe("gemini-3.7-flash");
    vi.stubEnv("GEMINI_GENERATOR_MODEL", "gemini-3.5-flash");
    expect(geminiModelId()).toBe("gemini-3.5-flash");
  });
});

describe("generate", () => {
  it("returns the provider's text on success", async () => {
    setFakeResponse('{"ok":true}');
    const r = await generate(req, { provider: fakeProvider() });
    expect(r.text).toBe('{"ok":true}');
    expect(r.fallback).toBe(false);
    expect(r.provider).toBe("fake");
  });

  it("degrades to a fallback result (never throws) when the provider fails", async () => {
    setFakeResponse(null); // forces the fake to throw
    const r = await generate(req, { provider: fakeProvider() });
    expect(r.fallback).toBe(true);
    expect(r.text).toBe("");
    expect(r.error).toMatch(/forced failure/);
  });

  it("degrades to a fallback result when the provider is unconfigured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const r = await generate(req, { provider: selectProvider("gemini") });
    expect(r.fallback).toBe(true);
    expect(r.error).toMatch(/not configured/);
  });
});
