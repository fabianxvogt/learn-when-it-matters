<!-- portfolio
{
  "title": "Learn When It Matters",
  "topic": "Artificial intelligence/Learning systems",
  "type": "research",
  "description": "A bounded research instrument for selective learning updates. Results remain inconclusive.",
  "demo": "https://learn-when-it-matters.fabian523417.chatgpt.site"
}
-->

# Learn When It Matters

Catalog project 1: a local-first selective online-learning laboratory. The browser app runs a seeded, browser-sized online regression comparison. The local runner adds a tiny recurrent learner, trains bounded policy parameters only on recurring training streams, then freezes them across held-out recurrence/noise settings and a never-repeating control.

Status: **public browser preview live from reviewed source `5ee67f10`; scientific attempt closed bounded INCONCLUSIVE** · classification: **EXPLORATORY** · license: MIT

## Try it locally

```sh
npm run dev
```

Open `http://127.0.0.1:4173` or the [public browser preview](https://learn-when-it-matters.fabian523417.chatgpt.site). The first screen is the working surface: configure a seeded recurrence/noise stream, update budget and probe accounting; run paired methods; inspect predictions, actions, charged probes and the ledger; pause or cancel at the browser limit; save, reload, export, import or reset. Run and import state is generation-guarded, so late work cannot replace a newer result or reset. The browser is a linear online-regressor preview. The tiny recurrent learner is local-CLI-only.

For the bounded local comparison:

```sh
npm run experiment -- --seeds=5 --horizon=240 --out=outputs/repeated-run.json
```

The runner uses common seeds, searches a small train-only parameter grid across three update-budget slices, locks the selected policies before held-out streams, and writes per-seed results plus paired bootstrap intervals. It is intentionally small and CPU-only.

The separate final measurement protocol is not the browser demo path. Two
registered attempts were consumed; the bounded scientific attempt is now
closed as inconclusive. Its raw artifacts stay private and the runner must not
be used as a retry. See [RESULTS.md](RESULTS.md) for the public result boundary.

It uses train-only calibration to select measured CPU/wall-time bins for both
model families, retains complete paired held-out rows, and reports
`inconclusive` rather than manufacturing a fixed-cost claim when timing or
coverage is not comparable. When strict bins do not intersect, it also reports
predeclared train-locked upper-cost ceilings without padding cheaper controls.
Its 600-second CPU and 1,800-second wall limits are intentional. The private
pilot artifacts are not browser results and do not establish a model win,
equivalence, inferiority, or universal claim. No full-v1 scientific claim is
made; the public preview is ordinary product delivery only, not a scientific
release. Product QA remains bounded and no full-v1 scientific claim follows.

## Research contract

The action boundary is strict: the prediction is frozen before `y_t`; a method's pre-label action sees `x_t`, current state and history through `t-1` only. Surprise uses input innovation, not the current residual. The usefulness gate builds a shadow candidate from an already revealed lagged sample, evaluates transfer on the next input after its label arrives, and lets that evidence affect later actions. Probe forwards, candidate gradients, state copies, rejected candidates, and elapsed wall-clock time are exported.

Required controls are always-update, periodic, fixed-seed random, pre-label surprise, past-only change-point, RLS tracking, and the usefulness gate. A result that only wins with free probes or label leakage is invalid. A complete matched-cost test may stop architecture growth if the gate does not beat tuned controls; this closed attempt had no strict comparison and therefore supports no negative hypothesis.

See [docs/README.md](docs/README.md) for the evidence contract and release notes, and [ROADMAP.md](ROADMAP.md) for the bounded v1 acceptance matrix.
