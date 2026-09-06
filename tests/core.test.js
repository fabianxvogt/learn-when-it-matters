import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, generateStream, runComparison, runMethod } from "../src/core.js";

test("stream generation is deterministic and bounded by the configured horizon", () => {
  const first = generateStream({ ...DEFAULT_CONFIG, horizon: 80, seed: 7 });
  const second = generateStream({ ...DEFAULT_CONFIG, horizon: 80, seed: 7 });
  assert.deepEqual(first, second);
  assert.equal(first.length, 80);
  assert.ok(first.every((sample) => Number.isFinite(sample.x) && Number.isFinite(sample.y)));
});

test("each method predicts before updating and respects the update budget", async () => {
  const config = { ...DEFAULT_CONFIG, horizon: 90, updateBudget: 11, seed: 13 };
  const stream = generateStream(config);
  for (const method of ["causal-gate", "always", "periodic", "random", "surprise", "change-point", "classical"]) {
    const result = await runMethod(method, stream, config);
    assert.equal(result.predictions.length, stream.length);
    assert.ok(result.updateCount <= config.updateBudget);
    assert.ok(result.cost >= result.updateCount);
  }
});

test("comparison is reproducible and includes probe/discard accounting", async () => {
  const config = { ...DEFAULT_CONFIG, horizon: 72, updateBudget: 20, seed: 19 };
  const first = await runComparison(config);
  const second = await runComparison(config);
  assert.deepEqual(first.results.map((result) => ({ methodId: result.methodId, mse: result.mse, cost: result.cost, updates: result.updates })), second.results.map((result) => ({ methodId: result.methodId, mse: result.mse, cost: result.cost, updates: result.updates })));
  const causal = first.results.find((result) => result.methodId === "causal-gate");
  assert.ok(causal.probeCount > 0);
  assert.ok(causal.discardedUpdates >= 0);
  assert.ok(causal.costLedger.probeForwards >= causal.probeCount);
  assert.ok(causal.costLedger.candidateGradients >= causal.probeCount);
});

test("comparison exposes a cooperative pause hook at the browser yield limit", async () => {
  let pauseChecks = 0;
  const config = { ...DEFAULT_CONFIG, horizon: 60, updateBudget: 12, seed: 20 };
  const result = await runComparison(config, () => {}, () => false, async () => {
    pauseChecks += 1;
  });
  assert.equal(result.results.length, 7);
  assert.ok(pauseChecks >= 7);
});

test("pre-label actions cannot change when only the current label changes", async () => {
  const config = { ...DEFAULT_CONFIG, horizon: 30, updateBudget: 20, seed: 31 };
  const first = generateStream(config);
  const second = first.map((sample, index) => index === 12 ? { ...sample, y: sample.y + 3 } : sample);
  for (const method of ["always", "periodic", "random", "surprise", "change-point", "causal-gate", "classical"]) {
    const a = await runMethod(method, first, config);
    const b = await runMethod(method, second, config);
    assert.equal(a.actionTrace[12], b.actionTrace[12], `${method} read current y before its action`);
  }
});
