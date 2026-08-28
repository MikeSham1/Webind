/**
 * Small, dependency-free Bayesian statistics for AI-visibility estimates.
 *
 * AI answers are stochastic: one probe of one engine is weak evidence, and
 * reporting it as a flat "visible / not visible" overstates what we know. So we
 * model the brand's citation rate as a Beta–Binomial: with `hits` presences out
 * of `samples` definite probes and a uniform Beta(1,1) prior, the posterior is
 * Beta(hits+1, samples-hits+1). We report its mean and an equal-tailed 95%
 * credible interval — which is honestly wide after one probe and tightens only
 * as real repeated observations accumulate.
 *
 * The interval needs the regularized incomplete beta function I_x(a,b); the
 * implementation below is the standard Lentz continued fraction (Numerical
 * Recipes) plus a Lanczos log-gamma, inverted by bisection. Pure and
 * deterministic, so it's fully unit-testable offline.
 */

/** Lanczos approximation to ln Γ(z), accurate to ~1e-10 for z > 0. */
export function logGamma(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    // Reflection formula for z < 0.5.
    return (
      Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z)
    );
  }
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Continued fraction for the incomplete beta function (Lentz's method). */
function betacf(x: number, a: number, b: number): number {
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a,b) — the CDF of Beta(a,b) at x. */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta =
    logGamma(a + b) - logGamma(a) - logGamma(b) +
    a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(lbeta);
  // Use the fraction on whichever side converges (symmetry of I_x).
  return x < (a + 1) / (a + b + 2)
    ? (front * betacf(x, a, b)) / a
    : 1 - (front * betacf(1 - x, b, a)) / b;
}

/** Mean of Beta(alpha, beta). */
export function betaMean(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

/** Invert the Beta CDF at probability p by bisection (equal-tailed use). */
function betaQuantile(p: number, alpha: number, beta: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (incompleteBeta(mid, alpha, beta) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface RateEstimate {
  /** Posterior mean citation rate, 0-1. */
  rate: number;
  /** Lower/upper bounds of the equal-tailed credible interval, 0-1. */
  lo: number;
  hi: number;
  /** Definite probes that fed the estimate. */
  samples: number;
  /** Probes where the brand was present. */
  hits: number;
}

/**
 * Beta–Binomial estimate of a citation rate from `hits` presences in `samples`
 * definite probes, with a uniform Beta(1,1) prior. `mass` is the credible-
 * interval mass (default 95%). Returns null when there were no definite probes.
 */
export function citationRateEstimate(
  hits: number,
  samples: number,
  mass = 0.95,
): RateEstimate | null {
  if (samples <= 0) return null;
  const h = Math.max(0, Math.min(hits, samples));
  const alpha = h + 1;
  const beta = samples - h + 1;
  const tail = (1 - mass) / 2;
  return {
    rate: betaMean(alpha, beta),
    lo: betaQuantile(tail, alpha, beta),
    hi: betaQuantile(1 - tail, alpha, beta),
    samples,
    hits: h,
  };
}
