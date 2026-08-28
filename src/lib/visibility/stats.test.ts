import { describe, expect, it } from "vitest";
import {
  betaMean,
  citationRateEstimate,
  incompleteBeta,
  logGamma,
} from "./stats";

describe("logGamma", () => {
  it("matches known values (Γ(n) = (n-1)!)", () => {
    expect(Math.exp(logGamma(5))).toBeCloseTo(24, 5); // 4!
    expect(Math.exp(logGamma(1))).toBeCloseTo(1, 6);
    // Γ(1/2) = √π
    expect(Math.exp(logGamma(0.5))).toBeCloseTo(Math.sqrt(Math.PI), 6);
  });
});

describe("incompleteBeta (Beta CDF)", () => {
  it("is 0 at 0 and 1 at 1", () => {
    expect(incompleteBeta(0, 2, 3)).toBe(0);
    expect(incompleteBeta(1, 2, 3)).toBe(1);
  });

  it("is 0.5 at the median of a symmetric Beta", () => {
    expect(incompleteBeta(0.5, 2, 2)).toBeCloseTo(0.5, 6);
    expect(incompleteBeta(0.5, 5, 5)).toBeCloseTo(0.5, 6);
  });

  it("is monotonically increasing", () => {
    let prev = 0;
    for (let x = 0.1; x <= 0.9; x += 0.1) {
      const v = incompleteBeta(x, 3, 5);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it("matches the uniform special case I_x(1,1) = x", () => {
    expect(incompleteBeta(0.3, 1, 1)).toBeCloseTo(0.3, 6);
    expect(incompleteBeta(0.72, 1, 1)).toBeCloseTo(0.72, 6);
  });
});

describe("citationRateEstimate", () => {
  it("returns null with no probes", () => {
    expect(citationRateEstimate(0, 0)).toBeNull();
  });

  it("is honestly uncertain after a single probe", () => {
    const seen = citationRateEstimate(1, 1)!;
    // Beta(2,1): mean 2/3, but the interval must be very wide — one probe is
    // weak evidence, and the estimate should say so.
    expect(seen.rate).toBeCloseTo(2 / 3, 6);
    expect(seen.lo).toBeLessThan(0.25);
    expect(seen.hi).toBeGreaterThan(0.97);
    expect(seen.hi - seen.lo).toBeGreaterThan(0.6);
  });

  it("centres on 0.5 and tightens as samples accumulate", () => {
    const few = citationRateEstimate(5, 10)!;
    const many = citationRateEstimate(50, 100)!;
    expect(few.rate).toBeCloseTo(0.5, 6);
    expect(many.rate).toBeCloseTo(0.5, 6);
    // More data ⇒ narrower interval.
    expect(many.hi - many.lo).toBeLessThan(few.hi - few.lo);
    expect(many.lo).toBeGreaterThan(0.39);
    expect(many.hi).toBeLessThan(0.61);
  });

  it("the credible interval brackets the mean and stays in [0,1]", () => {
    for (const [h, n] of [[0, 3], [2, 3], [7, 20], [19, 20]] as const) {
      const e = citationRateEstimate(h, n)!;
      expect(e.lo).toBeGreaterThanOrEqual(0);
      expect(e.hi).toBeLessThanOrEqual(1);
      expect(e.lo).toBeLessThanOrEqual(e.rate);
      expect(e.rate).toBeLessThanOrEqual(e.hi);
    }
  });

  it("clamps hits to the sample count", () => {
    expect(citationRateEstimate(5, 3)!.hits).toBe(3);
  });

  it("agrees with betaMean", () => {
    // 3 of 4 present → Beta(4,2), mean 4/6.
    expect(citationRateEstimate(3, 4)!.rate).toBeCloseTo(betaMean(4, 2), 6);
  });
});
