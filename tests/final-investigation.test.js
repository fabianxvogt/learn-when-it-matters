import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, generateStream } from "../src/core.js";
import { METHOD_DEFS } from "../src/core.js";
import { analyzeCostCeilings, assessCompletion, auditCoverage, buildEvaluationManifest, configFingerprint, constructCommonBins, constructCostCeilings, measureBatchInvocation, replayTrace, runReplayAudit, selectCeilingCandidates, selectLockedCandidates, signPermutation, timingCoverageEligible, timingIsComparable } from "../scripts/run-final-investigation.mjs";

function syntheticCell(model, methodId, trainMse = 0.1, cpuMs = 10, wallMs = 10) {
  return {
    model,
    methodId,
    budget: 30,
    params: {},
    trainMse,
    timingCpuMs: cpuMs,
    timingWallMs: wallMs,
    timingCv: 0.01,
    calibration: { comparable: true, cpu: { cv: 0.01 }, wall: { cv: 0.01 } }
  };
}

test("measured common-bin selection requires every method and keeps train-only ordering", () => {
  const table = [];
  for (const model of ["linear-online", "tiny-recurrent"]) {
    for (const method of METHOD_DEFS) {
      table.push(syntheticCell(model, method.id, method.id === "causal-gate" ? 0.01 : 0.1));
    }
  }
  const bins = constructCommonBins(table, "linear-online", { maxBins: 3 });
  assert.equal(bins.status, "ok");
  assert.equal(bins.bins.length, 1);
  const selections = selectLockedCandidates(table, "linear-online", bins.bins);
  assert.deepEqual(Object.keys(selections[0].selections).sort(), METHOD_DEFS.map((method) => method.id).sort());
  assert.equal(selections[0].selections["causal-gate"].trainMse, 0.01);
});

test("a missing comparable method makes fixed-cost identification inconclusive", () => {
  const table = METHOD_DEFS.slice(0, -1).map((method) => syntheticCell("linear-online", method.id));
  const bins = constructCommonBins(table, "linear-online", { maxBins: 3 });
  assert.equal(bins.status, "no-common-bin");
  assert.deepEqual(bins.missingMethods, ["classical"]);
});

test("a strict-bin gap still exposes a train-locked upper-cost ceiling", () => {
  const table = METHOD_DEFS.map((method, index) => syntheticCell("linear-online", method.id, 0.1 + index / 100, 10 + index * 20, 10 + index * 20));
  const bins = constructCommonBins(table, "linear-online", { maxBins: 3 });
  assert.equal(bins.status, "no-common-bin");
  const ceilings = constructCostCeilings(table, "linear-online", { maxCeilings: 1 });
  assert.equal(ceilings.status, "ok");
  assert.equal(ceilings.ceilings.length, 1);
  const selections = selectCeilingCandidates(table, "linear-online", ceilings.ceilings);
  assert.ok(METHOD_DEFS.every((method) => selections[0].selections[method.id]));
  assert.ok(selections[0].selections.always.timingCpuMs <= ceilings.ceilings[0].cpuMs);
});

test("timing comparability and paired sign permutation are explicit", () => {
  assert.equal(timingIsComparable({ cpu: { cv: 0.2 }, wall: { cv: 0.19 } }), true);
  assert.equal(timingIsComparable({ cpu: { cv: 0.21 }, wall: { cv: 0.01 } }), false);
  const result = signPermutation([-1, -1, 1, 1]);
  assert.equal(result.permutations, 16);
  assert.equal(result.observedMean, 0);
});

test("exactly twenty percent out-of-ceiling rows is inconclusive", () => {
  assert.equal(timingCoverageEligible(5, 5), true);
  assert.equal(timingCoverageEligible(4, 5), false);
  assert.equal(timingCoverageEligible(3, 5), false);
});

test("strict no-bin status cannot become a completed conclusion", () => {
  assert.deepEqual(assessCompletion({ strictAvailable: false, strictCoverageComplete: false, ceilingCoverageComplete: true, ceilingTimingComplete: true }), { complete: false, status: "inconclusive-no-strict-bin" });
  assert.deepEqual(assessCompletion({ strictAvailable: true, strictCoverageComplete: true, ceilingCoverageComplete: true, ceilingTimingComplete: false }), { complete: false, status: "inconclusive-ceiling-coverage" });
});

test("calibration/evaluation batching measures one fixed interval and divides it consistently", async () => {
  let calls = 0;
  const batch = await measureBatchInvocation(async () => {
    calls += 1;
    return { mse: calls, cost: calls };
  }, 3);
  assert.equal(calls, 3);
  assert.equal(batch.results.length, 3);
  assert.equal(batch.segments.length, 3);
  assert.equal(batch.cpuMs, batch.batchCpuMs / 3);
  assert.equal(batch.wallMs, batch.batchWallMs / 3);
});

test("coverage audit rejects missing and duplicate required rows", () => {
  const plans = {
    "linear-online": [{ binId: "bin-1", selections: {} }],
    "tiny-recurrent": [{ binId: "bin-1", selections: {} }]
  };
  const manifest = buildEvaluationManifest(plans, "strict-bin");
  const makeRow = (entry) => ({ evaluationMode: entry.mode, model: entry.model, methodId: entry.methodId, cellId: entry.cellId, seed: entry.seed, bin: { id: entry.binId }, suite: entry.suite, streamSpec: { variant: entry.suite === "heldout-recurring" ? "heldout-recurring" : "never-repeating" } });
  const audit = auditCoverage([makeRow(manifest[0]), makeRow(manifest[0])], manifest);
  assert.equal(audit.complete, false);
  assert.ok(audit.missing.length > 0);
  assert.deepEqual(audit.duplicates, [manifest[0].key]);
});

test("coverage fingerprints the complete held-out cell configuration", () => {
  const plans = { "linear-online": [{ binId: "bin-1", selections: {} }], "tiny-recurrent": [] };
  const manifest = buildEvaluationManifest(plans, "strict-bin");
  const entry = manifest[0];
  const row = { evaluationMode: entry.mode, model: entry.model, methodId: entry.methodId, cellId: entry.cellId, seed: entry.seed, bin: { id: entry.binId }, suite: entry.suite, configFingerprint: configFingerprint({ horizon: 240, recurrence: 0.99, noise: 0.01, streamVariant: "heldout-recurring" }), streamSpec: { variant: "heldout-recurring" } };
  const audit = auditCoverage([row], manifest);
  assert.deepEqual(audit.wrongStream, [entry.key]);
  assert.equal(audit.complete, false);
});

test("ceiling analysis marks a cell with twenty percent over-budget rows inconclusive", () => {
  const rows = [];
  for (const method of METHOD_DEFS) {
    for (let seed = 0; seed < 5; seed += 1) rows.push({ suite: "heldout-recurring", model: "linear-online", cellId: "cell", methodId: method.id, seed, mse: 1, bin: { id: "ceiling-1", cpuMs: 10, wallMs: 10 }, timing: { cpuMs: seed === 0 && method.id === "always" ? 20 : 5, wallMs: seed === 0 && method.id === "always" ? 20 : 5, atOrBelowCeiling: !(seed === 0 && method.id === "always") } });
  }
  const result = analyzeCostCeilings(rows);
  assert.equal(result[0].timingCoverageComplete, false);
  assert.equal(result[0].status, "inconclusive-ceiling-coverage");
});

test("the emitted replay audit covers predictions, labels and causal traces", async () => {
  const audit = await runReplayAudit();
  assert.equal(audit.complete, true);
  assert.equal(audit.rows.length, 14);
  assert.ok(audit.rows.every((row) => row.equal && row.fields.includes("predictions") && row.fields.includes("labels")));
});

test("locked replay preserves causal traces and never reads the current label", async () => {
  const config = { ...DEFAULT_CONFIG, horizon: 60, updateBudget: 12, seed: 77 };
  const first = generateStream(config);
  const second = first.map((sample, index) => index === 20 ? { ...sample, y: sample.y + 5 } : sample);
  for (const model of ["linear-online", "tiny-recurrent"]) {
    for (const method of METHOD_DEFS) {
      const a = await replayTrace(model, method.id, config, first);
      const b = await replayTrace(model, method.id, config, second);
      assert.equal(a.actionTrace[20], b.actionTrace[20], `${model}/${method.id} used current label`);
      const repeat = await replayTrace(model, method.id, config);
      assert.deepEqual(a.actionTrace, repeat.actionTrace);
      assert.deepEqual(a.updates, repeat.updates);
      assert.deepEqual(a.probeTrace, repeat.probeTrace);
    }
  }
});
