# Review record

Classification: **EXPLORATORY** pending independent code/research review. The mechanism is a narrow empirical hypothesis in a crowded test-time-learning/surprise-gating setting; the project makes no novelty claim.

## Release gates

- Source commit is exact and reproducible from a clean checkout.
- Unit tests, local repeated-run protocol, and the supplied independent counterexample fixtures pass.
- Browser QA covers desktop Chromium and a narrow mobile viewport, including a fresh run, refresh, save/reopen, export/import, malformed input, cancel/reset and visible errors.
- Staged content contains no private planning, credentials, recordings, bulky dumps or hidden datasets.
- Public deployment waits for the parent review result/release instruction. Until then, the static Site remains a local validated artifact.

## Strongest counterargument

The usefulness gate may simply be a delayed heuristic that cannot outperform tuned controls once shadow-probe compute, state copies, rejected work and elapsed time are charged. This negative result is acceptable and should stop architecture growth.

The current local evidence is narrow: linear RLS is strongest on raw MSE at a higher synthetic matrix-operation cost, and the usefulness gate does not show a universal advantage. The three budget slices are evidence slices, not a formal compute Pareto proof. The recurrent extension now includes a real recurrent RLS comparator; the browser remains a linear preview.
