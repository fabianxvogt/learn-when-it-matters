# Learn When It Matters

Catalog project 1: a local-first selective online-learning laboratory. The browser app runs a seeded, browser-sized online regression comparison. The local runner adds a tiny recurrent learner, trains bounded policy parameters only on recurring training streams, then freezes them across held-out recurrence/noise settings and a never-repeating control.

Status: **verification** · classification: **EXPLORATORY** · license: MIT

## Try it locally

```sh
npm run dev
```

Open `http://127.0.0.1:4173`. The first screen is the working surface: configure recurrence, noise, update budget and probe accounting; run paired methods; inspect the trace and ledger; save, export, import or reset.

For the bounded local comparison:

```sh
npm run experiment -- --seeds=5 --horizon=240 --out=outputs/repeated-run.json
```

The runner uses common seeds, searches a small train-only parameter grid across update budgets, locks the selected policies before held-out streams, and writes per-seed results plus paired bootstrap intervals. It is intentionally small and CPU-only.

## Research contract

The action boundary is strict: the prediction is frozen before `y_t`; a method's pre-label action sees `x_t`, current state and history through `t-1` only. Surprise uses input innovation, not the current residual. The usefulness gate builds a shadow candidate from an already revealed lagged sample, evaluates transfer on the next input after its label arrives, and lets that evidence affect later actions. Probe forwards, candidate gradients, state copies, rejected candidates, and elapsed wall-clock time are exported.

Required controls are always-update, periodic, fixed-seed random, pre-label surprise, past-only change-point, RLS tracking, and the usefulness gate. A result that only wins with free probes or label leakage is invalid. If the usefulness gate does not beat tuned controls on held-out streams at matched cost, the correct outcome is the benchmark/negative result; architecture growth stops.

See [docs/README.md](docs/README.md) for the evidence contract and release notes, and [ROADMAP.md](ROADMAP.md) for the bounded v1 acceptance matrix.
