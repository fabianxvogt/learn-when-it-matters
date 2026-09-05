# Roadmap

State: **verification**

## Now

- Run a fresh browser journey on desktop Chromium and a narrow mobile viewport.
- Verify clean build, tests, save/reload, export/import and malformed JSON rejection.
- Run the independent counterexample fixtures and the local repeated-seed runner.
- Review staged source for private data, planning files and generated dumps.

## Next

- Independent source/research review against the frozen causal contract.
- If reviewed and authorized, register/save/deploy the static Site build privately first.
- Compare the local held-out budget slices with the browser example before making any research claim.

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

## Full-v1 acceptance matrix

| Check | Evidence | State |
| --- | --- | --- |
| Predict before label | `src/core.js` freezes prediction and action before `target` is read; tests cover trace determinism | implemented; test pending in this checkout |
| No same-step residual gating | Surprise uses input innovation; change-point uses prior residual state | implemented |
| Lagged usefulness probe | Candidate from `t-1`, shadow transfer resolved on `t`, evidence affects `t+1+` | implemented |
| Matched accounting | Accepted updates plus probe forwards, candidate gradients, optimizer/matrix ops, copies, discarded candidates, budget-skipped requests and wall ms | implemented |
| Required controls | Seven methods share paired streams and locked config | implemented |
| Held-out evaluation | CLI reports unseen recurrence/noise and never-repeating control with train-locked policies | implemented; run pending |
| Repeated seeds + uncertainty | CLI emits per-seed paired deltas and bootstrap intervals | implemented; run pending |
| Tiny recurrent local path | `src/recurrent.js` is wired into the CLI for held-out and never-repeating repeated runs | implemented; run pending |
| Persistence/export | localStorage, `lwm.v1` JSON export/import and rejection path | implemented; browser QA pending |
| Browser QA | desktop Chromium + narrow mobile | pending |
| Release | exact source commit; Site private registration/deploy after review authorization | pending |
