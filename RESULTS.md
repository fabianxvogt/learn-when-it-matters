# Results: bounded inconclusive measurement

## Question

The registered question was whether a lagged usefulness gate could reduce
prequential squared error at matched accepted-update and measured-compute cost
against always-update, periodic, fixed-seed random, pre-label surprise,
past-only change-point, and RLS controls. Prediction and action had to be
chosen before the current label; probes, discarded work, copies, gradients and
elapsed time had to be charged.

The project is **EXPLORATORY**. This document records a bounded measurement
identification result, not a model test success or a full-v1 claim.

## Two registered attempts

1. The first capped attempt used source
   `1321821191e92a832a03426fb1a2b040ca7f1bc0`. Its private report was
   inconclusive/non-comparable: no strict matched-cost matrix was available.
2. The separate K=5 measurement amendment used source
   `ecd562791963f535dd33fc0380fb82477a0943a5`. It preserved the first result,
   changed only the predeclared training measurement unit, and consumed the
   second and final pilot authorization.

The amendment chronology was: the timer-floor hypothesis was not reproduced;
it was not called a bug; five outer raw-total batches after warmup were
registered; all segments and outliers were retained; the exact `0.20` CV rule,
fixed training-selected `R`, training freeze, ceilings and caps stayed fixed;
RSS provenance was repaired to documented Node `process.resourceUsage().maxRSS`
kilobytes; then one run was executed and independently interpreted.

## What the K=5 run identified

- `102` training calibration rows: 51 per model, K=5 raw batches, fixed R=3.
- `0` strict held-out rows and `0` strict common bins.
- `672` partial train-locked ceiling rows, all for the recurrent model;
  `644` were at or below a ceiling and `28` were over it.
- Training froze before any held-out work. The strict conclusion-eligibility
  flag was `false`.

The linear model had only 6 comparable calibration rows out of 51. CV
instability removed causal-gate, always-update and classical candidates, so a
seven-method strict bin could not exist. The recurrent model had 16 comparable
rows out of 51, including every method, but its accepted CPU and wall timing
ranges did not overlap. These are different failures: missing comparability
from CV instability for linear, and observed componentwise non-overlap for
recurrent. They do not show that any method is worse.

Ceiling rows are partial descriptive evidence. Their incomplete coverage does
not make a matched-cost result, and no best-method claim is made. The final
classification is **INCONCLUSIVE measurement identification**. It supports no
usefulness-gate win, baseline inferiority, equivalence, universal claim, or
negative hypothesis. The current scientific attempt is closed; no rerun,
calibration, tuning, benchmark, or architecture expansion follows.

## Runtime limits and provenance

The amended run used Node `v22.23.2` on Apple M3 Pro arm64 Darwin. It used
12.898038 process CPU seconds and 31.308810625 wall seconds, below the declared
600-second CPU and 1,800-second wall caps, without watchdog cutoff. RSS was
recorded from `process.resourceUsage().maxRSS` in documented Node kilobytes.
The private raw JSON and run recordings remain outside Git.

## Reproduce the product instrument locally

From a clean checkout, regenerate the public local comparison and static build:

```sh
npm test
npm run build
npm run experiment -- --seeds=5 --horizon=240 --out=outputs/repeated-run.json
npm run dev
```

Open `http://127.0.0.1:4173` to use the seeded browser instrument. It exposes
recurrence, noise, seed, update budget and probe accounting; prediction/action
traces; charged probe and discarded-work totals; pause/cancel; local save and
reload; versioned export/import; malformed JSON rejection; and a keyboard-
accessible chart table. The browser is a linear preview. The recurrent model
is local-CLI-only. These steps reproduce an instrument and evidence slice, not
the closed scientific conclusion.

Independent product review is required before any public push or deployment.
