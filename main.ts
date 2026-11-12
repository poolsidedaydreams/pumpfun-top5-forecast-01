// pumpfun-top5-forecast-01, entry v3 (Node 22, standard library only).
// No network, no API keys, no model calls; fully deterministic (fixed seed).
//
// The same Monte Carlo machinery as v1/v2 (per-coin log-cap paths with
// momentum saturation, fade hazard, graduation jumps, plus a synthetic
// newcomer field whose count scales with the horizon and whose caps come
// from the history's young top-20 coins), with six targeted repairs.
// The full diagnosis, ablation record and honest risks are in BUILD_LOG.md.
// In short, v2's split deficit was traced to three interacting defects:
//
//   1. THE LAG FIT COULD NOT REPRESENT FAST TURNOVER. fitSaturating's grid
//      floored tau at 0.5h and capped fInf at 0.8, discarded buckets with
//      fewer than 8 points, and shrank toward a slow prior (0.5, 2h). The
//      history's own lag buckets show 60-90% of top-5 slots turning over
//      within 10-30 minutes, yet the fitted curve predicted 4-10% at those
//      lags. v1 survived only because its over-drawn newcomer field inflated
//      the simulated newcomer frequency, which the max() in the unnamed-mass
//      rule mistook for the fit. v2's correct horizon-scaled count removed
//      that accidental compensation without repairing the fit, so the
//      unnamed mass collapsed exactly on newcomer-held slots. v3 repairs
//      the NEWCOMER fit only (wider grid, count-weighted buckets, a
//      single-bucket fallback, a faster prior); the FADE fit is kept
//      byte-for-byte v1/v2, because ablating a repaired fade fit cost
//      1.7 nats: lag "fade" events are mostly rank churn and recorder
//      sampling artefacts, not deaths to the tail floor.
//   2. SIZES DOUBLE-COUNTED THE FIT. The size mixture weighted the
//      newcomer-holder histogram by the order unnamed mass u, but u and
//      the simulated newcomer frequency disagree exactly when the field
//      is thin, and the newcomer conditional histogram is then a biased,
//      noisy sample. Sizes score the MARGINAL place-cap distribution, so
//      v3 mixes by the simulation's own newcomer frequency and lets the
//      field model speak for the marginal.
//   3. THE SIZE BLEND WAS HORIZON-BLIND. Blending 25% of a stationary
//      place normal helps at 7-13h (where the simulation extrapolates)
//      but drags sizes down and thins them at short horizons in a rising
//      regime. v3 gates the blend weight by horizon: ~0.02-0.06 at
//      sub-hour horizons, ~0.24 at the final's 7-13h.
//
// The remaining v3 changes: sparse marks (<10 rows) are excluded from lag
// pairs (an empty mark cannot define "seen"); the size histogram is kernel
// smoothed one bin each way (Monte Carlo histograms are noisy and the log
// score punishes near-zero bins asymmetrically); the record trend is fitted
// to the top-5 mean level instead of the single noisiest series (place 1),
// with the same shrinkage and caps. All parameters are estimated from the
// history given; nothing is hard-coded to the rehearsal. All horizons and
// times are read from task.json.
//
// Reads $MAKEFUN_INPUT_DIR (else /input), writes $MAKEFUN_OUTPUT_DIR (else /output).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const SIMS = 40000;
const SEED = 0x9e3779b9;
const MAX_CANDIDATES = 300;
const MICRO = 1_000_000;
/** The most newcomers drawn in one simulated read. */
const NEWCOMER_CAP = 200;
/** Prior weight (in lag points) shrinking each per-place newcomer fit. */
const PLACE_PRIOR_WEIGHT = 30;
/** Ceiling of the horizon-gated size-blend weight (reached at long horizons). */
const SIZE_BLEND_MAX = 0.3;
/** Half-saturation horizon (hours) of the size-blend weight. */
const SIZE_BLEND_HALF_H = 2;
/** Kernel smoothing the per-place size histogram (must sum to 1). */
const SIZE_SMOOTH_KERNEL = [0.25, 0.5, 0.25];

interface Row {
  rank: number;
  mint: string;
  market_cap_lamports: string | number;
  venue: string;
  created_at: string;
  mayhem?: boolean;
}
interface Mark { at: string; ok: boolean; rows: Row[] | null; }

const task = JSON.parse(readFileSync(join(INPUT_DIR, 'task.json'), 'utf8')) as {
  places: number; output: string; chart_size?: number;
  size: { edges: number[] }; reads: string[]; t0: string;
};
const lines = readFileSync(join(INPUT_DIR, 'history.ndjson'), 'utf8').split('\n').filter((l) => l !== '');
const marks = lines.map((l) => JSON.parse(l) as Mark).filter((m) => m.ok === true && Array.isArray(m.rows));
if (marks.length === 0) throw new Error('the history holds no ok mark');
const places = task.places;
const edges = task.size.edges;
const bins = edges.length + 1;
const CHART_SIZE = task.chart_size ?? 100;

// ---------- deterministic PRNG ----------
let rngState = SEED >>> 0;
function rnd(): number {
  rngState = (rngState + 0x6d2b79f5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
let spare: number | null = null;
function randn(): number {
  if (spare !== null) { const v = spare; spare = null; return v; }
  let u = 0;
  while (u === 0) u = rnd();
  const r = Math.sqrt(-2 * Math.log(u));
  const t = 2 * Math.PI * rnd();
  spare = r * Math.sin(t);
  return r * Math.cos(t);
}
function poisson(lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda < 30) {
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= rnd(); } while (p > L);
    return k - 1;
  }
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * randn()));
}

// ---------- trajectories ----------
const sizeOf = (lamports: string | number): number => Math.log10(Number(BigInt(lamports))) - 9;
const tMark = marks.map((m) => Date.parse(m.at) / 1000);
const tCut = tMark[tMark.length - 1]!;
const horizons = task.reads.length > 0
  ? task.reads.map((r) => Math.max(0, (Date.parse(r) / 1000 - tCut) / 3600))
  : [1]; // degenerate fallback: the competition always lists reads
const HOUR = 3600;

interface Obs { t: number; x: number; venue: string; rank: number; }
interface Coin {
  mint: string; obs: Obs[]; created: number; mayhem: boolean;
  lastX: number; lastVenue: string; lastRank: number; lastT: number;
}
const coins = new Map<string, Coin>();
for (let i = 0; i < marks.length; i++) {
  const m = marks[i]!;
  for (const r of m.rows!) {
    let c = coins.get(r.mint);
    if (!c) {
      c = { mint: r.mint, obs: [], created: Date.parse(r.created_at) / 1000, mayhem: !!r.mayhem, lastX: 0, lastVenue: r.venue, lastRank: r.rank, lastT: tMark[i]! };
      coins.set(r.mint, c);
    }
    c.obs.push({ t: tMark[i]!, x: sizeOf(r.market_cap_lamports), venue: r.venue, rank: r.rank });
    c.lastX = c.obs[c.obs.length - 1]!.x;
    c.lastVenue = r.venue;
    c.lastRank = r.rank;
    c.lastT = tMark[i]!;
    if (r.mayhem) c.mayhem = true;
  }
}
const coinList = [...coins.values()];
const sortedRows = marks.map((m) => [...m.rows!].sort((a, b) => a.rank - b.rank));

// ---------- helpers for lag analysis ----------
// For every pair of marks (i, j>i) with i in the recent window: lag in hours, and
// per-place whether the coin at that place in j was absent from ALL marks <= i
// (a "newcomer" w.r.t. i), plus whether a top-20 coin of i has faded by j.
// The recent window matters: the early explosive regime must not dominate the
// estimate for the market as it stands at the cut. Marks with almost no rows
// (v3: fewer than 10) are skipped as either end of a pair: a mark that read
// nothing cannot define what was "seen", and an empty later mark would count
// every coin as faded.
interface LagPoint { lag: number; place: number; newcomer: boolean; faded: boolean; }
function lagPoints(): LagPoint[] {
  const pts: LagPoint[] = [];
  const n = marks.length;
  const K = Math.max(6, Math.ceil(0.4 * n));
  const iMin = Math.max(0, n - K);
  for (let i = iMin; i < n; i++) {
    if (marks[i]!.rows!.length < 10) continue;
    const topI = new Set(sortedRows[i]!.slice(0, 20).map((r) => r.mint));
    const seen = new Set<string>();
    for (let k = 0; k <= i; k++) for (const r of marks[k]!.rows!) seen.add(r.mint);
    for (let j = i + 1; j < n; j++) {
      if (marks[j]!.rows!.length < 10) continue;
      const lag = (tMark[j]! - tMark[i]!) / HOUR;
      if (lag <= 0 || lag > 13) continue;
      const topJ = sortedRows[j]!.slice(0, places);
      const rankJ = new Map(marks[j]!.rows!.map((r) => [r.mint, r.rank]));
      for (let k = 0; k < topJ.length; k++) {
        pts.push({ lag, place: k + 1, newcomer: !seen.has(topJ[k]!.mint), faded: false });
      }
      for (const m of topI) {
        const rk = rankJ.get(m);
        pts.push({ lag, place: 0, newcomer: false, faded: rk === undefined || rk > 50 });
      }
    }
  }
  return pts;
}
const lagPts = lagPoints();
// Shared bucket builder for the saturating fits: points are grouped by lag
// (rounded to 10 minutes) with their newcomer/fade shares and counts.
function lagBuckets(filter: (p: LagPoint) => boolean, value: (p: LagPoint) => boolean): { pts: Array<[number, number, number]>; nEff: number } {
  const buckets = new Map<number, { n: number; s: number }>();
  let nEff = 0;
  for (const p of lagPts) {
    if (!filter(p)) continue;
    nEff++;
    const key = Math.round(p.lag * 6) / 6;
    const b = buckets.get(key) ?? { n: 0, s: 0 };
    b.n++; if (value(p)) b.s++;
    buckets.set(key, b);
  }
  const pts: Array<[number, number, number]> = [];
  for (const [lag, b] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    pts.push([lag, b.s / b.n, b.n]);
  }
  return { pts, nEff };
}
// The ORIGINAL saturating fit (v1/v2, verbatim behaviour): used ONLY for the fade curve.
// Ablation showed a repaired fade fit costs ~1.7 nats, so the fade machinery
// is deliberately left exactly as v1/v2 had it: unweighted buckets, a bucket
// needs >= 8 points, fewer than 2 usable buckets returns the prior, the grid
// floors tau at 0.5h and caps fInf at 0.8, shrinkage weight nEff/(nEff+40).
function fitSaturatingOld(filter: (p: LagPoint) => boolean, value: (p: LagPoint) => boolean, prior: { fInf: number; tau: number }): { fInf: number; tau: number } {
  const { pts: all, nEff } = lagBuckets(filter, value);
  const pts: Array<[number, number]> = all.filter(([, , n]) => n >= 8).map(([lag, s]) => [lag, s]);
  const w = nEff / (nEff + 40);
  if (pts.length < 2) return prior;
  let best = { err: Infinity, fInf: prior.fInf, tau: prior.tau };
  for (let fInf = 0.15; fInf <= 0.8; fInf += 0.05) {
    for (let tau = 0.5; tau <= 10; tau *= 1.3) {
      let err = 0;
      for (const [h, s] of pts) { const p = fInf * (1 - Math.exp(-h / tau)); err += (p - s) * (p - s); }
      if (err < best.err) best = { err, fInf, tau };
    }
  }
  return { fInf: w * best.fInf + (1 - w) * prior.fInf, tau: w * best.tau + (1 - w) * prior.tau };
}
// The REPAIRED saturating fit (v3): used for the newcomer curves only. Three
// repairs over the original: (a) the grid reaches fast turnover (tau from
// 0.08h) and near-total saturation (fInf to 0.98) — the old grid's tau floor
// of 0.5h alone capped the 10-minute newcomer share at ~0.22 no matter what
// the data said; (b) buckets are weighted by their point counts and no
// bucket is discarded, so a single informative lag is used instead of
// falling back to the prior; (c) with exactly one distinct lag, the curve
// is pinned through that bucket at the prior's tau instead of returning
// the prior untouched.
function fitSaturatingNew(filter: (p: LagPoint) => boolean, value: (p: LagPoint) => boolean, prior: { fInf: number; tau: number }): { fInf: number; tau: number } {
  const { pts, nEff } = lagBuckets(filter, value);
  const w = nEff / (nEff + 20);
  if (pts.length < 2) {
    if (pts.length === 1) {
      const [h, s] = pts[0]!;
      const fInfNeed = s / Math.max(1e-6, 1 - Math.exp(-h / prior.tau));
      const fInf = Math.min(0.98, Math.max(0.15, fInfNeed));
      return { fInf: w * fInf + (1 - w) * prior.fInf, tau: prior.tau };
    }
    return prior;
  }
  let best = { err: Infinity, fInf: prior.fInf, tau: prior.tau };
  for (let fInf = 0.15; fInf <= 0.98 + 1e-9; fInf += 0.05) {
    for (let tau = 0.08; tau <= 10; tau *= 1.3) {
      let err = 0;
      for (const [h, s, nn] of pts) { const p = fInf * (1 - Math.exp(-h / tau)); err += nn * (p - s) * (p - s); }
      if (err < best.err) best = { err, fInf, tau };
    }
  }
  return { fInf: w * best.fInf + (1 - w) * prior.fInf, tau: w * best.tau + (1 - w) * prior.tau };
}
const newcomerFit = fitSaturatingNew((p) => p.place >= 1, (p) => p.newcomer, { fInf: 0.7, tau: 0.5 });
const fadeFit = fitSaturatingOld((p) => p.place === 0, (p) => p.faded, { fInf: 0.55, tau: 2 });
const newcomerShareAt = (h: number): number => newcomerFit.fInf * (1 - Math.exp(-h / newcomerFit.tau));
const fadeProbAt = (h: number): number => fadeFit.fInf * (1 - Math.exp(-h / fadeFit.tau));
// Per-place newcomer curves: each place's own repaired fit, shrunk toward
// the pooled curve. With few lag points the pooled curve dominates; with
// the final's 66 marks the per-place evidence (notably place 1, which
// turns over fastest) takes over.
const placeNewcomerFit: Array<{ fInf: number; tau: number }> = [];
const placeNewcomerN: number[] = [];
for (let k = 1; k <= places; k++) {
  placeNewcomerFit.push(fitSaturatingNew((p) => p.place === k, (p) => p.newcomer, { fInf: 0.7, tau: 0.5 }));
  placeNewcomerN.push(lagPts.filter((p) => p.place === k).length);
}
const newcomerShareAtPlace = (k: number, h: number): number => {
  const fit = placeNewcomerFit[k - 1]!;
  const w = placeNewcomerN[k - 1]! / (placeNewcomerN[k - 1]! + PLACE_PRIOR_WEIGHT);
  const own = fit.fInf * (1 - Math.exp(-h / fit.tau));
  return w * own + (1 - w) * newcomerShareAt(h);
};
const uDirectPlace = (k: number): number =>
  horizons.reduce((a, h) => a + newcomerShareAtPlace(k, h), 0) / Math.max(1, horizons.length);

// ---------- drift / vol / graduation / newcomer caps ----------
function meanSd(v: number[]): { mean: number; sd: number } {
  if (v.length === 0) return { mean: 0, sd: 0.5 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, v.length - 1));
  return { mean, sd: Math.max(sd, 0.05) };
}
function deltasBy(venuePred: (v: string) => boolean): number[] {
  const out: number[] = [];
  // Recent half of the marks: the current regime's volatility, not the opening explosion's.
  const cutIdx = Math.floor(marks.length / 2);
  const tFrom = tMark[cutIdx]!;
  for (const c of coinList) {
    for (let j = 1; j < c.obs.length; j++) {
      const a = c.obs[j - 1]!, b = c.obs[j]!;
      if (a.t < tFrom) continue;
      const dt = (b.t - a.t) / HOUR;
      if (dt <= 0 || dt > 1.01) continue;
      if (!venuePred(a.venue)) continue;
      out.push((b.x - a.x) / dt);
    }
  }
  return out;
}
const poolD = meanSd(deltasBy((v) => v === 'pool' || v === 'migrating'));
const curveD = meanSd(deltasBy((v) => v === 'curve'));
const POOL_DRIFT = Math.min(0.3, Math.max(-0.3, 0.5 * poolD.mean + 0.5 * -0.05));
const POOL_SIGMA_H = Math.min(0.8, Math.max(0.25, poolD.sd));
const CURVE_SIGMA_H = Math.min(0.5, Math.max(0.1, curveD.sd));
let curveHours = 0, graduations = 0;
const gradCaps: number[] = [];
for (const c of coinList) {
  for (let j = 1; j < c.obs.length; j++) {
    const a = c.obs[j - 1]!, b = c.obs[j]!;
    const dt = (b.t - a.t) / HOUR;
    if (dt <= 0 || dt > 1.01) continue;
    if (a.venue === 'curve') {
      curveHours += dt;
      if (b.venue === 'pool' || b.venue === 'migrating') { graduations++; gradCaps.push(b.x); }
    }
  }
}
const gradRate = graduations > 0 ? Math.min(2, graduations / Math.max(1, curveHours)) : 0.05;
const gradCapsFiltered = gradCaps.filter((x) => x > 2.3 && x < 4.5);
const gradCap = meanSd(gradCapsFiltered.length ? gradCapsFiltered : [2.9]);
const GRAD_MEAN = gradCapsFiltered.length >= 3 ? gradCap.mean : 2.9;
const GRAD_SD = gradCapsFiltered.length >= 3 ? Math.min(0.6, Math.max(0.2, gradCap.sd)) : 0.4;
// Newcomer caps: observations of coins that reached the top 20, while younger
// than 1h — the cap a hot arrival actually holds at a random young age.
// (Matched to the arrival rate, which counts top-20 entrants.)
const peakCaps: number[] = [];
for (const c of coinList) {
  if (!c.obs.some((o) => o.rank <= 20)) continue;
  for (const o of c.obs) {
    const age = (o.t - c.created) / HOUR;
    if (age >= 0 && age < 1) peakCaps.push(o.x);
  }
}
peakCaps.sort((a, b) => a - b);
function sampleNewcomerCap(): number {
  if (peakCaps.length === 0) return 2.7 + 0.5 * randn();
  const base = peakCaps[Math.floor(rnd() * peakCaps.length)]!;
  // Heavy-tail extension: occasionally exceed the observed max.
  if (rnd() < 0.15) return base + -Math.log(1 - rnd()) * 0.25;
  return base;
}
// Arrival rate: coins first seen in a top-20, per hour, recent half of marks.
let entrants = 0, spanH = 0;
{
  const nonEmpty = marks.map((m, i) => i).filter((i) => marks[i]!.rows!.length > 0);
  const recent = nonEmpty.slice(Math.floor(nonEmpty.length / 2));
  const seenBefore = new Set<string>();
  for (const i of nonEmpty) {
    for (const r of sortedRows[i]!.slice(0, 20)) {
      if (recent.includes(i) && !seenBefore.has(r.mint)) entrants++;
      seenBefore.add(r.mint);
    }
  }
  spanH = recent.length > 1 ? (tMark[recent[recent.length - 1]!]! - tMark[recent[0]!]!) / HOUR : 1;
}
const ARRIVAL_PER_H = Math.min(60, Math.max(2, entrants / Math.max(spanH, 0.25)));
// Record trend (v3): slope of the TOP-5 MEAN log-cap over the recent half,
// shrunk, capped. v1/v2 fitted place 1 alone — a single coin's series, the
// noisiest estimate of the market level; the mean of five place series has
// materially lower variance for the same level shift, which is what the
// trend shift applies. The guard is 2 marks (was 3): with only two
// non-empty marks the choice is between a bounded, shrunk slope and
// asserting no trend at all, and the caps below bound the damage.
let trendG = 0;
{
  const nonEmpty = marks.map((m, i) => i).filter((i) => marks[i]!.rows!.length > 0);
  const take = Math.max(3, Math.ceil(nonEmpty.length / 2));
  const recent = nonEmpty.slice(-take);
  if (recent.length >= 2) {
    const xs = recent.map((i) => (tMark[i]! - tCut) / HOUR);
    const ys = recent.map((i) => {
      const top = sortedRows[i]!.slice(0, 5);
      return top.reduce((a, r) => a + sizeOf(r.market_cap_lamports), 0) / Math.max(1, top.length);
    });
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0, den = 0;
    for (let i = 0; i < xs.length; i++) { num += (xs[i]! - mx) * (ys[i]! - my); den += (xs[i]! - mx) * (xs[i]! - mx); }
    const slope = den > 0 ? num / den : 0;
    trendG = Math.min(0.2, Math.max(-0.1, 0.5 * slope)); // shrink + cap (per hour)
  }
}
const trendShift = (h: number): number => Math.min(0.8, Math.max(-0.5, trendG * h));

// ---------- candidates ----------
const momentum = new Map<string, number>();
for (const c of coinList) {
  const o = c.obs;
  if (o.length >= 2) {
    const a = o[Math.max(0, o.length - 3)]!, b = o[o.length - 1]!;
    momentum.set(c.mint, (b.x - a.x) / Math.max(0.05, (b.t - a.t) / HOUR));
  } else momentum.set(c.mint, 0);
}
const byLastCap = [...coinList].sort((a, b) => b.lastX - a.lastX);
const candSet = new Set<string>();
for (const c of byLastCap.slice(0, 120)) candSet.add(c.mint);
for (const c of [...coinList].sort((a, b) => (momentum.get(b.mint) ?? 0) - (momentum.get(a.mint) ?? 0)).slice(0, 60)) candSet.add(c.mint);
for (const c of coinList) if (c.lastVenue === 'pool' || c.lastVenue === 'migrating') candSet.add(c.mint);
for (const c of coinList) if ((tCut - c.created) / HOUR < 2 && c.lastX > 2.0) candSet.add(c.mint);
const lastIdx = marks.length - 1;
let candidates = [...candSet].map((m) => coins.get(m)!).filter((c) => c.lastT >= tMark[Math.max(0, lastIdx - 1)]!);
candidates.sort((a, b) => b.lastX - a.lastX);
candidates = candidates.slice(0, MAX_CANDIDATES);

const TAU_MOMENTUM = 2.0;
const SIGMA_MAX = 1.0;
const CURVE_CEILING = 2.55;
interface Prep { mint: string; x0: number; drift: number; sigmaH: number; curve: boolean; }
const prepped: Prep[] = candidates.map((c) => {
  const o = c.obs;
  let slope = 0;
  if (o.length >= 2) {
    const a = o[Math.max(0, o.length - 4)]!, b = o[o.length - 1]!;
    slope = (b.x - a.x) / Math.max(0.05, (b.t - a.t) / HOUR);
  }
  const prior = c.lastVenue === 'curve' ? 0 : POOL_DRIFT;
  const w = Math.min(0.7, o.length / (o.length + 3));
  return {
    mint: c.mint, x0: c.lastX,
    drift: Math.min(1.2, Math.max(-1.2, w * slope + (1 - w) * prior)),
    sigmaH: c.lastVenue === 'curve' ? CURVE_SIGMA_H : POOL_SIGMA_H,
    curve: c.lastVenue === 'curve',
  };
});

// ---------- place-level size model (the blend's second component) ----------
// Each place's cap as its own persistence-plus-diffusion process: the mean
// follows the place's own drift (fitted through the origin over all lag
// pairs, shrunk hard toward zero when pairs are few, capped), and the spread
// comes from consecutive-mark increments scaled by sqrt(h) — a deliberately
// conservative estimator that cannot chase a 3-mark trend the way a
// through-origin variance fit does.
interface PlaceSize { lastCap: number; driftH: number; sdStep: number; dtMed: number }
const placeSize: PlaceSize[] = [];
for (let k = 0; k < places; k++) {
  const series: Array<{ t: number; s: number }> = [];
  for (let i = 0; i < marks.length; i++) {
    const row = sortedRows[i]![k];
    if (row !== undefined) series.push({ t: tMark[i]!, s: sizeOf(row.market_cap_lamports) });
  }
  const lastCap = series.length ? series[series.length - 1]!.s : 3;
  let driftH = 0, sdStep = 0.15, dtMed = 1 / 6;
  if (series.length >= 2) {
    let num = 0, den = 0, nPairs = 0;
    for (let i = 0; i < series.length; i++) {
      for (let j = i + 1; j < series.length; j++) {
        const lag = (series[j]!.t - series[i]!.t) / HOUR;
        if (lag <= 0) continue;
        num += (series[j]!.s - series[i]!.s) * lag; den += lag * lag; nPairs++;
      }
    }
    if (den > 0) {
      const raw = num / den;
      const w = nPairs / (nPairs + 20);
      driftH = Math.min(0.3, Math.max(-0.3, w * raw));
    }
    const steps: number[] = [], dts: number[] = [];
    for (let i = 1; i < series.length; i++) {
      const dt = (series[i]!.t - series[i - 1]!.t) / HOUR;
      if (dt <= 0) continue;
      steps.push(Math.abs(series[i]!.s - series[i - 1]!.s));
      dts.push(dt);
    }
    if (steps.length) {
      steps.sort((a, b) => a - b);
      dts.sort((a, b) => a - b);
      sdStep = Math.max(0.1, steps[Math.floor(steps.length / 2)]! / 0.6745);
      dtMed = dts[Math.floor(dts.length / 2)]!;
    }
  }
  placeSize.push({ lastCap, driftH, sdStep, dtMed });
}

/** erfc(x), Numerical Recipes' erfcc (fractional error under 1.2e-7). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
const above = (x: number, mean: number, sd: number): number => (x === -Infinity ? 1 : x === Infinity ? 0 : 0.5 * erfc((x - mean) / (sd * Math.SQRT2)));

/** The place-level normal's bin probabilities for place k at horizon h. */
function placeNormalBins(k: number, h: number): number[] {
  const { lastCap, driftH, sdStep, dtMed } = placeSize[k]!;
  const mean = lastCap + Math.min(0.5, Math.max(-0.5, driftH * h));
  const sd = Math.min(0.5, Math.max(0.15, sdStep * Math.sqrt(Math.max(h, 0.02) / Math.max(dtMed, 0.02))));
  const probs = new Array<number>(bins).fill(0);
  for (let bin = 0; bin < bins; bin++) {
    const lo = bin === 0 ? -Infinity : edges[bin - 1]!;
    const hi = bin === edges.length ? Infinity : edges[bin]!;
    probs[bin] = above(lo, mean, sd) - above(hi, mean, sd);
  }
  return probs;
}

// ---------- Monte Carlo ----------
const placeFreq: Array<Map<string, number>> = Array.from({ length: places }, () => new Map());
const newcomerFreq = new Array<number>(places).fill(0);
const sizeHistKnown: number[][] = Array.from({ length: places }, () => new Array<number>(bins).fill(0));
const sizeHistNew: number[][] = Array.from({ length: places }, () => new Array<number>(bins).fill(0));
const totalSamples = SIMS * horizons.length;
const binOfX = (x: number): number => { let b = 0; while (b < edges.length && edges[b]! <= x) b++; return b; };

function sampleCoin(p: Prep, h: number): number {
  if (rnd() < fadeProbAt(h)) return 1.45 + 0.25 * randn();
  if (p.curve && rnd() < 1 - Math.exp(-gradRate * h)) return GRAD_MEAN + GRAD_SD * randn() + trendShift(h);
  const mean = p.x0 + p.drift * TAU_MOMENTUM * (1 - Math.exp(-h / TAU_MOMENTUM)) + trendShift(h);
  const sd = Math.min(SIGMA_MAX, p.sigmaH * Math.sqrt(Math.max(h, 0.02)));
  let x = mean + sd * randn();
  if (p.curve) x = Math.min(x, CURVE_CEILING);
  return x;
}

const nPrep = prepped.length;
const caps = new Float64Array(nPrep);
for (let s = 0; s < SIMS; s++) {
  for (let ri = 0; ri < horizons.length; ri++) {
    const h = horizons[ri]!;
    for (let i = 0; i < nPrep; i++) caps[i] = sampleCoin(prepped[i]!, h);
    // Arrivals are a Poisson process in time: the newcomer count scales
    // with the horizon (v1 drew one hour's worth at every horizon).
    const nNew = Math.min(NEWCOMER_CAP, poisson(ARRIVAL_PER_H * h));
    const all: Array<{ x: number; mint: string | null }> = [];
    for (let i = 0; i < nPrep; i++) all.push({ x: caps[i]!, mint: prepped[i]!.mint });
    for (let j = 0; j < nNew; j++) all.push({ x: sampleNewcomerCap() + trendShift(h), mint: null });
    all.sort((a, b) => b.x - a.x);
    for (let k = 0; k < places; k++) {
      const top = all[k];
      if (!top) break;
      const bin = binOfX(top.x);
      if (top.mint === null) { newcomerFreq[k]!++; sizeHistNew[k]![bin]!++; }
      else {
        const m = placeFreq[k]!;
        m.set(top.mint, (m.get(top.mint) ?? 0) + 1);
        sizeHistKnown[k]![bin]!++;
      }
    }
  }
}

// Unnamed mass per place: max(the place's direct lag estimate, the simulated
// newcomer frequency), capped at 0.9. The max is a safety floor: under the
// log score, under-hedging a newcomer-held slot costs far more than the
// dilution over-hedging costs on known-held slots.
const uPlace: number[] = [];
for (let k = 1; k <= places; k++) {
  uPlace.push(Math.min(0.9, Math.max(uDirectPlace(k), newcomerFreq[k - 1]! / totalSamples)));
}

// ---------- emit probabilities (greedy proper-scoring naming) ----------
const probabilities: Array<{ mint: string; place: number; p: number }> = [];
for (let k = 1; k <= places; k++) {
  const freq = placeFreq[k - 1]!;
  const u = uPlace[k - 1]!;
  const simNew = newcomerFreq[k - 1]! / totalSamples;
  // Rescale named probs so the named sum is 1 - u (sim's known mass is 1 - simNew).
  const knownMass = Math.max(1e-9, 1 - simNew);
  const scale = (1 - u) / knownMass;
  const cands = [...freq.entries()]
    .map(([mint, n]) => ({ mint, q: (n / totalSamples) * scale }))
    .sort((a, b) => b.q - a.q);
  // Greedy: name while q beats the unnamed per-coin share (chart_size coins).
  const rows: Array<{ mint: string; p: number }> = [];
  let sum = 0;
  for (const c of cands) {
    if (rows.length >= 100) break;
    const unnamedCoins = Math.max(1, CHART_SIZE - rows.length);
    const share = (1 - sum) / unnamedCoins;
    if (c.q < share * 0.999) break;
    const p = Math.floor(c.q * MICRO) / MICRO;
    if (p <= 0) break;
    rows.push({ mint: c.mint, p });
    sum += p;
    if (sum >= 1 - u) break;
  }
  // If rounding/naming left the sum above 1 - u, trim the tail (keep unnamed mass honest).
  while (sum > 1 - u + 1e-9 && rows.length > 0) { sum -= rows.pop()!.p; }
  for (const r of rows) probabilities.push({ mint: r.mint, place: k, p: r.p });
}

// ---------- emit sizes ----------
// v3: the mixture weight is the simulation's own newcomer frequency, NOT
// the order unnamed mass u. Sizes score the marginal place-cap
// distribution, and the simulation's marginal — known/newcomer histograms
// mixed by their simulated frequencies — is the field model's estimate of
// it. Reweighting by u (v1/v2) double-counts the lag fit and, when the
// field is thin, leans on a biased newcomer conditional. The place-normal
// blend is horizon-gated: w(h) = SIZE_BLEND_MAX * h / (h + HALF), averaged
// over the reads, so the stationary anchor barely touches short-horizon
// forecasts and carries ~0.24 weight at the final's 7-13h. The result is
// kernel-smoothed one bin each way: Monte Carlo bin counts are noisy, and
// smoothing trades a little peak sharpness for insurance against
// off-by-one-bin misses, which the log score punishes asymmetrically.
const blendW = (h: number): number => SIZE_BLEND_MAX * h / (h + SIZE_BLEND_HALF_H);
const W_BAR = horizons.reduce((a, h) => a + blendW(h), 0) / Math.max(1, horizons.length);
const sizes: Array<{ place: number; bin: number; p: number }> = [];
for (let k = 1; k <= places; k++) {
  const simNew = newcomerFreq[k - 1]! / totalSamples;
  const knownN = Math.max(1, totalSamples - newcomerFreq[k - 1]!);
  const newN = Math.max(1, newcomerFreq[k - 1]!);
  const pn = new Array<number>(bins).fill(0);
  for (const h of horizons) {
    const b = placeNormalBins(k - 1, h);
    for (let i = 0; i < bins; i++) pn[i]! += b[i]! / horizons.length;
  }
  const probs = new Array<number>(bins).fill(0);
  for (let b = 0; b < bins; b++) {
    const pk = sizeHistKnown[k - 1]![b]! / knownN;
    const pnw = simNew > 0 ? sizeHistNew[k - 1]![b]! / newN : 0;
    const mix = (1 - simNew) * pk + simNew * pnw;
    probs[b] = (1 - W_BAR) * mix + W_BAR * pn[b]!;
  }
  const sm = new Array<number>(bins).fill(0);
  for (let b = 0; b < bins; b++) {
    const lo = b > 0 ? probs[b - 1]! : 0;
    const hi = b < bins - 1 ? probs[b + 1]! : 0;
    sm[b] = SIZE_SMOOTH_KERNEL[0]! * lo + SIZE_SMOOTH_KERNEL[1]! * probs[b]! + SIZE_SMOOTH_KERNEL[2]! * hi;
  }
  const tot = sm.reduce((a, v) => a + v, 0);
  const finalProbs = tot > 0 ? sm.map((v) => v / tot) : sm;
  for (let b = 0; b < bins; b++) {
    const p = Math.floor(finalProbs[b]! * MICRO) / MICRO;
    if (p > 0) sizes.push({ place: k, bin: b, p });
  }
}

// ---------- top5: assignment maximising expected agreement ----------
const totals = new Map<string, number>();
for (let k = 1; k <= places; k++) for (const [mint, n] of placeFreq[k - 1]!) totals.set(mint, (totals.get(mint) ?? 0) + n);
const pool = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([m]) => m);
const probAt = (mint: string, place: number): number => (placeFreq[place - 1]!.get(mint) ?? 0) / totalSamples;
let bestAssign: string[] = pool.slice(0, places);
let bestScore = -Infinity;
function permute(prefix: string[], rest: string[]): void {
  if (prefix.length === places) {
    let s = 0;
    for (let a = 0; a < places; a++) for (let k = 1; k <= places; k++) s += probAt(prefix[a]!, k) * (places - Math.abs(a - (k - 1)));
    if (s > bestScore) { bestScore = s; bestAssign = [...prefix]; }
    return;
  }
  for (let i = 0; i < rest.length; i++) permute([...prefix, rest[i]!], [...rest.slice(0, i), ...rest.slice(i + 1)]);
}
if (pool.length >= places) permute([], pool);
const top5 = bestAssign.length === places ? bestAssign : candidates.slice(0, places).map((c) => c.mint);

writeFileSync(join(OUTPUT_DIR, task.output), `${JSON.stringify({ probabilities, top5, sizes })}\n`);
