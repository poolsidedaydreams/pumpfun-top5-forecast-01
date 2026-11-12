// Forecast the top 5 pump.fun coins by market cap at the answer reads.
//
// Model (written from the prose design documents, no prior code read):
// a seeded Monte Carlo over candidate coins with momentum-saturation
// drift, venue-specific diffusion, fade-to-floor, a flat graduation
// hazard with a unimodal jump to observed post-graduation caps, a curve
// ceiling, and a newcomer field drawn from young top-20 peak caps with
// a trend shift and a tail extension. Place-level size distributions
// blend the Monte Carlo histograms with a conservative per-place anchor
// under an effective-sample-size gate, then take horizon-mix-gated
// tempering. Order probabilities leave an unnamed mass per place from
// lag-pair newcomer fits and simulated newcomer frequency. On top of
// that base, two measured additions: a horizon-gated downward shift and
// widening of the size distributions, and a half-weight blend of the
// order probabilities with a Luce model and a direct scoring model.
//
// Deterministic: fixed seeds, no clock, no environment randomness.
// Node builtins only. Reads $MAKEFUN_INPUT_DIR (else /input), writes
// $MAKEFUN_OUTPUT_DIR/forecast.json (else /output/forecast.json).

import * as fs from "node:fs";
import * as path from "node:path";

/* ---------------------------------------------------------------- */
/* Constants                                                         */
/* ---------------------------------------------------------------- */

const N_PATHS = 40000;
const MAX_CANDIDATES = 300;
const MAX_NEWCOMERS = 200;
const TOP_BY_SIZE = 120;
const TOP_BY_MOMENTUM = 60;
const TAU_MOMENTUM_H = 2;
const SIZE_BLEND_MAX = 0.5;
const CURVE_CEILING = 2.55;
const TAIL_PROB = 0.15;
const TAIL_MEAN_DEX = 0.25;
const FADE_DROP_DEX = 2.0;
const FADE_SD_DEX = 0.2;
const TEMP_STRENGTH = 0.15;
const TEMP_TAU_H = 2;
const ESS_GATE_K = 40;
const SEED_MC = 123456789;
const SEED_ENSEMBLE = 987654321;
const GUMBEL_DRAWS = 20000;
const MAX_ROWS_PER_PLACE = 100;
const PROB_FLOOR = 1e-6;
const SHIFT_DEX = 0.2;
const SHIFT_HORIZON_H = 10;
const WIDEN_DEX = 0.15;
const WIDEN_HORIZON_H = 10;
const UNNAMED_CAP = 0.9;
const PLACES = 5;

/* ---------------------------------------------------------------- */
/* Deterministic randomness                                          */
/* ---------------------------------------------------------------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normals from a uniform stream (Marsaglia polar method,
// with the spare value cached). Deterministic given the stream.
function makeGauss(rand: () => number): () => number {
  let spare: number | null = null;
  return function (): number {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = rand() * 2 - 1;
      v = rand() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * m;
    return u * m;
  };
}

function poissonSample(rand: () => number, gauss: () => number, lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) {
    const v = Math.round(lambda + Math.sqrt(lambda) * gauss());
    return v < 0 ? 0 : v;
  }
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > limit);
  return k - 1;
}

// Standard normal CDF (Abramowitz & Stegun 7.1.26).
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-0.5 * x * x);
  let p =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  if (x > 0) p = 1 - p;
  return p;
}

/* ---------------------------------------------------------------- */
/* Small numeric helpers                                             */
/* ---------------------------------------------------------------- */

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function renormalize(a: number[]): void {
  let s = 0;
  for (const v of a) s += v;
  if (s > 0) {
    for (let i = 0; i < a.length; i++) a[i] /= s;
  }
}

// Bin of a size value under the task's edges: bin 0 below the first
// edge, bin i in [edges[i-1], edges[i]) for 1..80, bin 81 at/above
// the last edge.
function binIndex(x: number, edges: number[]): number {
  const n = edges.length;
  if (x < edges[0]) return 0;
  if (x >= edges[n - 1]) return n;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (edges[mid] <= x) lo = mid;
    else hi = mid;
  }
  return lo + 1;
}

// Piecewise-linear interpolation of (xs, ys) at x; zero outside the
// range of xs.
function interpAt(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (x < xs[0] || x > xs[n - 1]) return 0;
  if (x === xs[0]) return ys[0];
  if (x === xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] * (1 - t) + ys[hi] * t;
}

function floor6(p: number): number {
  const v = Math.floor(p * 1e6) / 1e6;
  return v < 0 ? 0 : v;
}

/* ---------------------------------------------------------------- */
/* Input parsing                                                     */
/* ---------------------------------------------------------------- */

interface RowData {
  mint: string;
  size: number; // log10 of market cap in SOL
  venue: string;
  rank: number;
  createdAt: number; // ms
  reservesSol: number;
  mayhem: boolean;
}

interface MarkData {
  at: number; // ms
  rows: RowData[]; // rank ascending
}

interface TaskData {
  reads: number[]; // ms
  edges: number[];
  cadenceMinutes: number;
}

function parseMarks(text: string): MarkData[] {
  const marks: MarkData[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const obj = JSON.parse(trimmed);
    const at = Date.parse(obj.at);
    const rows: RowData[] = [];
    const rawRows = Array.isArray(obj.rows) ? obj.rows : [];
    for (const r of rawRows) {
      const cap = Number(r.market_cap_lamports);
      const size = Math.log10(cap > 0 ? cap : 1) - 9;
      let createdAt = Date.parse(r.created_at);
      if (!Number.isFinite(createdAt)) createdAt = at;
      rows.push({
        mint: String(r.mint),
        size,
        venue: String(r.venue || "curve"),
        rank: Number(r.rank) || 0,
        createdAt,
        reservesSol: Number(r.quote_reserves_lamports || 0) / 1e9,
        mayhem: Boolean(r.mayhem),
      });
    }
    rows.sort((a, b) => a.rank - b.rank);
    marks.push({ at, rows });
  }
  marks.sort((a, b) => a.at - b.at);
  return marks;
}

function parseTask(obj: Record<string, unknown>): TaskData {
  const readsRaw = Array.isArray(obj.reads) ? (obj.reads as unknown[]) : [];
  const reads = readsRaw.map((r) => Date.parse(String(r))).filter((t) => Number.isFinite(t));
  const sizeObj = (obj.size as Record<string, unknown>) || {};
  const edgesRaw = Array.isArray(sizeObj.edges) ? (sizeObj.edges as unknown[]) : [];
  const edges = edgesRaw.map((e) => Number(e)).filter((e) => Number.isFinite(e));
  return {
    reads,
    edges: edges.length >= 2 ? edges : [2, 6],
    cadenceMinutes: Number(obj.cadence_minutes) || 10,
  };
}

/* ---------------------------------------------------------------- */
/* Per-coin histories and features                                   */
/* ---------------------------------------------------------------- */

interface Obs {
  t: number;
  size: number;
  venue: string;
  rank: number;
  reservesSol: number;
  createdAt: number;
}

interface CoinFeatures {
  mint: string;
  obs: Obs[];
  lastSize: number;
  lastVenue: string;
  lastRank: number;
  lastReservesSol: number;
  createdAt: number;
  momentum: number; // dex per hour, capped to [-1, 1]
  ageHours: number; // at the last mark, floored at 0
}

function buildCoinHistories(marks: MarkData[]): Map<string, Obs[]> {
  const byMint = new Map<string, Obs[]>();
  for (const mark of marks) {
    for (const row of mark.rows) {
      let list = byMint.get(row.mint);
      if (!list) {
        list = [];
        byMint.set(row.mint, list);
      }
      list.push({
        t: mark.at,
        size: row.size,
        venue: row.venue,
        rank: row.rank,
        reservesSol: row.reservesSol,
        createdAt: row.createdAt,
      });
    }
  }
  return byMint;
}

// Hourly momentum: size change between the last observation and the
// observation at or before one hour earlier, over the elapsed hours
// (minimum one sixth of an hour), capped to [-1, 1]. When no
// observation is an hour old yet, the earliest observation stands in;
// a single observation gives zero momentum.
function momentumOf(obs: Obs[]): number {
  if (obs.length < 2) return 0;
  const last = obs[obs.length - 1];
  const target = last.t - 3600e3;
  let ref: Obs | null = null;
  for (let i = obs.length - 1; i >= 0; i--) {
    if (obs[i].t <= target) {
      ref = obs[i];
      break;
    }
  }
  if (ref === null) ref = obs[0];
  const elapsedH = Math.max(1 / 6, (last.t - ref.t) / 3600e3);
  return clamp((last.size - ref.size) / elapsedH, -1, 1);
}

function buildFeatures(byMint: Map<string, Obs[]>, lastMarkAt: number): CoinFeatures[] {
  const out: CoinFeatures[] = [];
  for (const [mint, obs] of byMint) {
    const last = obs[obs.length - 1];
    out.push({
      mint,
      obs,
      lastSize: last.size,
      lastVenue: last.venue,
      lastRank: last.rank,
      lastReservesSol: last.reservesSol,
      createdAt: obs[0].createdAt,
      momentum: momentumOf(obs),
      ageHours: Math.max(0, (lastMarkAt - obs[0].createdAt) / 3600e3),
    });
  }
  return out;
}

/* ---------------------------------------------------------------- */
/* Lag-pair saturating fits                                          */
/* ---------------------------------------------------------------- */

interface Saturating {
  c: number; // ceiling
  tau: number; // time constant, hours
}

function evalSat(f: Saturating, h: number): number {
  return f.c * (1 - Math.exp(-h / f.tau));
}

interface FitPoint {
  h: number;
  y: number;
}

// Grid-search fit of c * (1 - exp(-h/tau)). Ties resolve toward fast
// time constants and high ceilings when preferFast, toward slow and
// low otherwise.
function fitSaturating(points: FitPoint[], preferFast: boolean): Saturating {
  const cGrid: number[] = [];
  for (let c = 0.5; c <= 1.0001; c += 0.05) cGrid.push(Math.round(c * 100) / 100);
  const tauGrid = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24];
  const cOrder = preferFast ? [...cGrid].reverse() : cGrid;
  const tauOrder = preferFast ? tauGrid : [...tauGrid].reverse();
  let best: Saturating = { c: 0.9, tau: 1 };
  let bestSse = Infinity;
  for (const c of cOrder) {
    for (const tau of tauOrder) {
      let sse = 0;
      for (const p of points) {
        const pred = c * (1 - Math.exp(-p.h / tau));
        const d = p.y - pred;
        sse += d * d;
      }
      if (sse < bestSse) {
        bestSse = sse;
        best = { c, tau };
      }
    }
  }
  return best;
}

function shrinkFit(own: Saturating, pooled: Saturating, n: number, prior: number): Saturating {
  const w = n / (n + prior);
  return {
    c: w * own.c + (1 - w) * pooled.c,
    tau: w * own.tau + (1 - w) * pooled.tau,
  };
}

interface LagCurves {
  newcomer: Saturating[]; // per place, shrunk toward pooled
  newcomerPooled: Saturating;
  fade: Saturating[]; // per place, shrunk toward pooled
  fadePooled: Saturating;
}

function fitLagCurves(marks: MarkData[], byMint: Map<string, Obs[]>): LagCurves {
  const defaults: LagCurves = {
    newcomer: Array.from({ length: PLACES }, () => ({ c: 0.9, tau: 1 })),
    newcomerPooled: { c: 0.9, tau: 1 },
    fade: Array.from({ length: PLACES }, () => ({ c: 0.5, tau: 4 })),
    fadePooled: { c: 0.5, tau: 4 },
  };
  const m = marks.length;
  if (m < 2) return defaults;

  const firstSeen = new Map<string, number>();
  for (let i = 0; i < m; i++) {
    for (const row of marks[i].rows) {
      if (!firstSeen.has(row.mint)) firstSeen.set(row.mint, i);
    }
  }
  const markMaps: Map<string, RowData>[] = marks.map((mark) => {
    const map = new Map<string, RowData>();
    for (const row of mark.rows) map.set(row.mint, row);
    return map;
  });
  const top20: string[][] = marks.map((mark) => mark.rows.slice(0, 20).map((r) => r.mint));

  const newcomerPoints: FitPoint[][] = Array.from({ length: PLACES }, () => []);
  const newcomerPooledPoints: FitPoint[] = [];
  const fadePoints: FitPoint[][] = Array.from({ length: PLACES }, () => []);
  const fadePooledPoints: FitPoint[] = [];
  let nPairs = 0;
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      const h = (marks[j].at - marks[i].at) / 3600e3;
      if (h <= 0) continue;
      nPairs++;
      // Newcomer share: is the coin at place k in mark j new since mark i?
      for (let k = 0; k < PLACES; k++) {
        const rowJ = marks[j].rows[k];
        if (!rowJ) continue;
        const y = (firstSeen.get(rowJ.mint) as number) > i ? 1 : 0;
        newcomerPoints[k].push({ h, y });
        newcomerPooledPoints.push({ h, y });
      }
      // Fade: did a top-20 coin of mark i vanish or collapse by mark j?
      for (let k = 0; k < PLACES; k++) {
        const rowI = marks[i].rows[k];
        if (!rowI) continue;
        const rowJ = markMaps[j].get(rowI.mint);
        const y = !rowJ || rowJ.size < rowI.size - 1.0 ? 1 : 0;
        fadePoints[k].push({ h, y });
      }
      for (const mint of top20[i]) {
        const rowI = markMaps[i].get(mint) as RowData;
        const rowJ = markMaps[j].get(mint);
        const y = !rowJ || rowJ.size < rowI.size - 1.0 ? 1 : 0;
        fadePooledPoints.push({ h, y });
      }
    }
  }
  if (nPairs === 0) return defaults;

  const newcomerPooled = fitSaturating(newcomerPooledPoints, true);
  const fadePooled = fitSaturating(fadePooledPoints, false);
  const newcomer = newcomerPoints.map((pts) =>
    pts.length > 0 ? shrinkFit(fitSaturating(pts, true), newcomerPooled, nPairs, 10) : newcomerPooled
  );
  const fade = fadePoints.map((pts) =>
    pts.length > 0 ? shrinkFit(fitSaturating(pts, false), fadePooled, nPairs, 10) : fadePooled
  );
  void byMint;
  return { newcomer, newcomerPooled, fade, fadePooled };
}

/* ---------------------------------------------------------------- */
/* History-estimated model quantities                                */
/* ---------------------------------------------------------------- */

interface Estimated {
  // Volatility per hour by venue (pooled fallback included).
  sigmaByVenue: Map<string, number>;
  sigmaPooled: number;
  // Post-graduation jump distribution (unimodal normal).
  jumpMean: number;
  jumpSd: number;
  // Flat graduation hazard per hour.
  gradLambda: number;
  // Newcomer peak caps.
  peakCaps: number[];
  // Market trend, dex per hour.
  trendG: number;
  // Top-20 entrant arrival rate per hour.
  arrival: number;
}

function estimateQuantities(
  marks: MarkData[],
  features: CoinFeatures[],
  byMint: Map<string, Obs[]>,
  cadenceMinutes: number
): Estimated {
  // Venue-specific diffusion from pooled consecutive-mark deltas.
  const deltasByVenue = new Map<string, number[]>();
  const allDeltas: number[] = [];
  for (const coin of features) {
    const obs = coin.obs;
    for (let i = 1; i < obs.length; i++) {
      const dtH = (obs[i].t - obs[i - 1].t) / 3600e3;
      if (dtH <= 0) continue;
      const d = (obs[i].size - obs[i - 1].size) / Math.sqrt(dtH);
      allDeltas.push(d);
      if (obs[i].venue === obs[i - 1].venue) {
        const list = deltasByVenue.get(obs[i].venue) || [];
        list.push(d);
        deltasByVenue.set(obs[i].venue, list);
      }
    }
  }
  const sigmaFrom = (ds: number[]): number => {
    if (ds.length === 0) return 0.3;
    const mad = median(ds.map((d) => Math.abs(d)));
    return clamp(mad / 0.6745, 0.05, 0.6);
  };
  const sigmaPooled = sigmaFrom(allDeltas);
  const sigmaByVenue = new Map<string, number>();
  for (const [venue, ds] of deltasByVenue) {
    sigmaByVenue.set(venue, ds.length >= 10 ? sigmaFrom(ds) : sigmaPooled);
  }

  // Post-graduation caps: first pool/migrating observation after a
  // curve observation, per coin. Unimodal normal fit; default centre
  // near 2.05 when too few are observed.
  const postGrad: number[] = [];
  let graduations = 0;
  for (const coin of features) {
    const obs = coin.obs;
    let sawCurve = false;
    for (const o of obs) {
      if (o.venue === "curve") sawCurve = true;
      else if (sawCurve && (o.venue === "pool" || o.venue === "migrating")) {
        postGrad.push(o.size);
        graduations++;
        break;
      }
    }
  }
  let jumpMean = 2.05;
  let jumpSd = 0.5;
  if (postGrad.length >= 4) {
    const mean = postGrad.reduce((a, b) => a + b, 0) / postGrad.length;
    const varSum = postGrad.reduce((a, b) => a + (b - mean) * (b - mean), 0);
    jumpMean = mean;
    jumpSd = clamp(Math.sqrt(varSum / (postGrad.length - 1)), 0.25, 0.8);
  }

  // Flat graduation hazard: graduations over curve-coin exposure.
  let exposureH = 0;
  for (let i = 0; i < marks.length - 1; i++) {
    const dtH = (marks[i + 1].at - marks[i].at) / 3600e3;
    if (dtH <= 0) continue;
    let curveRows = 0;
    for (const row of marks[i].rows) if (row.venue === "curve") curveRows++;
    exposureH += curveRows * dtH;
  }
  const gradLambda = exposureH > 0 ? clamp(graduations / exposureH, 0.001, 0.5) : 0.05;

  // Newcomer peak caps: peak sizes of coins seen in the top 20 while
  // under one hour old.
  const peakCaps: number[] = [];
  for (const coin of features) {
    let youngTop20 = false;
    let peak = -Infinity;
    for (const o of coin.obs) {
      if (o.size > peak) peak = o.size;
      const ageH = (o.t - o.createdAt) / 3600e3;
      if (o.rank >= 1 && o.rank <= 20 && ageH < 1) youngTop20 = true;
    }
    if (youngTop20 && Number.isFinite(peak)) peakCaps.push(peak);
  }
  if (peakCaps.length === 0 && marks.length > 0) {
    for (const row of marks[marks.length - 1].rows.slice(0, 20)) peakCaps.push(row.size);
  }
  if (peakCaps.length === 0) peakCaps.push(2.5);

  // Market trend: OLS slope of the per-mark top-20 median size.
  let trendG = 0;
  if (marks.length >= 2) {
    const t0 = marks[0].at;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    let n = 0;
    for (const mark of marks) {
      const top = mark.rows.slice(0, 20).map((r) => r.size);
      if (top.length === 0) continue;
      const x = (mark.at - t0) / 3600e3;
      const y = median(top);
      sx += x;
      sy += y;
      sxx += x * x;
      sxy += x * y;
      n++;
    }
    const denom = n * sxx - sx * sx;
    if (n >= 2 && denom > 0) trendG = clamp((n * sxy - sx * sy) / denom, -0.2, 0.2);
  }

  // Arrival rate: first-time top-20 entrants over the recent half of
  // marks, with the cadence-span correction.
  let arrival = 20;
  if (marks.length >= 2) {
    const recentStart = Math.floor(marks.length / 2);
    const seenTop20 = new Set<string>();
    for (let i = 0; i < recentStart; i++) {
      for (const row of marks[i].rows.slice(0, 20)) seenTop20.add(row.mint);
    }
    let entrants = 0;
    for (let i = recentStart; i < marks.length; i++) {
      for (const row of marks[i].rows.slice(0, 20)) {
        if (!seenTop20.has(row.mint)) {
          seenTop20.add(row.mint);
          entrants++;
        }
      }
    }
    const spanH =
      (marks[marks.length - 1].at - marks[recentStart].at) / 3600e3 + cadenceMinutes / 60;
    if (spanH > 0 && entrants > 0) arrival = entrants / spanH;
  }

  void byMint;
  return {
    sigmaByVenue,
    sigmaPooled,
    jumpMean,
    jumpSd,
    gradLambda,
    peakCaps,
    trendG,
    arrival,
  };
}

/* ---------------------------------------------------------------- */
/* Candidate selection                                               */
/* ---------------------------------------------------------------- */

function selectCandidates(features: CoinFeatures[]): CoinFeatures[] {
  const chosen: CoinFeatures[] = [];
  const taken = new Set<string>();
  const add = (coin: CoinFeatures): boolean => {
    if (taken.has(coin.mint) || chosen.length >= MAX_CANDIDATES) return false;
    taken.add(coin.mint);
    chosen.push(coin);
    return true;
  };
  const bySize = [...features].sort((a, b) => b.lastSize - a.lastSize);
  for (const coin of bySize.slice(0, TOP_BY_SIZE)) add(coin);
  const byMomentum = [...features].sort((a, b) => b.momentum - a.momentum);
  for (const coin of byMomentum.slice(0, TOP_BY_MOMENTUM)) add(coin);
  for (const coin of bySize) {
    if (coin.lastVenue === "pool" || coin.lastVenue === "migrating") add(coin);
  }
  for (const coin of bySize) {
    if (coin.ageHours < 1) add(coin);
  }
  if (chosen.length < MAX_CANDIDATES) {
    for (const coin of bySize) add(coin);
  }
  return chosen;
}

/* ---------------------------------------------------------------- */
/* Monte Carlo                                                       */
/* ---------------------------------------------------------------- */

interface McResult {
  orderCounts: Int32Array[]; // [place][candidate]
  newcomerCounts: Int32Array; // [place]
  sizeHist: Int32Array[]; // [place][bin]
  totalSamples: number;
}

function runMonteCarlo(
  candidates: CoinFeatures[],
  est: Estimated,
  curves: LagCurves,
  horizons: number[],
  edges: number[]
): McResult {
  const nCand = candidates.length;
  const nBins = edges.length + 1;
  const nReads = horizons.length;
  const orderCounts: Int32Array[] = Array.from({ length: PLACES }, () => new Int32Array(nCand));
  const newcomerCounts = new Int32Array(PLACES);
  const sizeHist: Int32Array[] = Array.from({ length: PLACES }, () => new Int32Array(nBins));

  const lastSize = new Float64Array(nCand);
  const mom = new Float64Array(nCand);
  const sig = new Float64Array(nCand);
  const isCurve = new Uint8Array(nCand);
  const fadeCurve: Saturating[] = new Array(nCand);
  for (let i = 0; i < nCand; i++) {
    const c = candidates[i];
    lastSize[i] = c.lastSize;
    mom[i] = c.momentum;
    sig[i] = est.sigmaByVenue.get(c.lastVenue) ?? est.sigmaPooled;
    isCurve[i] = c.lastVenue === "curve" ? 1 : 0;
    fadeCurve[i] =
      c.lastRank >= 1 && c.lastRank <= PLACES ? curves.fade[c.lastRank - 1] : curves.fadePooled;
  }
  const peakCaps = est.peakCaps;
  const nPeak = peakCaps.length;

  const rand = mulberry32(SEED_MC);
  const gauss = makeGauss(rand);
  const drift = new Float64Array(nCand);
  const sds = new Float64Array(nCand);
  const fadeP = new Float64Array(nCand);

  for (let r = 0; r < nReads; r++) {
    const h = horizons[r];
    const sqrtH = Math.sqrt(h);
    const momSat = TAU_MOMENTUM_H * (1 - Math.exp(-h / TAU_MOMENTUM_H));
    for (let i = 0; i < nCand; i++) {
      drift[i] = mom[i] * momSat;
      sds[i] = Math.min(sig[i] * sqrtH, 1);
      fadeP[i] = clamp(evalSat(fadeCurve[i], h), 0, 0.95);
    }
    const gradP = 1 - Math.exp(-est.gradLambda * h);
    const trend = clamp(est.trendG * h, -0.5, 0.8);
    const lamNew = est.arrival * h;

    for (let p = 0; p < N_PATHS; p++) {
      let s0 = -Infinity;
      let s1 = -Infinity;
      let s2 = -Infinity;
      let s3 = -Infinity;
      let s4 = -Infinity;
      let i0 = -1;
      let i1 = -1;
      let i2 = -1;
      let i3 = -1;
      let i4 = -1;

      for (let i = 0; i < nCand; i++) {
        let term = lastSize[i] + drift[i] + sds[i] * gauss();
        if (isCurve[i] === 1) {
          if (rand() < gradP) {
            term = est.jumpMean + est.jumpSd * gauss();
          } else if (term > CURVE_CEILING) {
            term = CURVE_CEILING;
          }
        }
        if (rand() < fadeP[i]) {
          term = term - FADE_DROP_DEX + FADE_SD_DEX * gauss();
        }
        if (term > s4) {
          if (term > s0) {
            s4 = s3; i4 = i3; s3 = s2; i3 = i2; s2 = s1; i2 = i1; s1 = s0; i1 = i0; s0 = term; i0 = i;
          } else if (term > s1) {
            s4 = s3; i4 = i3; s3 = s2; i3 = i2; s2 = s1; i2 = i1; s1 = term; i1 = i;
          } else if (term > s2) {
            s4 = s3; i4 = i3; s3 = s2; i3 = i2; s2 = term; i2 = i;
          } else if (term > s3) {
            s4 = s3; i4 = i3; s3 = term; i3 = i;
          } else {
            s4 = term; i4 = i;
          }
        }
      }

      const nNew = Math.min(MAX_NEWCOMERS, poissonSample(rand, gauss, lamNew));
      for (let j = 0; j < nNew; j++) {
        let cap = peakCaps[(rand() * nPeak) | 0] + trend;
        if (rand() < TAIL_PROB) cap += -TAIL_MEAN_DEX * Math.log(1 - rand());
        if (cap > s4) {
          if (cap > s0) {
            s4 = s3; i4 = i3; s3 = s2; i3 = i2; s2 = s1; i2 = i1; s1 = s0; i1 = i0; s0 = cap; i0 = -1;
          } else if (cap > s1) {
            s4 = s3; i4 = i3; s3 = s2; i3 = i2; s2 = s1; i2 = i1; s1 = cap; i1 = -1;
          } else if (cap > s2) {
            s4 = s3; i4 = i3; s3 = s2; i3 = i2; s2 = cap; i2 = -1;
          } else if (cap > s3) {
            s4 = s3; i4 = i3; s3 = cap; i3 = -1;
          } else {
            s4 = cap; i4 = -1;
          }
        }
      }

      const tops = [s0, s1, s2, s3, s4];
      const idxs = [i0, i1, i2, i3, i4];
      for (let k = 0; k < PLACES; k++) {
        // A path with no coins at all (empty history, zero newcomers
        // drawn) leaves this slot at -Infinity; it must not count as
        // a newcomer win.
        if (!Number.isFinite(tops[k])) continue;
        sizeHist[k][binIndex(tops[k], edges)]++;
        if (idxs[k] >= 0) orderCounts[k][idxs[k]]++;
        else newcomerCounts[k]++;
      }
    }
  }

  return { orderCounts, newcomerCounts, sizeHist, totalSamples: N_PATHS * nReads };
}

/* ---------------------------------------------------------------- */
/* Size distributions: anchor, blend, temper, v8 shift/widen         */
/* ---------------------------------------------------------------- */

// Per-place anchor: a normal centred on the last mark's place size
// plus a through-origin drift (capped at +-0.5 dex), with spread from
// the median absolute place-size increment, scaled by sqrt(horizon).
function anchorDistribution(
  marks: MarkData[],
  place: number,
  hbar: number,
  edges: number[]
): number[] {
  const nBins = edges.length + 1;
  const sizes: number[] = [];
  const times: number[] = [];
  for (const mark of marks) {
    const row = mark.rows[place];
    if (row) {
      sizes.push(row.size);
      times.push(mark.at);
    }
  }
  let mean = 2.5;
  let sd = 0.35;
  if (sizes.length > 0) {
    const lastCap = sizes[sizes.length - 1];
    let drift = 0;
    if (sizes.length >= 2) {
      const t0 = times[0];
      const s0 = sizes[0];
      let num = 0;
      let den = 0;
      for (let i = 0; i < sizes.length; i++) {
        const t = (times[i] - t0) / 3600e3;
        num += t * (sizes[i] - s0);
        den += t * t;
      }
      if (den > 0) drift = clamp((num / den) * hbar, -0.5, 0.5);
    }
    mean = lastCap + drift;
    if (sizes.length >= 2) {
      const incs: number[] = [];
      for (let i = 1; i < sizes.length; i++) incs.push(Math.abs(sizes[i] - sizes[i - 1]));
      sd = clamp((median(incs) / 0.6745) * Math.sqrt(hbar), 0.15, 0.6);
    }
  }
  const out = new Array<number>(nBins).fill(0);
  out[0] = normCdf((edges[0] - mean) / sd);
  for (let b = 1; b < nBins - 1; b++) {
    out[b] = normCdf((edges[b] - mean) / sd) - normCdf((edges[b - 1] - mean) / sd);
  }
  out[nBins - 1] = 1 - normCdf((edges[edges.length - 1] - mean) / sd);
  renormalize(out);
  return out;
}

function smoothDistribution(dist: number[]): number[] {
  const n = dist.length;
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const v = dist[i];
    if (v === 0) continue;
    out[i] += 0.5 * v;
    if (i > 0) out[i - 1] += 0.25 * v;
    if (i < n - 1) out[i + 1] += 0.25 * v;
  }
  renormalize(out);
  return out;
}

// Horizon-gated size widening and downward shift (v8 addition one).
// Applied after the base size distribution is fully formed.
function shiftAndWiden(dist: number[], edges: number[], hbar: number): number[] {
  const n = dist.length;
  const w = edges[1] - edges[0];
  const centers: number[] = [];
  centers.push(edges[0] - 0.25 * w);
  for (let i = 1; i < n - 1; i++) centers.push((edges[i - 1] + edges[i]) / 2);
  centers.push(edges[edges.length - 1] + 0.25 * w);

  const shift = SHIFT_DEX * Math.min(hbar / SHIFT_HORIZON_H, 1);
  const shifted = new Array<number>(n).fill(0);
  for (let j = 0; j < n; j++) {
    shifted[j] = interpAt(centers, dist, centers[j] + shift);
  }
  renormalize(shifted);

  let out = shifted;
  const sd = WIDEN_DEX * Math.sqrt(hbar / WIDEN_HORIZON_H);
  if (sd > 1e-9) {
    const k = Math.ceil((3 * sd) / w);
    const kernel: number[] = [];
    let ksum = 0;
    for (let d = -k; d <= k; d++) {
      const kv = Math.exp(-0.5 * Math.pow((d * w) / sd, 2));
      kernel.push(kv);
      ksum += kv;
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] /= ksum;
    const conv = new Array<number>(n).fill(0);
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let d = -k; d <= k; d++) {
        const src = j - d;
        if (src >= 0 && src < n) s += shifted[src] * kernel[d + k];
      }
      conv[j] = s;
    }
    out = conv;
    renormalize(out);
  }

  for (let j = 0; j < n; j++) out[j] = Math.max(out[j], PROB_FLOOR);
  renormalize(out);
  return out;
}

function buildSizeDistributions(
  mc: McResult,
  marks: MarkData[],
  hbar: number,
  edges: number[]
): number[][] {
  const nBins = edges.length + 1;
  const alpha = 1 + TEMP_STRENGTH * Math.exp(-hbar / TEMP_TAU_H);
  const dists: number[][] = [];
  for (let k = 0; k < PLACES; k++) {
    const mcDist = new Array<number>(nBins).fill(0);
    for (let b = 0; b < nBins; b++) mcDist[b] = mc.sizeHist[k][b] / mc.totalSamples;
    renormalize(mcDist);
    // Effective-sample-size gate: diffuse Monte Carlo (mass spread
    // over many bins) leans more on the conservative anchor, up to
    // the cap; concentrated Monte Carlo leans less.
    let sumSq = 0;
    for (const p of mcDist) sumSq += p * p;
    const ess = sumSq > 0 ? 1 / sumSq : 1;
    const w = Math.min(SIZE_BLEND_MAX, ess / (ess + ESS_GATE_K));
    const anchor = anchorDistribution(marks, k, hbar, edges);
    const blended = new Array<number>(nBins).fill(0);
    for (let b = 0; b < nBins; b++) blended[b] = (1 - w) * mcDist[b] + w * anchor[b];
    let dist = smoothDistribution(blended);
    for (let b = 0; b < nBins; b++) dist[b] = Math.pow(Math.max(dist[b], 0), alpha);
    renormalize(dist);
    for (let b = 0; b < nBins; b++) dist[b] = Math.max(dist[b], PROB_FLOOR);
    renormalize(dist);
    dist = shiftAndWiden(dist, edges, hbar);
    dists.push(dist);
  }
  return dists;
}

/* ---------------------------------------------------------------- */
/* Order probabilities: naming, then the v8 half-weight ensemble     */
/* ---------------------------------------------------------------- */

interface ProbEntry {
  mint: string;
  p: number;
}

// Keep the top entries, rescale to the target sum, floor, drop zeros.
function finalizePlace(entries: ProbEntry[], targetSum: number): ProbEntry[] {
  const sorted = [...entries].sort((a, b) => b.p - a.p || (a.mint < b.mint ? -1 : 1));
  const kept = sorted.slice(0, MAX_ROWS_PER_PLACE).filter((e) => e.p > 0);
  let sum = 0;
  for (const e of kept) sum += e.p;
  if (sum <= 0) return [];
  const scale = targetSum / sum;
  const out: ProbEntry[] = [];
  for (const e of kept) {
    const p = Math.max(e.p * scale, PROB_FLOOR);
    if (p > 0) out.push({ mint: e.mint, p });
  }
  let sum2 = 0;
  for (const e of out) sum2 += e.p;
  if (sum2 > 0) {
    const scale2 = targetSum / sum2;
    for (const e of out) e.p *= scale2;
  }
  return out.filter((e) => e.p > 0);
}

function buildBaseOrderProbs(
  mc: McResult,
  candidates: CoinFeatures[],
  curves: LagCurves,
  hbar: number
): { probs: ProbEntry[][]; namedSum: number[] } {
  const probs: ProbEntry[][] = [];
  const namedSum: number[] = [];
  for (let k = 0; k < PLACES; k++) {
    const simNew = mc.newcomerCounts[k] / mc.totalSamples;
    const direct = evalSat(curves.newcomer[k], hbar);
    const unnamed = Math.min(UNNAMED_CAP, Math.max(direct, simNew));
    const target = 1 - unnamed;
    namedSum.push(target);
    const rawNamed = 1 - simNew;
    const scale = rawNamed > 0 ? target / rawNamed : 0;
    const entries: ProbEntry[] = [];
    if (scale > 0) {
      for (let i = 0; i < candidates.length; i++) {
        const f = mc.orderCounts[k][i] / mc.totalSamples;
        if (f > 0) entries.push({ mint: candidates[i].mint, p: f * scale });
      }
    }
    probs.push(finalizePlace(entries, target));
  }
  return { probs, namedSum };
}

// Gumbel-top-5 sampling: each draw adds independent Gumbel noise to
// the log strengths and takes the top five; place frequencies over
// the draws are the model's per-place probabilities.
function sampleOrderModel(logStrength: number[], draws: number, rand: () => number): number[][] {
  const n = logStrength.length;
  const counts: number[][] = Array.from({ length: PLACES }, () => new Array<number>(n).fill(0));
  for (let d = 0; d < draws; d++) {
    let s0 = -Infinity;
    let s1 = -Infinity;
    let s2 = -Infinity;
    let s3 = -Infinity;
    let s4 = -Infinity;
    let i0 = -1;
    let i1 = -1;
    let i2 = -1;
    let i3 = -1;
    let i4 = -1;
    for (let i = 0; i < n; i++) {
      let u = rand();
      if (u <= 0) u = 1e-12;
      if (u >= 1) u = 1 - 1e-12;
      const v = logStrength[i] - Math.log(-Math.log(u));
      if (v > s4) {
        if (v > s0) {
          s4 = s3; i4 = i3; s3 = s2; i3 = i2; s2 = s1; i2 = i1; s1 = s0; i1 = i0; s0 = v; i0 = i;
        } else if (v > s1) {
          s4 = s3; i4 = i3; s3 = s2; i3 = i2; s2 = s1; i2 = i1; s1 = v; i1 = i;
        } else if (v > s2) {
          s4 = s3; i4 = i3; s3 = s2; i3 = i2; s2 = v; i2 = i;
        } else if (v > s3) {
          s4 = s3; i4 = i3; s3 = v; i3 = i;
        } else {
          s4 = v; i4 = i;
        }
      }
    }
    const idxs = [i0, i1, i2, i3, i4];
    for (let k = 0; k < PLACES; k++) {
      if (idxs[k] >= 0) counts[k][idxs[k]]++;
    }
  }
  for (let k = 0; k < PLACES; k++) {
    for (let i = 0; i < n; i++) counts[k][i] /= draws;
  }
  return counts;
}

function buildEnsembleOrderProbs(
  features: CoinFeatures[],
  base: { probs: ProbEntry[][]; namedSum: number[] }
): ProbEntry[][] {
  const ranked = [...features].sort((a, b) => b.lastSize - a.lastSize).slice(0, MAX_CANDIDATES);
  const n = ranked.length;
  if (n === 0) return base.probs;

  const logLuce: number[] = new Array(n);
  const logClf: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const c = ranked[i];
    logLuce[i] = 1.5 * (c.lastSize - 2.2);
    let score = 1.2 * (c.lastSize - 2.2) + 2 * c.momentum;
    if (c.lastVenue === "pool") score += 0.4;
    score -= 0.5 * Math.log10(c.ageHours + 0.25);
    if (c.lastVenue === "curve") score += 0.3 * Math.log10(c.lastReservesSol + 1);
    logClf[i] = clamp(score, -20, 20);
  }

  const rand = mulberry32(SEED_ENSEMBLE);
  const luce = sampleOrderModel(logLuce, GUMBEL_DRAWS, rand);
  const clf = sampleOrderModel(logClf, GUMBEL_DRAWS, rand);

  const blended: ProbEntry[][] = [];
  for (let k = 0; k < PLACES; k++) {
    const target = base.namedSum[k];
    // Scale each small model to the base model's named sum, keeping
    // the unnamed mass exactly.
    const luceMap = new Map<string, number>();
    const clfMap = new Map<string, number>();
    let luceSum = 0;
    let clfSum = 0;
    for (let i = 0; i < n; i++) {
      luceSum += luce[k][i];
      clfSum += clf[k][i];
    }
    for (let i = 0; i < n; i++) {
      if (luce[k][i] > 0 && luceSum > 0) luceMap.set(ranked[i].mint, (luce[k][i] / luceSum) * target);
      if (clf[k][i] > 0 && clfSum > 0) clfMap.set(ranked[i].mint, (clf[k][i] / clfSum) * target);
    }
    const baseMap = new Map<string, number>();
    for (const e of base.probs[k]) baseMap.set(e.mint, e.p);
    const mints = new Set<string>([...baseMap.keys(), ...luceMap.keys(), ...clfMap.keys()]);
    const entries: ProbEntry[] = [];
    for (const mint of mints) {
      const p =
        0.5 * (baseMap.get(mint) || 0) +
        0.25 * (luceMap.get(mint) || 0) +
        0.25 * (clfMap.get(mint) || 0);
      if (p > 0) entries.push({ mint, p });
    }
    blended.push(finalizePlace(entries, target));
  }
  return blended;
}

/* ---------------------------------------------------------------- */
/* Forecast assembly                                                 */
/* ---------------------------------------------------------------- */

interface ForecastRow {
  mint: string;
  place: number;
  p: number;
}

interface SizeRow {
  place: number;
  bin: number;
  p: number;
}

interface Forecast {
  probabilities: ForecastRow[];
  top5: string[];
  sizes: SizeRow[];
}

function buildForecast(marks: MarkData[], task: TaskData): Forecast {
  const lastMark = marks[marks.length - 1];
  const lastMarkAt = lastMark.at;
  const horizons = task.reads.map((r) => Math.max(0, (r - lastMarkAt) / 3600e3));
  const hbar = horizons.length > 0 ? horizons.reduce((a, b) => a + b, 0) / horizons.length : 0;

  const byMint = buildCoinHistories(marks);
  const features = buildFeatures(byMint, lastMarkAt);
  const curves = fitLagCurves(marks, byMint);
  const est = estimateQuantities(marks, features, byMint, task.cadenceMinutes);
  const candidates = selectCandidates(features);

  const mc = runMonteCarlo(candidates, est, curves, horizons, task.edges);
  const sizeDists = buildSizeDistributions(mc, marks, hbar, task.edges);
  const base = buildBaseOrderProbs(mc, candidates, curves, hbar);
  const orderProbs = buildEnsembleOrderProbs(features, base);

  const probabilities: ForecastRow[] = [];
  for (let k = 0; k < PLACES; k++) {
    const rows = [...orderProbs[k]].sort((a, b) => b.p - a.p || (a.mint < b.mint ? -1 : 1));
    for (const e of rows) {
      const p = floor6(e.p);
      if (p > 0) probabilities.push({ mint: e.mint, place: k + 1, p });
    }
  }

  const sizes: SizeRow[] = [];
  for (let k = 0; k < PLACES; k++) {
    for (let b = 0; b < sizeDists[k].length; b++) {
      const p = floor6(sizeDists[k][b]);
      if (p > 0) sizes.push({ place: k + 1, bin: b, p });
    }
  }

  // Top 5 from the blended first-place probabilities, highest first,
  // padded with the largest coins if fewer than five are named.
  const top5: string[] = [];
  const used = new Set<string>();
  const place1 = [...orderProbs[0]].sort((a, b) => b.p - a.p || (a.mint < b.mint ? -1 : 1));
  for (const e of place1) {
    if (top5.length >= PLACES) break;
    top5.push(e.mint);
    used.add(e.mint);
  }
  if (top5.length < PLACES) {
    const bySize = [...features].sort((a, b) => b.lastSize - a.lastSize);
    for (const c of bySize) {
      if (top5.length >= PLACES) break;
      if (!used.has(c.mint)) {
        top5.push(c.mint);
        used.add(c.mint);
      }
    }
  }
  const placeholders = [
    "11111111111111111111111111111111",
    "22222222222222222222222222222222",
    "33333333333333333333333333333333",
    "44444444444444444444444444444444",
    "55555555555555555555555555555555",
  ];
  for (let i = 0; top5.length < PLACES; i++) top5.push(placeholders[i]);

  return { probabilities, top5, sizes };
}

// Even-spread fallback: used only when the history is empty or the
// model throws, so a readable forecast is always written.
function fallbackForecast(marks: MarkData[], task: TaskData): Forecast {
  const sizes: SizeRow[] = [];
  const nBins = task.edges.length + 1;
  const p = floor6(1 / nBins);
  for (let k = 0; k < PLACES; k++) {
    for (let b = 0; b < nBins; b++) {
      if (p > 0) sizes.push({ place: k + 1, bin: b, p });
    }
  }
  const top5: string[] = [];
  if (marks.length > 0) {
    for (const row of marks[marks.length - 1].rows.slice(0, PLACES)) top5.push(row.mint);
  }
  const placeholders = [
    "11111111111111111111111111111111",
    "22222222222222222222222222222222",
    "33333333333333333333333333333333",
    "44444444444444444444444444444444",
    "55555555555555555555555555555555",
  ];
  for (let i = 0; top5.length < PLACES; i++) top5.push(placeholders[i]);
  return { probabilities: [], top5, sizes };
}

/* ---------------------------------------------------------------- */
/* Entry point                                                       */
/* ---------------------------------------------------------------- */

function main(): void {
  const inputDir = process.env.MAKEFUN_INPUT_DIR || "/input";
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  const task = parseTask(JSON.parse(fs.readFileSync(path.join(inputDir, "task.json"), "utf8")));
  const marks = parseMarks(fs.readFileSync(path.join(inputDir, "history.ndjson"), "utf8"));
  let forecast: Forecast;
  try {
    forecast =
      marks.length === 0 ? fallbackForecast(marks, task) : buildForecast(marks, task);
  } catch (err) {
    console.error("model failed, writing fallback forecast:", err);
    forecast = fallbackForecast(marks, task);
  }
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "forecast.json"), JSON.stringify(forecast));
}

main();
