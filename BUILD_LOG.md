# BUILD_LOG — pumpfun-top5-forecast-01 entry

Competition: predict the top 5 new pump.fun coins by market cap, 24 hours out.
Built 12 Nov 2026 (WIB) from the official kit. This file documents the approach,
the design decisions, the local scores, how to reproduce them, and the honest
risks. The entry itself is `main.ts` (Node 22, stdlib only, offline, deterministic).

## 1. Approach

**Monte Carlo over log-cap paths, averaged over the answer reads.**

Scoring is the mean over the 7 answer reads of (order log score + size log
score), each a sum over places of ln(p). The score is proper for place
marginals, so the optimal single forecast is the AVERAGE of the per-read true
distributions. The program therefore simulates each read separately and averages.

For each of 6,000 seeded simulations and each read horizon (hours from the last
mark, read from `task.json`):

1. **Known coins.** Each candidate's log10 market cap (in SOL) is sampled as:
   - mean = last log-cap + drift × tau × (1 − exp(−h/tau)), tau = 2h: momentum
     persists for ~2h then saturates (no explosive extrapolation);
   - drift = the coin's recent slope shrunk toward a venue prior (pool prior =
     half the observed pool drift, half a mild −0.05/h fade; curve prior = 0),
     clamped to ±1.2/h;
   - sd = venue sigma × sqrt(h), capped at 1.0 log;
   - **fade:** with probability from a fitted saturating curve, the cap
     collapses to the tail floor (~28 SOL);
   - **graduation:** curve coins graduate with an estimated per-hour hazard and
     jump to the empirical fresh-graduate cap distribution; non-graduated curve
     coins are capped at the curve ceiling (~355 SOL).
2. **Newcomer field.** Synthetic coins launched after the cut: Poisson count
   (arrival rate = top-20 entrants per hour from the recent half of marks),
   caps drawn from the empirical distribution of caps held by top-20-reaching
   coins while younger than 1h, with a 15% heavy-tail extension. Newcomers
   occupy places in the simulation, which both displaces known coins and
   yields the per-place newcomer mass. All caps are shifted by the record
   trend (slope of the top-1 log-cap over the recent half, shrunk 50%, capped
   at +0.2/h and +0.8 total).
3. **Ranking.** Simulated caps are ranked; place frequencies and per-place cap
   histograms (split by known-holder vs newcomer-holder) are accumulated and
   averaged over reads.

**Unnamed mass (the key calibration).** The per-place newcomer share `u` is
estimated DIRECTLY from the history's own lag transitions: for pairs of marks
(i, j) with i in the recent window (last 40%, min 6 marks), the share of top-5
slots at j held by coins absent from all marks ≤ i, bucketed by lag and fitted
with a saturating curve f(h) = fInf × (1 − exp(−h/tau)), shrunk toward the
prior (0.5, 2h) in proportion to the evidence. `u` = max(direct estimate,
simulated newcomer frequency), capped at 0.9. Named probabilities are scaled
so their sum is 1 − u; the residual stays unnamed, which is exactly the mass
the scorer spreads over un-named chart coins (including coins born after the
cut). The fade curve is fitted the same way (top-20 coins falling below rank
50 or vanishing).

**Naming rule (greedy, proper-scoring).** Per place, coins are named in
descending simulated probability while each coin's probability beats the
unnamed per-coin share ((1 − sum_named) / (100 − n_named)); at most 100 rows.
Naming a coin below that threshold would score worse than leaving it unnamed.
Probabilities are floored to 6 decimals, so per-place sums never exceed 1.

**Sizes.** Per place, the size distribution mixes the known-holder histogram
(weight 1 − u) and the newcomer-holder histogram (weight u), floored to
6 decimals over the 82 bins from `task.json`.

**top5 (tie-break only).** Exact assignment maximising expected agreement:
brute-force permutations over the 10 candidates with the most total place
mass, scoring Σ P(coin, k) × (5 − |assigned − k|).

**Candidates (≤300).** Top 120 by last cap + top 60 by momentum + all pool/
migrating coins + young (<2h) coins above 100 SOL, restricted to coins seen
in the last two marks.

**Determinism.** Fixed-seed mulberry32 + Box–Muller; no wall clock, no
iteration-order dependence (all collections sorted before use). Two runs on
the same input are byte-identical (verified).

## 2. Design decisions (and what was rejected)

- **Simulation over closed form.** The place distribution is an order
  statistic over hundreds of correlated coins plus newcomers; Monte Carlo
  handles the joint ranking and the size histograms in one pass.
- **Recent-window estimation.** Drift, volatility, arrival rate, record trend,
  and the lag fits all use the recent half/window of marks. The opening
  explosion regime must not dominate the estimate for the market at the cut.
  (An early version fitted lags over all pairs and badly overestimated fade
  and newcomer share once the market stabilised.)
- **Averaging over reads, not the last read.** The score is the mean over
  reads; averaging the per-read distributions is the Bayes-optimal single
  forecast for a log score.
- **No p=0 rows (considered, rejected).** Naming dead coins at p=0 would
  remove them from the unnamed divisor and raise the newcomer share, but a
  p=0 coin that places scores the floor (−9.21). The "certainly dead" call is
  model-dependent; the expected gain does not justify the tail risk.
- **No hard-coded rehearsal values.** Every horizon, edge, place count, and
  read time comes from `task.json`; every rate/curve is estimated from the
  history given, with priors only where the history is thin. The final
  horizons (7–13h) far exceed the practice horizons (10–60 min), so all
  time-scaling uses saturating laws, never linear extrapolation.
- **Regime-anchor blending (tried, reverted).** Blending the fitted curves
  with the last-two-transitions turnover scored slightly worse on the splits
  (−34.71 vs −34.21 read-weighted) and added complexity; reverted to the
  simpler shrunk fit.

## 3. Local scores (new entry vs house baseline)

No local grader exists (the scorer and reference data stay on the server), so
a faithful local scorer was written from the vendored `grader/forecast/
ranked.ts` (shape validation, `knownOnly` drop, per-read order + size log
scores, mean, agreement), plus a rolling time-split backtest: train on marks
0..cut, test on later marks as pseudo-reads using their top-100 charts.

House baseline = `starter/main.ts` (persistence on the last mark). Its stated
practice score is −40.408345 (order −21.380389, sizes −19.027956, agreement
56). The backtest reproduces the same ballpark (read-weighted −41.12), which
validates the harness.

| Split | Train → test | Baseline log (order/size/agree) | New entry log (order/size/agree) |
|---|---|---|---|
| cut 2 | 3 marks → 3 reads | −49.958 (−26.249 / −23.709 / 7) | **−42.891 (−24.242 / −18.649 / 7)** |
| cut 3 | 4 marks → 2 reads | −33.478 (−18.589 / −14.889 / 25) | **−25.580 (−16.278 / −9.302 / 21)** |
| cut 4 | 5 marks → 1 read | −29.867 (−15.246 / −14.621 / 17) | **−25.352 (−14.267 / −11.085 / 17)** |
| **Read-weighted mean** | | **−41.12** | **−34.20 (+6.9 nats)** |

The entry beats the baseline on every split, on both the order and the size
component. Development stages: v1 (simulation only) −39.84; v2 (+ direct
newcomer-share estimate, greedy naming, size mixing) −39.90 with a much
better cut-2 but regressions at cuts 3–4; v3 (recent-window fits + shrinkage
+ matched newcomer-cap distribution) −34.21; v4 (+ regime anchor) −34.71,
reverted. Final = v3 + 6,000 sims + a degenerate-input guard: −34.20.

**Full-history sanity check** (all 6 rehearsal marks, practice reads): the
forecast names 11 coins per place with unnamed mass 0.31/0.33/0.37/0.48/0.60
across places 1–5 — substantial, as it should be (3 of the last read's top 5
never appeared in any history row). MIHAO VI (last read's #2) carries
0.054–0.092 across places; Google (last read's #3) is named at all places.
Top probability anywhere is 0.125: diffuse, not overconfident.

**End-to-end verification** (exactly like the grader):
`mkdir -p out && MAKEFUN_INPUT_DIR=<input copy> MAKEFUN_OUTPUT_DIR=out node main.ts`
runs in ~3.4s on the 6-mark rehearsal input (limit 300s), output 13KB (limit
1MB), two runs byte-identical, output passes all format validations (exact
keys, row shapes, per-place sums ≤ 1, 5 distinct top5 mints). Node 22
compatible: type-stripping-safe TypeScript, stdlib (`node:fs`, `node:path`)
only, no network, no API keys, no model calls, no dependencies.

## 4. Reproduction

1. Copy the kit input: `cp -r <kit>/input /tmp/check/input`.
2. Run: `mkdir -p /tmp/check/out && MAKEFUN_INPUT_DIR=/tmp/check/input MAKEFUN_OUTPUT_DIR=/tmp/check/out node main.ts`.
3. Determinism: run twice, `cmp` the two `forecast.json` files.
4. Backtest splits (harness kept outside the entry, in the build session's
   scratch): split `history.ndjson` at mark `cut`, build a split `task.json`
   with `reads` = the later mark times, run the entry, score with the local
   scorer against the later marks' top-100 charts as answers.

## 5. Honest risks and weaknesses

- **The final horizons (7–13h) are 7–13× the longest practice horizon
  (60 min).** All long-horizon behaviour (fade saturation, momentum decay,
  vol cap, trend cap) is extrapolated from ≤50-min lags in the rehearsal.
  The final 66-mark history can measure 7h+ lags directly, and the program
  will use them — but the functional forms (saturating curves) are assumed,
  not verified, at those lags. If the real long-lag turnover is faster or
  slower than a saturating curve, calibration suffers.
- **Regime change.** Pump.fun top-5 composition is chaotic early and
  stabilises later; a sudden regime shift after the cut (a mega-launch, a
  market-wide cool-down) cannot be foreseen. The forecast hedges with large
  unnamed mass, which bounds the damage but also caps the upside.
- **The newcomer field is the largest single uncertainty.** At 7–13h, most
  top-5 slots may be held by coins launched after the cut. The forecast's
  edge over the baseline comes mostly from (a) leaving the right amount of
  mass unnamed and (b) the size distribution — not from naming the winners,
  which is largely impossible.
- **The house model forecast is the real bar.** A prize needs a score strictly
  above the best house entry (baseline or a one-call superbot given the rules
  + latest 12 marks × top 30 rows). Beating the baseline by ~7 nats on
  rehearsal splits does not guarantee beating the house model on the final.
- **Mayhem coins were absent from the rehearsal** (zero rows). The program
  treats them as pool coins (their `market_cap_lamports` is already computed
  on the right supply by the house), which follows the rules, but the
  graduation/fade behaviour of mayhem coins is unobserved.
- **Monte Carlo noise.** 6,000 sims × 7 reads = 42,000 samples per place;
  standard error on a p=0.1 probability is ~0.0015. Small probabilities
  (<0.005) are noisy, but the greedy naming rule keeps them unnamed, so the
  noise mostly does not reach the output.
- **Backtest weakness.** Only 6 marks / 6 test reads exist, all from the
  opening hour. The splits measure short-horizon skill in a fast-changing
  regime; they are a sanity check, not a reliable estimate of the final
  score. Model choices were made from principles (proper scoring, saturating
  time-scaling, recency weighting), not by tuning to the splits — the one
  variant that was tuned against the splits (v4's anchor) was reverted when
  it did not help.

## 6. Transcript requirements (from RULES.txt — for the submitter)

The parent agent submits; this section only documents what RULES.txt
requires, per "Enter" step 3 and "The transcript gate":

- The submission MUST include AI transcripts: every session that produced
  the entry, uploaded WHOLE, including subagent sessions. Sessions must fall
  inside the competition window (opening → receipt, ±60s clock skew).
  Never fabricate sessions.
- Bundle with: `node cli/makefun.mjs bundle --repo <repo> --out
  transcripts.tar.gz --redact "<personal detail>"` (repeat `--redact`; the
  bundle also strips emails/paths/usernames/credentials).
- Automated checks: `transcripts_present`; `thinking_wellformed` (every
  message timestamped; no assistant/tool message >60s behind the latest
  before it; every tool result answers an earlier tool call; self-exported
  session files must name the harness); `thinking_in_window` (all
  timestamps within opening→receipt ±60s); `thinking_committed`;
  `thinking_reproduces` (≥30% of counted lines accounted for; the
  entrypoint has ≥1 authored line); `thinking_turns` (≥5 assistant turns
  carrying text/thinking); `thinking_priced` (100% priced to a known model;
  self-reported sessions ≥50% usage coverage, ≤500 tokens/sec);
  `thinking_revised` (some file takes its final content from ≥2 assistant
  write/edit messages — satisfied: `main.ts` was written, then revised by
  edit in this session); `thinking_fresh` (100% fresh; anchor-line rule for
  source bundles).
- Repo requirements: public on GitHub, created after the opening,
  OSI-approved LICENSE (MIT, copied from `starter/LICENSE`), `main.ts` at
  the repo root (no `main.py` alongside). Max 10 submissions/day and 10
  total; the last submission before the deadline is the final entry.
