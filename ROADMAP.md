# Roadmap

State: **verification / capped pilot inconclusive; train-only K=5 amendment frozen for review**

## Now

- Preserve the private capped-pilot result as **INCONCLUSIVE/NON-COMPARABLE**: neither model had a strict common bin or a train-feasible upper ceiling, so no held-out matrix ran.
- Get independent interpretation review of the exact source/result pair before any new run or research claim.
- Review the new train-only `raw-batch-cv-k5-v1` amendment at its new source SHA; no new pilot is authorized yet.
- Run a fresh browser journey on desktop Chromium and a narrow mobile viewport.
- Verify clean build, tests, save/reload, export/import and malformed JSON rejection.
- Run the independent counterexample fixtures and the local repeated-seed runner.
- Review staged source for private data, planning files and generated dumps.

## Next

- Any new measured run needs a new explicit owner decision; do not retry, retune, cherry-pick, or grow architecture from this inconclusive result.
- If reviewed and authorized, register/save/deploy the static Site build privately first.
- Compare the local held-out budget slices with the browser example before making any research claim.
- Review the private capped-pilot report and the amended `scripts/run-final-investigation.mjs` measurement semantics; do not call its empty measured-bin result a frontier or negative proof.

## Later

- Keep the tiny recurrent learner local-only; extend it only if the benchmark exposes a live, nontrivial hypothesis worth the added cost.
- Add confidence intervals to the browser summary only if they remain interpretable at browser size.

## Done

- [x] Browser working surface with seeded stream, recurrence/noise controls and update budget.
- [x] Always, periodic, random, pre-label surprise, change-point, RLS and lagged usefulness methods.
- [x] Prediction/action/probe/cost traces; probe forwards, gradients, copies, discarded work and elapsed time.
- [x] Versioned localStorage save and portable JSON export/import with malformed-input rejection.
- [x] CPU-only local repeated-run CLI with train-only bounded tuning, frozen update-budget slices, held-out recurring and never-repeating controls.
- [x] Tiny recurrent learner runs locally; browser linear preview is labeled separately.
- [x] Focused README, docs navigation, MIT license and static hosting metadata.
- [x] Separate final-investigation runner with train-only CPU/wall calibration, strict bins, pairwise componentwise upper-cost ceilings, per-model strict manifests, seed-safe pairing, full execution fingerprints, timing tolerances, replay checks and inconclusive outcomes.
- [x] One registered capped final-investigation pilot at `1321821191e92a832a03426fb1a2b040ca7f1bc0`; result retained privately as inconclusive because both strict bins and upper ceilings were unavailable before held-out evaluation.
- [x] Train-only `raw-batch-cv-k5-v1` amendment: five outer raw-total batches after warmup, fixed `R` calls per batch, raw-total CV, retained segments/outliers, RSS provenance, and pre-held-out freeze controls; new pilot still pending review.

## Full-v1 acceptance matrix

| Check | Evidence | State |
| --- | --- | --- |
| Predict before label | `src/core.js` freezes prediction and action before `target` is read; tests cover trace determinism | implemented; test pending in this checkout |
| No same-step residual gating | Surprise uses input innovation; change-point uses prior residual state | implemented |
| Lagged usefulness probe | Candidate from `t-1`, shadow transfer resolved on `t`, evidence affects `t+1+` | implemented |
| Matched accounting | Accepted updates plus probe forwards, candidate gradients, optimizer/matrix ops, copies, discarded candidates, budget-skipped requests and measured CPU/wall ms | implemented; final pilot pending |
| Required controls | Seven methods share paired streams and locked config | implemented |
| Held-out evaluation | Final runner locks measured candidates on training seeds and preserves complete paired held-out rows | implemented; final run pending |
| Repeated seeds + uncertainty | CLI emits per-seed paired deltas and bootstrap intervals | implemented; run pending |
| Tiny recurrent local path | `src/recurrent.js` is wired into the CLI for held-out and never-repeating repeated runs | implemented; run pending |
| Persistence/export | localStorage, `lwm.v1` JSON export/import and rejection path | implemented; browser QA pending |
| Browser QA | desktop Chromium + narrow mobile | pending |
| Release | public Site deployed; final model-study acceptance remains separate from preview release | partial |
