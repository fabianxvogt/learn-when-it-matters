import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, METHOD_DEFS, generateStream } from "../src/core.js";
import { isValidImportedRun } from "../src/run-validation.js";

function validRun() {
  const config = { ...DEFAULT_CONFIG, horizon: 60, updateBudget: 12 };
  const stream = generateStream(config);
  const ledger = { forwardPasses: 60, probeForwards: 0, gradientEvaluations: 0, candidateGradients: 0, optimizerOperations: 0, matrixOperations: 0, candidateGradientOperations: 0, stateCopies: 0, discardedWork: 0, budgetSkipped: 0, elapsedWallMs: 1, totalWork: 60 };
  return {
    version: 1,
    config,
    stream,
    results: METHOD_DEFS.map((method) => ({
      methodId: method.id,
      predictions: Array(60).fill(0),
      losses: Array(60).fill(0.1),
      actionTrace: Array(60).fill("skip"),
      labels: stream.map((sample) => sample.y),
      updates: [],
      probeTrace: [],
      mse: 0.1,
      errorPerCost: 0.001,
      updateCount: 0,
      probeCount: 0,
      discardedUpdates: 0,
      discardedCandidates: 0,
      budgetSkipped: 0,
      cost: 60,
      costLedger: ledger
    }))
  };
}

test("import validation accepts a complete finite bounded run", () => {
  assert.equal(isValidImportedRun(validRun()), true);
});

for (const [name, mutate] of [
  ["nonfinite loss", (run) => { run.results[0].losses[0] = Number.NaN; }],
  ["out-of-range recurrence", (run) => { run.config.recurrence = 1.5; }],
  ["out-of-range probe step", (run) => { run.results[0].probeTrace = [{ createdAt: 60, resolvedAt: 60, improvement: 0, useful: false }]; }],
  ["nonfinite ledger", (run) => { run.results[0].costLedger.elapsedWallMs = Number.POSITIVE_INFINITY; }],
  ["invalid action", (run) => { run.results[0].actionTrace[0] = "label-leak"; }]
]) {
  test(`import validation rejects ${name}`, () => {
    const run = validRun();
    mutate(run);
    assert.equal(isValidImportedRun(run), false);
  });
}
