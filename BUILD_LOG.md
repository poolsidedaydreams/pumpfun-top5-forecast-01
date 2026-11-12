# Build log — pumpfun-top5-forecast-01 entry, version 8

Written 12 November 2026, in a fresh session, from the prose design
documents only. No prior entry code, lab script, or cached forecast
was read before `main.ts` was written. The implementation below is my
own reconstruction of the specified model.

## What this entry is

The v6 base model (Monte Carlo over candidate coins, lag-pair fits,
place-level size anchor, effective-sample-size blending, horizon
tempering) plus the two additions validated in the v8 lab:

1. **Horizon-gated size widening + downward shift**, applied to the
   fully formed size distributions, identically at all five places.
2. **Half-weight order ensemble**: the base order probabilities
   blended 50/25/25 with a Luce model and a direct scoring model,
   both converted to per-place probabilities by Gumbel-top-5
   sampling. The top 5 list is recomputed from the blended
   first-place probabilities.

Sizes are handled by addition 1 only; the two additions touch
disjoint parts of the forecast and compose without interaction.

## Base model, as implemented

**Inputs.** `$MAKEFUN_INPUT_DIR` (else `/input/`): `history.ndjson`
(one JSON mark per line, oldest first) and `task.json`. All times,
edges, and the cadence come from `task.json`; nothing is hardcoded.
Output is exactly `{probabilities, top5, sizes}` at
`$MAKEFUN_OUTPUT_DIR/forecast.json`. Size is
`log10(market_cap_lamports) - 9` throughout.

**Lag-pair saturating fits.** For every ordered pair of marks
(i, j), newcomer observations (was the coin at each place in mark j
first seen after mark i?) and fade observations (did a top-20 coin of
mark i vanish from mark j or lose more than 1 dex?) are fitted per
place to `C * (1 - exp(-h/tau))` by grid search (C 0.50–1.00 step
0.05; tau from 0.25 to 24 hours), then shrunk toward the pooled fit
with weight `n/(n+10)`. Tie-breaks prefer fast/high for newcomer
fits and slow/low for fade fits. With fewer than two marks the
defaults are newcomer (0.9, 1h) and fade (0.5, 4h).

**Estimated quantities.** Venue-specific diffusion from pooled
consecutive-mark deltas (median absolute delta / sqrt(dt) / 0.6745,
clamped [0.05, 0.6], pooled fallback, default 0.3). A flat graduation
hazard from observed curve-to-pool/migrating transitions over
curve-coin exposure hours, clamped [0.001, 0.5], default 0.05. The
post-graduation jump is a unimodal Normal fitted to first
pool/migrating observations after a curve observation (sd clamped
[0.25, 0.8]), falling back to Normal(2.05, 0.5). Newcomer peak caps
are the peak sizes of coins seen in a top 20 while under one hour
old. The market trend is the OLS slope of per-mark top-20 median
size, clamped to ±0.2 dex/hour. The arrival rate counts first-time
top-20 entrants over the recent half of marks, divided by the span
plus one cadence interval, defaulting to 20/hour.

**Candidates.** Top 120 by last size, top 60 by momentum, then
pool/migrating coins and coins under one hour old, filled in that
priority order, capped at 300. Momentum compares the last
observation with the latest observation at least one hour earlier
(the earliest observation if none is that old), over elapsed hours
floored at 1/6, capped to ±1 dex/hour.

**Monte Carlo.** 40,000 paths per read, one seeded generator
(mulberry32 + Marsaglia polar Gaussians; Knuth Poisson up to
lambda 30, Normal approximation above). Per path: momentum-saturated
drift `mom * 2 * (1 - exp(-h/2))`, venue diffusion capped at one dex
of spread, fade-to-floor (terminal − 2.0 dex + 0.2·Z) at the fitted
fade probability for the coin's last rank (clamped to 0.95),
graduation jumps for curve coins at the flat hazard with the curve
ceiling 2.55 dex otherwise, and a newcomer field of up to 200 coins
drawn from the peak caps plus the clamped trend shift and a 15%
tail extension (exponential, mean 0.25 dex). Each path keeps its top
5 by terminal size in a single pass. Counts pool over paths × reads
into per-place coin frequencies, newcomer frequencies, and size
histograms over the 82 bins.

**Order naming.** Unnamed mass per place is
`min(0.9, max(direct lag newcomer estimate at the mean horizon,
simulated newcomer frequency))`. Named probabilities are scaled to
the named sum, the top 100 coins per place are kept, rescaled,
floored at 1e-6, and zeros dropped.

**Sizes.** Per place, the Monte Carlo histogram blends with a
conservative anchor (Normal centred on the last mark's place size
plus a through-origin drift capped at ±0.5 dex, spread from the
median absolute place-size increment scaled by sqrt(horizon),
clamped [0.15, 0.6]) with weight `w = min(0.5, ESS/(ESS+40))`,
where ESS is the effective sample size of the histogram. The blend
is smoothed with kernel [0.25, 0.5, 0.25], tempered by raising to
power `1 + 0.15*exp(-hbar/2)` (sizes only), floored at 1e-6, and
renormalised.

## The two v8 additions

**Addition 1 — shift + widen.** After the size distributions are
fully formed, each is shifted 0.2·min(hbar/10, 1) dex downward by
linear interpolation over bin centres (first centre a quarter bin
below the first edge, last centre a quarter bin above the last
edge, zero outside the range), renormalised, then convolved with a
discrete Gaussian kernel of sd 0.15·sqrt(hbar/10) truncated at ±3
sd, mass outside the bin range dropped, renormalised, floored at
1e-6, and renormalised again. At 10 hours this is a 0.2 dex downward
shift with 0.15 dex of extra spread; at 1 hour it is nearly a no-op.

**Addition 2 — order ensemble.** Candidate set: top 300 coins by
last size. The Luce model uses strength `exp(1.5*(lastSize - 2.2))`.
The scoring model uses
`1.2*(lastSize - 2.2) + 2*momentum + 0.4 if pool - 0.5*log10(ageHours
+ 0.25) + 0.3*log10(last curve reserves in SOL + 1) if curve`,
clamped to ±20 in log space. Each model is sampled with 20,000
Gumbel-top-5 draws under a fixed seed, scaled to the base model's
named sum per place, and blended 0.5 base / 0.25 Luce / 0.25
scoring model. Top 100 per place, rescaled, floored, zeros dropped.
The top-5 list is recomputed from the blended place-1
probabilities.

## Judgment calls where the prose underspecified details

- The ESS gate constant is 40 and the blend cap is 0.5, per the v6
  record (SIZE_BLEND_MAX raised from 0.3 to 0.5).
- Momentum falls back to the earliest observation when no
  observation is an hour old; a single observation gives zero.
- The fade-to-floor drop is 2.0 dex with 0.2 dex of noise, applied
  after the graduation jump / ceiling step within a path.
- The smoothing kernel drops the quarter-mass that falls off the
  edge bins and the distribution is renormalised afterwards.
- Tempering is applied before the 1e-6 floor, and the distribution
  is renormalised after each step.
- The shift/widen interpolation treats the distribution as zero
  outside its bin-centre range; the widening convolution likewise
  drops out-of-range mass and renormalises.
- Output probabilities are floored to 6 decimals (never rounded
  up), so per-place sums stay at or below 1; rows that floor to
  zero are dropped.
- Row order is deterministic: probabilities by place, then
  probability descending, then mint ascending; sizes by place,
  then bin.
- If the history is empty, or the model throws, an even-spread
  fallback forecast is written so the run always produces a valid
  file. The fallback was exercised on a one-mark empty history.

## Determinism

Fixed seeds (Monte Carlo 123456789, ensemble 987654321), no wall
clock, no environment randomness, no `Math.random`. Two consecutive
runs on the kit input produced byte-identical output.

## Verification

Gate results from the local scorer (selection cuts 2–4, held-out
cut 1, and the 16 synthetic datasets) are recorded in the session
report; see the numbers there. Runtime is roughly 11 seconds on the
practice instance, far inside the 300-second limit, and output is
about 50 KB, far inside the 1 MB limit.

## What was deliberately left out

The pure place-level size model, the bimodal graduation jump, the
progress-dependent hazard, the reserves-gated graduation hazard
(the underlying reserves signal is the best open idea for a future
session, not part of this design), the newcomer-cap and diffusion-cap
variants, and any baked-in public-data priors — all per the design
document's exclusions.
