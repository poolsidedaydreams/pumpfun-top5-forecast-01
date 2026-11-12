# BUILD_LOG — pumpfun-top5-forecast-01, entry v3

Date: 2026-11-12. Builder: build worker, session `12ea2444` (v3 coordinator
`436e74ce`). This log is the honest record: approach, the Step-2 mechanistic
diagnosis of v2's failure, every score and ablation, the statistical
limits of the evidence, risks, and the resubmit assessment. Nothing here
was submitted, signed, or pushed anywhere by this session (forbidden);
the entry directory holds only `main.ts`, `LICENSE`, and this file.

## 0. What v3 is

The same Monte Carlo machinery as v1/v2 (per-coin log-cap paths with
momentum saturation tau=2h, venue sigma×√h capped at 1.0, fade hazard,
graduation jumps, curve ceiling 2.55, plus a synthetic newcomer field
whose caps come from the history's young top-20 coins), with six
targeted repairs. Everything not listed in §1 is v2 verbatim, including
the fade fit, drift/vol/graduation estimators, candidate selection,
greedy naming, top-5 assignment optimiser, 40,000 sims, seed
`0x9e3779b9`, and the newcomer count scaling with horizon (capped 200).

## 1. The six v3 changes (each isolated by ablation before adoption)

1. **Lag-fit repair, newcomer curves only (pooled + per-place).** The
   saturating fit's grid now reaches tau 0.08h (was 0.5h floor) and fInf
   0.98 (was 0.8 cap); buckets are weighted by point count and none is
   discarded (was: n≥8 or dropped); a single distinct lag pins the curve
   through that bucket at the prior tau instead of returning the prior
   untouched; shrinkage weight is nEff/(nEff+20) (was +40); prior is
   (0.7, 0.5h) (was (0.5, 2h)). Per-place fits keep shrinking toward the
   pooled curve with prior weight 30. **The fade fit is byte-for-byte
   v1/v2** (old grid, old prior, old shrinkage) — see §2.6.
2. **Sparse marks excluded from lag pairs.** Marks with fewer than 10
   rows are skipped as either end of a lag pair: an empty mark cannot
   define what was "seen" (mark 0 has 0 rows), and an empty later mark
   would count every coin as faded.
3. **Size mixture weight decoupled from the order unnamed mass.** Sizes
   mix the known-holder and newcomer-holder histograms by `simNew`
   (the simulation's own newcomer frequency); order still uses
   `u = max(uDirect, simNew)` capped at 0.9. Sizes score the marginal
   place-cap distribution, and the simulation's marginal is the field
   model's estimate of it; reweighting by `u` double-counts the lag fit.
4. **Horizon-gated size blend.** Blend weight `w(h) = 0.30·h/(h+2h)`,
   averaged over the reads: ~0.02–0.06 at sub-hour horizons, ~0.24 at
   the final's 7–13h. The place-normal component itself is v2 verbatim.
5. **Size-histogram kernel smoothing** `[0.25, 0.5, 0.25]` + renormalise,
   applied after blending. Monte Carlo bin counts are noisy; the log
   score punishes near-zero bins asymmetrically.
6. **Pooled record trend, min 2 marks.** The trend slope is fitted to
   the top-5 mean log-cap level (was: place 1's single series, the
   noisiest estimate of the market level), with the same 0.5× shrinkage
   and caps (±0.2/−0.1 per hour, ±0.8/−0.5 total shift). The guard is
   2 non-empty marks (was 3): with two marks the choice is between a
   bounded, shrunk slope and asserting no trend at all.

## 2. Step-2 diagnosis: why v2 lost every local split (mechanistic)

### 2.1 The lag fit could not represent fast turnover (root cause)

The history's own lag buckets show 60–90% of top-5 slots turning over
within 10–30 minutes (empirical newcomer shares: lag 10 min 0.60–0.90,
20 min 0.75–0.90, 30 min 0.87–1.00 across splits). The fitted curve
predicted 4–10% at those lags — a 5–9× understatement. Three compounding
defects in `fitSaturating` (shared by v1/v2):

- **Tau grid floor 0.5h.** The data wants tau ≈ 0.05–0.15h; the raw best
  fit hit the tau=0.50 boundary at every split with ≥2 buckets. A 0.5h
  tau caps the 10-minute share at ~0.22 no matter what the data says.
- **fInf grid cap 0.8** (0.75 effective through the float loop bound)
  while empirical saturation is ~0.9–1.0.
- **Shrinkage to a slow prior (0.5, 2h)** with weight nEff/(nEff+40):
  with nEff 15–75 the weight is 0.27–0.65, pulling fitted tau to
  1.0–1.4h. At cuts 1–2, fewer than 2 buckets had n≥8, so the fit
  returned the prior exactly and discarded the 0.90–1.00 empirical
  signal entirely.
- **Per-place fits never fired** on 6-mark histories (per-place buckets
  have n≤5, below the n≥8 rule), so v2's change #1 (per-place newcomer
  share) was inert here — it collapsed to the pooled fit, and the pooled
  fit itself understated.

Empty-mark contamination (pairs from mark 0, 0 rows) inflates short-lag
buckets somewhat (cut-5 lag-0.17: 0.60 → 0.50 excluding i=0) but is not
the main story; it is fixed anyway by change #2.

### 2.2 Why v1 survived, and why newcomer×h cost −1.28 nats

**Correction to v2's BUILD_LOG story:** output unnamed mass is mostly
EMERGENT from greedy naming stopping (frequency-shape decay), not from
`u` directly. Debug at cut 2: v2-control `uPlace` = 0.076–0.09, yet
output unnamed mass was 0.35–0.43 (greedy stops after 2–14 rows; the
100-row trim never binds). v1's over-drawn newcomer field (one hour's
worth of arrivals at every horizon) concentrated `placeFreq` — only
strong old coins reach the top 5 in sims — so greedy naming stopped
early with high-q coins: more unnamed mass and higher named p on strong
coins. v2's correct small-N field spread frequencies, so greedy named
more coins (up to 14) with lower q: less unnamed mass, diluted named p.

Per-slot evidence (cuts 2–4): v2 is worse than v1 on nearly every
NEWCOMER-held slot (e.g. cut 3 place 1: ln −6.13 vs −5.49 both reads;
unnamed per-coin 0.0022 vs 0.0041) and better on most OLD-held slots
(named p 0.17–0.19 vs 0.14). Cut-2 unnamed: v1 0.45–0.51 vs v2 0.35–0.42
against a realised newcomer share of 0.80 — both under-hedged, v2 worse.
Cut-3 unnamed: v1 0.33–0.55 vs v2 0.15–0.30. Cut-4: v1 0.24–0.60 vs
v2 0.12–0.28.

**Size side of ×h:** v2 size means are LOWER than v1 at every cut/place
(e.g. cut 2: 3.26/3.07/2.86/2.68/2.52 vs 3.32/3.12/2.97/2.83/2.69) with a
STEEPER place gradient — the wrong direction in the compressing regime
(top-5 spread compresses 1.19 → 0.28 over the history). Fewer newcomers
→ lower newcomer max (order statistic of N draws from left-skewed
`peakCaps`) → newcomer-held histogram lower; known-coin gaps persist
instead of compressing.

**Does the mechanism reverse at long h? Yes for the field/count part.**
At 7–13h v1 draws 7–13× too few newcomers, so weak old coins survive in
sims (diffuse named mass) and the newcomer size max is understated
~0.3–0.5 log. The `u`-rescaling fixes total mass but not WHICH old coins
win or the newcomer size shape. v1's short-h benefit from over-drawing
was accidental compensation for (i) the broken lag fit and (ii) weak
newcomer caps via the max statistic. That is why v3 KEEPS newcomer×h
and repairs the fit instead of reverting the count.

### 2.3 Why the flat 0.25 blend cost −0.48 nats at short h

The blend pulls the size centre DOWN toward `lastCap` in a rising regime
(place-normal drift shrunk hard, mean shift capped ±0.5; drift fitted
over ALL pairs including the early regime) and DILUTES width when the
sim is already well-centred (cut 3: sim sd 0.07–0.10 was right; blend sd
~0.26 thinned peak p from ~0.20 to ~0.15–0.18; blend sd floor 0.15
overstates true short-h dispersion). At long h the blend is a wide,
near-stationary anchor (sd capped 0.5, mean ±0.5) against extrapolated
sim centres — plausibly helpful there. Hence horizon gating (change #4):
the weight should GROW with horizon, not sit flat at 0.25.

### 2.4 Size centre errors are two-sided; trend estimation fails thin

Cut 2: `trendG` = 0 (needs ≥3 recent non-empty marks; only 2 exist) → no
trend shift while the record rose +0.45 in 30 min → under-centring plus
the −7.31 catastrophe (place 5 forecast mean 2.69 vs realised 3.28).
Cut 4: momentum overshoot (place-1 mean 3.75 vs realised 3.56). The
pooled/min-2 trend (change #6) fixes the cut-2 failure; the caps bound
the overshoot direction.

### 2.5 The `u` / size-mixture coupling trap

`u` did double duty: order unnamed mass AND size-mixture weight
`(1−u)·pk + u·pn`. Raising `u` to honest levels with the old fade prior
and a weak newcomer field weights a biased/noisy newcomer-conditional
histogram `pn` (few newcomer-held events at small N; biased low).
Honest-`u` alone first appeared to destroy sizes; clean isolation showed
most of that damage was the FADE prior (see §2.6), and decoupling the
size weight to `simNew` recovers the residual cost. Principle adopted:
trust the FIELD for sizes (marginal histogram), trust the FIT for order.

### 2.6 The fade model must NOT be "repaired"

Fade-fit repair and even just the faster fade prior are HARMFUL
(ablation E5: −1.67 nats). "Fade events" (a top-20 coin below rank 50 or
vanishing at 10-min lags) are largely recorder-sampling churn, not
deaths to ~28 SOL. The slow fade prior is load-bearing. Keep fade fit +
prior EXACTLY as v1/v2. (This was the most expensive lesson of the
ablation program: the first two rounds were contaminated by a shared
prior switch that also changed the fade prior, and the contamination
masked the newcomer fit's true effect until round 3 isolated it.)

## 3. Scores (local backtest, 40,000 sims, validated scorer)

Protocol: train marks 0..cut, test later marks as pseudo-reads (top-100
charts), entry run via `MAKEFUN_INPUT_DIR`/`MAKEFUN_OUTPUT_DIR`, scored
with the local scorer reconstructed from `grader/forecast/ranked.ts`
(floor 1e-4, unnamed sharing, `knownOnly` drop, agreement tie-break).
Step-1 validation reproduced the known numbers exactly before any
comparison was trusted: baseline −41.12, v1 −34.20, v2 −35.89
(read-weighted cuts 2–4). Per-read log score, mean over reads.

| cut | baseline | v1 (order/size) | v2 (order/size) | v3 (order/size) |
|---|---|---|---|---|
| 1 (4 reads) | −59.169 | −42.094 (−21.735/−20.359) | −44.489 (−22.417/−22.072) | −42.615 (−22.021/−20.594) |
| 2 (3 reads) | −49.958 | −42.891 (−24.242/−18.649) | −44.883 (−25.296/−19.586) | −40.595 (−24.101/−16.494) |
| 3 (2 reads) | −33.478 | −25.580 (−16.278/−9.302) | −27.311 (−16.713/−10.598) | −26.492 (−16.587/−9.905) |
| 4 (1 read) | −29.867 | −25.352 (−14.267/−11.085) | −26.051 (−13.720/−12.331) | −25.783 (−14.128/−11.655) |
| **weighted 2–4 (6 reads)** | **−41.116** | **−34.197 (−19.925/−14.273)** | **−35.887 (−20.506/−15.381)** | **−33.425 (−19.934/−13.491)** |
| weighted 1–4 (10 reads) | — | −37.356 (−20.649/−16.707) | −39.328 (−21.270/−18.057) | −37.101 (−20.769/−16.332) |

Agreement (tie-break only): cuts 2–4 total 45 for all three entries
(v1 45, v2 45, v3 45); cuts 1–4: v1 59, v2 57, v3 57.

Headline: **v3 beats v1 by +0.77 nats and v2 by +2.46 nats** on the
read-weighted cuts 2–4 headline, all of the v1 edge coming from sizes
(order is dead even: −19.934 vs −19.925). v3 beats v2 on every cut and
every read (6/6); v3 beats v1 on cut 2 only, losing slightly on cuts 1,
3, 4. See §5 for why the +0.77 must NOT be read as statistically
established.

Practice-server context (not local): v1 scored −38.029901 (order
−20.050415, size −17.979485, agreement 50, ranked, prize-eligible),
rank 178/314 at fetch; top-10 cutoff ≈ −33.7; top entries' sizes
−13.7…−15.2 vs v1 −17.98. The prize gap is ~4.3 nats; no measured effect
in this program is that large (see §7).

## 4. Ablation record (12,000 sims unless noted; headline = weighted 2–4)

Harness: toggleable build from v2 source with asserted replacements
(scratch only, never part of the entry). Control at 12k reproduced v2
within 0.005 nats. Rounds 1–2 were contaminated (shared prior switch
also changed the fade prior) and are superseded by round 3's clean
isolation; they are listed so the trial count is honest.

| id | variant (vs v2 control −35.839) | weighted 2–4 | verdict |
|---|---|---|---|
| C1–C4 | fit-new + prior-new, ±excl, ±u-fitonly (contaminated) | −38.76…−36.23 | superseded |
| D1 | newcomer-fit-new only (fade prior contaminated) | −37.018 | superseded |
| D2 | fade-fit-new only | −38.683 | fade repair harmful |
| D3/D5 | D1 + sizew-sim (±appear caps) | −36.92/−36.80 | superseded |
| D4 | D1 + appear caps | −37.236 | appear caps: no gain |
| E1 | newcomer-fit-new + priorN-new, fade OLD | −35.350 | ADOPT (order +0.62) |
| E2 | E1 + per-place OFF | −35.423 | keep per-place ON |
| E3 | E1 + excl-sparse | −35.324 | ADOPT (principled) |
| E4 | E1 + sizew-sim | −35.214 | ADOPT (decoupling) |
| E5 | E1 + fade-prior-new | −37.018 | REJECT fade changes |
| F0 | E1+E3+E4 base | −35.265 | base |
| F1/F2 | shrinkK 10 / 40 | −35.380/−35.208 | keep K=20 (flat) |
| F3 | gated blend (0.30, half 2h) | −34.909 | ADOPT |
| F4 | gated blend (0.35, half 1h) | −34.949 | F3 params kept |
| F5 | kernel smoothing | −35.190 | ADOPT (+0.08, insurance) |
| F6 | uniform size floor 0.02 | −35.296 | REJECT (neutral + bloat) |
| F7 | arrival span+cadence correction | −35.265 identical | REJECT (no-op on splits) |
| F8 | pooled trend, min 2 marks | −34.100 | ADOPT (all at cut 2) |
| G0 | F0+F3+F5+F8 combined | −33.406 | = v3 config |
| G1 | G0 minus smoothing | −33.454 | smoothing +0.05, keep |
| G2 | G0 + shrinkK 40 | −33.348 | noise; keep K=20 |

Rejected with evidence: fade-fit/prior changes; age-aware newcomer caps
(no signal: cap vs age 0–1h flat, medians 1.87/1.60/1.54/1.45);
newcomer caps from first-appearance distribution (inconclusive, slight
size harm — keep `peakCaps`); flat 0.25 blend (superseded by gating);
uniform size floor; arrival-span correction (byte-identical on splits;
+3% on a 66-mark history — not worth the diff).

Parameter-sensitivity notes (plateaus, not spikes — the
walk-forward-optimization stability check): shrinkK 10/20/40 spans 0.17
nats; blend (0.30, 2h) vs (0.35, 1h) spans 0.04 nats; per-place on/off
spans 0.07 nats. No kept parameter sits on a sharp optimum.

**Pre-committed robustness sweep (report-only, no design change — run
after finalization at the theme-1 review's recommendation,
conducting-backtest-validation ±20% rule).** Seven runs at 12k sims on
the headline protocol, varying one constant at a time around the v3
config (R0 reproduces G0 exactly, confirming harness stability):

| id | variation | weighted 2–4 | Δ vs R0 |
|---|---|---|---|
| R0 | v3 config | −33.406 | — |
| R1 | blend WMAX 0.24 (−20%) | −33.386 | +0.020 |
| R2 | blend WMAX 0.36 (+20%) | −33.426 | −0.020 |
| R3 | blend HALF 1.6h (−20%) | −33.427 | −0.021 |
| R4 | blend HALF 2.4h (+20%) | −33.391 | +0.015 |
| R5 | shrinkK 16 (−20%) | −33.435 | −0.029 |
| R6 | shrinkK 24 (+20%) | −33.386 | +0.020 |

All variants within ±0.03 nats of control — the design is not fragile
to these constants (the 30%-degradation flag is nowhere near
triggered). Blend variants move ONLY sizes, shrinkK ONLY order: clean
separation, as designed. No parameter was changed as a result of this
sweep; the sweep is recorded so the claim "not fragile" is evidence,
not assertion. These 7 runs raise the trial ledger in §5 to ≥38
configurations.

## 5. Statistical honesty: what this evidence can and cannot support

Trial ledger: **≥38 configurations** were evaluated against the same 6
headline reads across the v2 + v3 programs (27 in this session's rounds
C/D/E/F/G, 7 in the pre-committed robustness sweep, plus ≥4 in v2's
ablations), plus v1's unknown development history. The 6 reads are ONE
50-minute window: reads within a cut share coins, cuts overlap, and the
history is a single opening-regime episode. Per the walk-forward-optimization rule, once OOS results are inspected
and the design modified, that OOS is no longer truly out-of-sample —
these 6 reads are effectively in-sample for selection purposes. Two
further validity points from the theme-1 review (anytime-valid,
selective-inference): the design was chosen by REPEATED PEEKING at the
same 6 reads, so fixed-horizon intervals after selection are invalid
(the honest price of peeking is 1.3–2× wider intervals), and the same
data that selected the winner cannot honestly evaluate it — the +0.77
is a winner's-cursed estimate whose true value is smaller (naive CIs on
selected nulls cover ~20% vs 90% nominal in the selective-inference
demonstration). The only clean out-of-sample evidence available before the final is a
future practice-server score for v3 itself (costs quota; parent's call).
The three local checks (split backtest, long-h shape, 66-mark synthetic)
share ONE data source and are NOT independent triangulation
(all-chapters-forecasting safeguard: "agreement of shared-input routes
is not independent validation").

Paired per-read differences (6 reads, naive SE — a LOWER bound, since
reads are positively correlated):

| comparison | mean | SD | SE | paired t | wins |
|---|---|---|---|---|---|
| v3 − v1, log | +0.772 | 2.200 | 0.898 | 0.86 | 4/6 |
| v3 − v1, order | −0.010 | 0.311 | 0.127 | −0.08 | 3/6 |
| v3 − v1, size | +0.782 | 2.094 | 0.855 | 0.91 | 4/6 |
| v3 − v2, log | +2.462 | 2.081 | 0.849 | 2.90 | 6/6 |

No comparison clears even t = 2.0 before multiple-testing correction,
let alone the Harvey-Liu-Zhu t ≈ 3.0 hurdle for searched results
(factor-zoo-hurdle), and with ~38 trials the expected maximum noise edge
is large (backtest-overfitting / DSR logic: N=20 → 64% false-positive
rate at p=0.05; the 6-read sample cannot support a MinBTL-style claim
at any plausible effect size). The 95% CI on the v3−v1 difference is
[−0.99, +2.53] — it crosses zero (test-significance); the v3−v2 CI
[+0.80, +4.13] excludes zero but is invalid after selection/peeking (see
above) and must be read as descriptive only. The measured split gains should be
haircut 30–50% (McLean-Pontiff magnitude) or treated as ~0 for
decision-making. PBO/CPCV/SPA are infeasible here (6 reads cannot form
blocks) — stated, not faked. And the mechanism itself must not be
mistaken for a prediction (scenarios-horizon-and-tail-risk P056):
the diagnosis explains why v2 lost LOCALLY; it has not been tested
against the future, and explanatory soundness is not predictive proof.

What DOES support v3 is not the split margin but the mechanism, and the
two kinds of evidence must not be conflated:

- **Measured miscalibration (not a searched edge):** the fitted lag
  curve vs the history's own lag buckets is a direct comparison on
  training data. The grid could not represent the observed turnover at
  ANY parameter setting; repairing the grid is a bug fix, and its
  direction (more unnamed mass, faster saturation) is pinned by the
  data, not by split scores. The fit repair's split effect (+0.62 order
  in E1) is consistent with, but not the basis for, the change.
- **Structural correctness at long horizons:** newcomer×h is retained
  (v1's 7–13× undercount at final horizons is arithmetic, not tuning);
  the fit repair's advantage is ASYMMETRIC across regimes — in a
  slow-turnover mature final, v1's and v3's fits converge (both can
  represent slow turnover); in a fast-turnover final, only v3's grid
  can represent it. The 66-mark synthetic check (§6) confirms the fit
  adapts downward when turnover is slow.
- **Split-neutrality:** v3 does not lose to v1 anywhere that matters
  (order dead even, sizes +0.78 ± 0.86, 4/6 reads) while recovering
  v2's full deficit (6/6 reads).

**Key-assumptions check** (key-assumptions-check) on the conclusion
"v3 beats v1 on the final's 7 reads":

| assumption | sensitivity | grounding | disposition |
|---|---|---|---|
| The lag-fit bug is structural (in the fitter code), not a practice-instance artifact | high | moderate — code-level argument strong; empirical magnitude on final data unmeasured | note; recorded |
| Final regime resembles practice enough for split evidence to transfer | high | WEAK — 66 marks / 11h maturing market vs 6 marks / 50 min opening | FLAG; bound the conclusion (§7) |
| Newcomer×h scaling holds at 7–13h (arrivals continue at the estimated rate) | high | weak-moderate — rate from 50 min; NEWCOMER_CAP 200 binds | FLAG (§9.3) |
| Local scorer faithfully reproduces the server scorer | high | strong — grader source read; server/local gap explained by different reads | note |
| Gated blend helps (or doesn't hurt) at long h | medium | weak — only short-h evidence (removing damage) | FLAG (§9.2) |
| MC noise negligible; trend min-2 inert on final history | low | strong — measured / by construction | deprioritize |

Two high-sensitivity × weak-grounding assumptions remain unresolved
and unresolvable before the final; the conclusion is therefore stated
as a bounded bet with wide uncertainty, never as an established edge.
The probability estimate itself carries an anchor warning: the v2
coordinator's "~70%" was in view before this estimate was formed
(calibration-and-probability-hygiene P038), so the range below is
widened to 60–70% and cross-checked against an independent second
route (raw read win-rate 4/6 shrunk toward 50% ≈ 60%).

## 6. Long-horizon behaviour (reads moved to 7–13h after the cut)

No ground truth — shape only. Full 6-mark practice history, 40k sims.

| entry | unnamed p1–p5 | size means p1–p5 | size sds p1–p5 | runtime | bytes |
|---|---|---|---|---|---|
| v1 | 0.69/0.75/0.83/0.93/1.00 | 4.95/4.70/4.48/4.34/4.24 | 0.64/0.51/0.37/0.26/0.19 | 3.4s | 10,871 |
| v2 | 0.63/0.68/0.76/0.84/0.93 | 4.87/4.60/4.44/4.32/4.23 | 0.74/0.68/0.55/0.45/0.39 | 33.7s | 17,738 |
| v3 | 0.79/0.82/0.84/0.95/1.00 | 5.14/4.73/4.48/4.32/4.23 | 0.84/0.75/0.58/0.46/0.39 | 32.3s | 16,881 |

v3 hedges more unnamed mass at long h (honest fit saturating near the
0.9 cap; places 4–5 fully unnamed via greedy stopping), keeps the
widest size spreads, and names the same top 5 as v1/v2. Place-1 size
mean is higher than v2's (5.14 vs 4.87): the size weight is now the
field marginal, and the long-h newcomer field's max is high — the
field model's honest estimate, still anchored 24% by the place normal
(P(≥1e4 SOL) 0.88 at place 1, leaving 12% below). Direction sane; no
explosion, no collapse. (Note: v2's long-h numbers here differ slightly
from v2's BUILD_LOG table — v1 reproduces exactly, so the harness
matches; v2's logged numbers likely came from an earlier v2 state. The
v1/v2/v3 comparison above is self-consistent on identical inputs.)

66-mark synthetic (tiled history, runtime/robustness only, NOT scores):
17.2s, 17,880B, valid forecast, top5 length 5. Unnamed mass 0.13–0.75 —
low because tiling repeats coins (slow apparent turnover); the fit
correctly adapts downward. Well within the 300s / 1MB limits.

Determinism: two runs on the full practice input byte-identical.
Runtime on practice input ~32s at 40k sims (machine-load dependent;
observed 17–58s across runs — all far under 300s). Output <18KB in all
checks. Node here is v24.22.1; the entry uses Node-22-compatible
stdlib-only code (`node:fs`, `node:path`), no network/key/model calls.

## 7. Resubmit assessment (honest)

**v3 is NOT "clearly better" in any statistical sense.** The split edge
over v1 (+0.77 nats, t = 0.86, 4/6 reads, 95% CI crossing zero) does not
survive the trial count (≥38) or the 6-correlated-read sample. A
benchmark-claim self-audit (benchmark-model-claims, six domains) scores
the claim "v3 beats v1 locally" at ~1.5/5: contamination 🔴 (selection
and evaluation on the same reads), baseline freshness 🟢 (pinned code,
seed, scorer, cuts), seed variance 🟡 (single fixed seed by design; MC
noise measured ~0.02), evaluator independence 🔴 (self-evaluated; the
only independent evaluator is the practice server), metric selection 🟢
(pre-specified protocol, all metrics reported), test-set size 🔴 (N=6,
SE > delta). What v3 is: a **principled bet** — it fixes a proven
calibration bug, keeps the structurally correct horizon scaling, is
split-neutral-to-positive against v1, and recovers v2's deficit on
every read. Estimated P(v3 beats v1 on the final's 7 reads) ≈
**60–70%**, driven by the fit asymmetry (§5) and the long-horizon
structural argument, with wide uncertainty and the anchor warning in
§5; the expected gain if right is small (+0.5–1.5 nats) and the downside
if wrong is similarly small (v3 ≈ v1 on splits). **The prize gap is NOT
closed on current evidence:** v1 needs ~+4.3 nats to reach the top-10
cutoff, and nothing measured here is that large. Resubmitting costs 1
of 8 remaining quota units and buys the only clean OOS datapoint
available (v3's practice-server score vs v1's −38.03). Decision
framing (forecasting-ch26 decision-readiness: act when expected cost
favours it, without requiring certainty): the cost of resubmitting is
low and the cost of forgoing a possibly-better entry plus the only
clean OOS datapoint is the larger loss, so the bet is favourable even
at the low end of the 60–70% range — but the decision should rest on
that cost asymmetry and the repair logic, not on the precise
probability, which is not precise enough to carry fine distinctions
(scenarios-horizon-and-tail-risk P055). Judge the resubmit decision on
its quality at decision time, not on the final's single draw
(thinking-in-bets: a good bet can lose, a bad bet can win). Recommended
framing: resubmit as a low-cost, positive-expectation repair — not as a
prize play. Do not over-promise.

**Strategic note for the parent (not a recommendation):** this entry is
built to maximise expected log score. In a rank-based tournament with
10 prizes from 314 entries, starting from rank 178, maximising P(top
10) would favour a higher-variance, sharper entry — a deliberately
miscalibrated gamble, not a repair. No such variant was built: it would
contradict the assignment (perfect v1, fix v2's errors) and the
calibration standard of this log. If Adhi wants a variance-seeking
entry, that is a separate, explicitly-gambling design decision for him
to make.

## 8. Skills consulted, and directions considered and rejected

Validity/reporting skills (theme 2, read in full or substantially):
backtest-validation, backtest-overfitting, overfitting-prevention,
walk-forward-optimization, purged-cross-validation, lib-purgedcv,
factor-zoo-hurdle, statistical-significance-testing,
loss-function-design, multiple-testing-ledger (pre-existing),
time-series-forecasting-models (benchmark/DM framing),
strategy-evaluation, backtesting-framework. These changed the
REPORTING (§5, trial ledger, paired SE, haircut) but not the model.
Earlier: model-calibration, conformal-uq, superforecasting,
monte-carlo-methods, analyzing-tail-risk.

Model directions considered and REJECTED (each with a stated reason;
none was silently dropped):

- **Correlated MC paths / common market factor** (correlated-scenario-
  simulation, mc-portfolio-simulator, covariance-and-risk-models):
  with 300 candidates and 5 non-empty marks any covariance estimate is
  singular (N≫T); the common-factor scale is unidentifiable, and the
  blend + smoothing already provide width insurance. The deterministic
  trend shift is the only common component the data supports.
- **HMM regimes / GARCH / rough-vol scaling** (hmm-regime-detection,
  arma-garch-modeling, rough-vol-forecast, hurst-exponent, signal-decay,
  market-regime): all need long series (80+ observations minimum, years
  typically) or borrowed constants (H=0.14 is an equity estimate).
  The SIGMA_MAX=1.0 cap already damps long-h vol growth in the rough-vol
  direction. Recent-half windows are the feasible regime adaptation.
- **Extremizing** (extremizing-forecasts, Tetlock): applies to
  aggregated CROWD forecasts; pushing a single model's probabilities
  toward extremes under a log score invites the −9.21 floor. The greedy
  naming rule is already the log-score-optimal
  calibration/discrimination trade (calibration-vs-discrimination).
- **Kelly/bet-sizing framing** (kelly-position-sizing, bet-sizing):
  the log score IS the Kelly objective; the unnamed-mass hedge, u cap,
  and smoothing are fractional-Kelly-style de-risking against
  estimation error. Confirms the design stance; no change.
- **Bayesian framing** (bayesian-updating, bayesian-methods): the
  shrinkage weights n/(n+K) are Beta-prior pseudo-counts; the design is
  already Bayesian in structure. No change.
- **Execution/microstructure/macro/portfolio/clinical/R/options
  families** (execution-cost-analysis, slippage-cost, market-making,
  order-flow-analysis, macro-regime, portfolio-optimization,
  bio-clinical-*, r-stats, options-pricing, event-study-*, …):
  triaged via descriptions; no transferable mechanism for a
  probability-forecast entry with no trading. No change.
- **Antithetic variates / variance reduction** (monte-carlo-option-
  pricing): MC noise at 40k sims is ~0.02 nats (12k vs 40k G0) —
  negligible next to the 2.2-nat read SD. Not worth the re-verification
  risk.

Theme-1 review (COMPLETED after the installer finished, 13:36 WIB;
131 skills, library 2,654 → 2,785, manifest read): every skill on the
coordinator's list was read in full, in core sections, or triaged via
frontmatter description with a stated reason. NO design-changing
insight survived the "estimable on 5 marks + not a tuned constant"
filter. What the review did:

- **Confirmed the architecture:** persistence-plus-regression backbone
  (base-rates P049/P091; all-chapters routing floors 30–80 points vs 6
  marks → provisional persistence baseline is the canonically correct
  fallback); MC-as-bootstrap for the full predictive distribution
  (prediction-intervals; ch07 "more draws reduce MC error, not model
  error"); joint-draw coherence (ch18: reconcile joint samples, never
  add marginal quantiles); shrinkage as Bayesian updating with
  pseudo-counts (probability-calibration); blend as aggregation of
  imperfect perspectives (forecaster-style P070); horizon-matched
  confidence decay (scenarios-horizon P040; ch26).
- **Confirmed the rejections with independent rationales:** post-hoc
  Platt/isotonic calibration needs 200+/500+ HELD-OUT predictions
  (probability-calibration) — infeasible with 30 outcomes; split
  conformal has no finite 95% endpoint below 19 residuals
  (all-chapters safeguards) — mathematically impossible here; break
  detection needs 80 observations (ch24) — recent-half windows are the
  feasible adaptive policy; extremizing is licensed ONLY for crowds
  with diverse unshared information (forecaster-style P044/P060) — v3's
  components share all inputs; all library methods (darts, Prophet,
  Kats, changepoint-*, deep-learning, …) are barred by the stdlib-only
  constraint; Bass-style arrival saturation (ch19) would be an
  untestable borrowed constant (NEWCOMER_CAP 200 is already the
  ceiling).
- **Strengthened the reporting (§5, §7):** peeking + selection validity
  (anytime-valid, selective-inference); 95% CIs on differences
  (test-significance); benchmark self-audit 1.5/5
  (benchmark-model-claims); anchor warning + second-route cross-check
  (calibration-and-probability-hygiene P038, calibration-and-
  probabilistic-estimation P151); explanation≠prediction
  (scenarios-horizon P056); shared-input checks ≠ independent
  validation (ch27, all-chapters safeguards); decision-threshold
  framing (ch26) and judge-the-bet (thinking-in-bets); key-assumptions
  table and premortem domains (§9); arithmetic re-verified
  (quantitative-sanity-check — all weighted tables reproduce).
- **Judgemental family** (calibrated-forecasting, calibration-and-
  probabilistic-estimation, forecast-scoring-and-evaluation,
  base-rates-outside-view-and-regression, scenarios-horizon-and-tail-
  risk, probabilistic-judgment-and-calibration, foxes-and-track-record,
  judgment-anchoring-and-base-rates, limits-of-expertise-and-
  prediction, forecasting-accountability-and-communication,
  competing-hypotheses, historical-analogy, structured-analytic-
  techniques, prospect-theory, brier-score, brier-score-calibration,
  forecast-calibration-tracker, calibration-and-probability-hygiene,
  tournament-forecasting): audit checklists for human judgment; the
  applicable checks are satisfied by the design/reporting as noted
  above. Tournament-forecasting covers ORGANISING tournaments, not
  optimal trailing-player strategy — the variance-seeking question is
  flagged in §7 as a parent/Adhi decision, not resolved here.
- **Off-domain triage:** trading execution/backtest engines, sports
  models, prediction markets, foresight/strategy, corporate FP&A,
  clinical/R/options families — descriptions read; no transferable
  mechanism for a stdlib-only probability-forecast entry.

## 9. Risks

1. **Regime change is the dominant risk.** The rehearsal history is a
   market opening (explosive fill, spread compression, 60–90% turnover);
   the final history is 66 marks of a maturing market. Every estimator
   re-fits on the final history itself (recent-half windows, lag fits),
   which mitigates but cannot eliminate this: if the mature regime
   behaves differently in ways the 6-mark history never showed (e.g.
   graduation-rate collapse, venue mix shift), all three entries share
   the exposure, and v3's extra machinery (per-place fits, gated blend)
   has more moving parts to misbehave. The caps, shrinkage, and
   horizon-gating are the guards.
2. **The gated blend's long-h value is unproven.** It helps on splits
   by REMOVING short-h damage; its +0.24 weight at 7–13h is a hedge
   against extrapolation error, not a measured gain. If the sim centres
   are right at long h, the blend costs a little sharpness.
3. **NEWCOMER_CAP 200 binds at long h** (Poisson mean ARRIVAL×h exceeds
   200 when ARRIVAL is high). Raising it was not tested; runtime and
   the newcomer-max statistic both move. Kept at v2's value.
4. **Trend min-2 is one-split evidence** (cut 2 only; inert on the
   final history, which always has ≥3 marks). Bounded by caps; accepted.
5. **MC noise / machine variance:** 40k-sims scores reproduce within
   ~0.02 nats across sim counts; runtimes vary 17–58s with load. Both
   immaterial vs the 2.2-nat read SD and the 300s limit.
6. **Scorer fidelity:** the local scorer was validated against the
   vendored grader source and reproduces baseline/v1/v2; the server's
   practice instance is a different draw (v1 server −38.03 vs local
   headline −34.20 — different reads, not a scorer discrepancy).

Premortem coverage (premortem-analysis five domains): technical —
runtime/format verified on practice + 66-mark synthetic, NEWCOMER_CAP
binding unmitigated (#3); market/regime — #1, dominant and
unmitigable before the final; execution — quota cost 1 unit, no
submit/sign/repo by this session; regulatory/compliance — entry
verified against all kit constraints (stdlib-only, deterministic, no
network, <1MB, <300s); external shock — scorer/read changes out of
control, mitigated by reading times/reads from `task.json` (nothing
hard-coded).

## 10. Transcript notes

- Entry: `~/workspace/makefun/pumpfun-entry-v3/` — `main.ts` (written,
  then REVISED via edit in-session: the two saturating fitters were
  refactored to share a `lagBuckets` helper; re-verified byte-identical
  output and identical backtest scores after the revision),
  `LICENSE` (MIT, copied from the kit starter, same as v1/v2),
  `BUILD_LOG.md` (this file).
- Scratch (not part of the entry): `~/workspace/makefun/pumpfun-v3-work/`
  — `scorer.mjs`, `backtest.mjs`, `diag.mjs` (copies from v2-work),
  `explore.mjs`, `ablate/patch.py` + `ablate/main.ts`,
  `longh.mjs`, `perread.mjs`, `synth66.mjs`.
- Prohibitions honored: no submit, no sign, no repo created; `~/.makefun`,
  `~/.baw`, `~/.baw2` untouched; `pumpfun-entry/`, `pumpfun-entry-v2/`,
  `pumpfun-repo/`, `pumpfun-v2-work/`, kit dir unmodified;
  `skills-a/` and `skills-b/` staging dirs only READ (manifest read per
  coordinator update; nothing written there).
- No secret, key, or signature appears in this log or in the session.
  Quota used: 2/10 (unchanged by this session). Deadline: 21:00 WIB.
- Post-finalization revision (13:36–13:43 WIB, same session): theme-1
  installer finished; manifest + all listed skills reviewed (§8);
  pre-committed robustness sweep run (§4, R0–R6, no design change);
  §§5/7/9 strengthened with the validity, anchor, key-assumptions, and
  premortem material. `main.ts` itself was NOT changed by the theme-1
  review — the design stood as built.
