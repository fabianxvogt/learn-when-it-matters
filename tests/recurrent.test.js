import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, generateStream } from "../src/core.js";
import { runRecurrentMethod } from "../src/recurrent.js";

test("tiny recurrent learner emits a bounded, pre-label trace", async () => {
  const config = { ...DEFAULT_CONFIG, horizon: 54, updateBudget: 15, seed: 51 };
  const result = await runRecurrentMethod("causal-gate", generateStream(config), config);
  assert.equal(result.model, "tiny-recurrent");
  assert.equal(result.predictions.length, 60);
  assert.equal(result.actionTrace.length, 60);
  assert.ok(result.costLedger.candidateGradients >= result.probeCount);
  assert.ok(result.costLedger.elapsedWallMs >= 0);
});

test("tiny recurrent pre-label action is unchanged by the current label", async () => {
  const config = { ...DEFAULT_CONFIG, horizon: 32, updateBudget: 12, seed: 52 };
  const first = generateStream(config);
  const second = first.map((sample, index) => index === 15 ? { ...sample, y: sample.y + 4 } : sample);
  for (const method of ["causal-gate", "always", "periodic", "random", "surprise", "change-point", "classical"]) {
    const a = await runRecurrentMethod(method, first, config);
    const b = await runRecurrentMethod(method, second, config);
    assert.equal(a.actionTrace[15], b.actionTrace[15], `${method} read current y before its recurrent action`);
  }
});

test("tiny recurrent classical row is an actual RLS comparator", async () => {
  const config = { ...DEFAULT_CONFIG, horizon: 60, updateBudget: 12, seed: 53 };
  const result = await runRecurrentMethod("classical", generateStream(config), config);
  assert.equal(result.model, "tiny-recurrent");
  assert.ok(result.costLedger.matrixOperations > 0);
  assert.equal(result.costLedger.matrixOperations, result.updateCount * 30);
});
