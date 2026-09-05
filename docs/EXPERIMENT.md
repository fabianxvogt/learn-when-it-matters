# Pre-registered local experiment

## Question

At matched accepted-update and measured-compute budgets, can a lagged usefulness gate reduce mean prequential squared error versus always-update, tuned periodic, fixed-seed random, pre-label input-surprise, past-only change-point, and RLS tracking controls?

## Protocol

1. Use the browser-sized linear online regressor and seeded stream generator in `src/core.js`; the local-only extension in `src/recurrent.js` repeats the same contract with a tiny recurrent hidden state.
2. Use the shared supported config domain: horizon 60–1200, update budget 1–horizon (an input budget of 0 is coerced to the minimum supported budget of 1), recurrence 0–0.98, and noise 0–0.45. Linear and recurrent runners normalize these values identically.
3. Freeze `ŷ_t` and choose the action before reading `y_t`; callbacks cannot see the current label, current residual, held-out outcomes or hidden regime marker.
4. Search only a bounded parameter grid on recurring training streams. The CLI freezes the selected periodic/random/surprise/change-point/usefulness parameters separately for each of three accepted-update budget slices before evaluating held-out recurring streams with an unseen period/noise setting and a never-repeating control. These slices are not presented as a formal Pareto frontier.
5. Run five or more paired seeds by default. Record per-seed MSE, area-under-adaptation proxy (the loss trace), first-step loss, recovery proxy, update count, probe count, discarded candidates, budget-skipped requests, forward passes, candidate gradients, optimizer operations, RLS matrix operations, state copies, total work and elapsed wall-clock time. The runner does not call wall time CPU time.
6. Use the CLI output's paired differences and deterministic bootstrap interval as uncertainty context. This is not a formal confidence guarantee for arbitrary streams.

## Invalid paths

Same-step residual gating, current-label lookahead, free probes, regime-ID access, and tuning on held-out labels invalidate the causal comparison. A same-step post-label residual diagnostic could be useful in a separate study, but it is not part of this pre-label protocol.

## Stop rule

If usefulness gating does not beat the Pareto frontier of tuned periodic/change-point/classical controls on unseen streams at matched cost, or wins only after free-probe or label-leakage accounting, stop architecture growth and release the benchmark as an **INCREMENTAL** evaluation instrument / negative result after review.
