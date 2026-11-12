// pumpfun-top5-forecast-01 entry: Monte Carlo forecaster (Node 22, stdlib only).
// No network, no API keys, no model calls; fully deterministic (fixed seed).
//
// Per-coin log-cap paths (momentum with horizon decay, horizon-scaled noise,
// fade hazard, graduation jumps) plus a synthetic newcomer field (empirical
// young-coin caps with a heavy tail, shifted by the record trend). The
// per-place newcomer share is estimated directly from the history's own lag
// transitions (share of top-5 slots held by coins absent from earlier marks,
// saturating in horizon, shrunk toward a prior) and the named probabilities
// are scaled so the mass left unnamed matches it. Sizes mix known-holder and
// newcomer-holder cap histograms with the same weight. Naming follows a
// greedy proper-scoring rule: name a coin only while its probability beats
// the unnamed per-coin share. All parameters are estimated from the history
// given; nothing is hard-coded to the rehearsal. All horizons and times are
// read from task.json, never hard-coded.
//
// Reads $MAKEFUN_INPUT_DIR (else /input), writes $MAKEFUN_OUTPUT_DIR (else /output).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const SIMS = 6000;
const SEED = 0x9e3779b9;
const MAX_CANDIDATES = 300;
const MICRO = 1_000_000;

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
  places: number; output: string; size: { edges: number[] }; reads: string[]; t0: string;
};
const lines = readFileSync(join(INPUT_DIR, 'history.ndjson'), 'utf8').split('\n').filter((l) => l !== '');
const marks = lines.map((l) => JSON.parse(l) as Mark).filter((m) => m.ok === true && Array.isArray(m.rows));
if (marks.length === 0) throw new Error('the history holds no ok mark');
const places = task.places;
const edges = task.size.edges;
const bins = edges.length + 1;

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
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rnd(); } while (p > L && k < 200);
  return k - 1;
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
// estimate for the market as it stands at the cut.
interface LagPoint { lag: number; place: number; newcomer: boolean; faded: boolean; }
function lagPoints(): LagPoint[] {
  const pts: LagPoint[] = [];
  const n = marks.length;
  const K = Math.max(6, Math.ceil(0.4 * n));
  const iMin = Math.max(0, n - K);
  for (let i = iMin; i < n; i++) {
    const topI = new Set(sortedRows[i]!.slice(0, 20).map((r) => r.mint));
    const seen = new Set<string>();
    for (let k = 0; k <= i; k++) for (const r of marks[k]!.rows!) seen.add(r.mint);
    for (let j = i + 1; j < n; j++) {
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
// Fit f(h) = fInf * (1 - exp(-h / tau)) to bucketed shares by grid search, then
// shrink the fitted parameters toward the prior in proportion to the evidence.
function fitSaturating(filter: (p: LagPoint) => boolean, value: (p: LagPoint) => boolean, prior: { fInf: number; tau: number }): { fInf: number; tau: number } {
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
  const pts: Array<[number, number]> = [];
  for (const [lag, b] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    if (b.n >= 8) pts.push([lag, b.s / b.n]);
  }
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
const newcomerFit = fitSaturating((p) => p.place >= 1, (p) => p.newcomer, { fInf: 0.5, tau: 2 });
const fadeFit = fitSaturating((p) => p.place === 0, (p) => p.faded, { fInf: 0.55, tau: 2 });
const newcomerShareAt = (h: number): number => newcomerFit.fInf * (1 - Math.exp(-h / newcomerFit.tau));
const fadeProbAt = (h: number): number => fadeFit.fInf * (1 - Math.exp(-h / fadeFit.tau));
const uDirect = horizons.reduce((a, h) => a + newcomerShareAt(h), 0) / Math.max(1, horizons.length);

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
// Record trend: slope of the top-1 log-cap over the recent half, shrunk, capped.
let trendG = 0;
{
  const nonEmpty = marks.map((m, i) => i).filter((i) => marks[i]!.rows!.length > 0);
  const take = Math.max(3, Math.ceil(nonEmpty.length / 2));
  const recent = nonEmpty.slice(-take);
  if (recent.length >= 3) {
    const xs = recent.map((i) => (tMark[i]! - tCut) / HOUR);
    const ys = recent.map((i) => sizeOf(sortedRows[i]![0]!.market_cap_lamports));
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
    const nNew = Math.min(60, poisson(ARRIVAL_PER_H * 1.0));
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

// Unnamed mass per place: max(direct lag estimate, simulated newcomer frequency).
const uPlace: number[] = [];
for (let k = 0; k < places; k++) {
  uPlace.push(Math.min(0.9, Math.max(uDirect, newcomerFreq[k]! / totalSamples)));
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
  // Greedy: name while q beats the unnamed per-coin share (chart ~100 coins).
  const rows: Array<{ mint: string; p: number }> = [];
  let sum = 0;
  for (const c of cands) {
    if (rows.length >= 100) break;
    const unnamedCoins = Math.max(1, 100 - rows.length);
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

// ---------- emit sizes (mix known/newcomer histograms by u) ----------
const sizes: Array<{ place: number; bin: number; p: number }> = [];
for (let k = 1; k <= places; k++) {
  const u = uPlace[k - 1]!;
  const simNew = newcomerFreq[k - 1]! / totalSamples;
  const knownN = Math.max(1, totalSamples - newcomerFreq[k - 1]!);
  const newN = Math.max(1, newcomerFreq[k - 1]!);
  for (let b = 0; b < bins; b++) {
    const pk = sizeHistKnown[k - 1]![b]! / knownN;
    const pn = simNew > 0 ? sizeHistNew[k - 1]![b]! / newN : 0;
    const p = Math.floor(((1 - u) * pk + u * pn) * MICRO) / MICRO;
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
