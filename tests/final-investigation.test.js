import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, generateStream } from "../src/core.js";
import { METHOD_DEFS } from "../src/core.js";
import { FINAL_PROTOCOL, MEASUREMENT_PROTOCOL_VERSION, PROVENANCE_VERSION, analyzeCostCeilings, assessCompletion, auditCoverage, buildEvaluationManifest, configFingerprint, constructCommonBins, constructCostCeilings, executionFingerprint, finalizeReportState, measureBatchInvocation, measureCalibrationBatches, pairSeedDifferences, replayTrace, runReplayAudit, selectCeilingCandidates, selectLockedCandidates, signPermutation, summarizeMeasuredBatches, timingCoverageEligible, timingIsComparable } from "../scripts/run-final-investigation.mjs";

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

test("componentwise CPU/wall envelope covers crossed training costs", () => {
  const crossed = [
    syntheticCell("linear-online", "causal-gate", 0.1, 10, 12),
    syntheticCell("linear-online", "always", 0.1, 8, 15),
    ...METHOD_DEFS.slice(2).map((method) => syntheticCell("linear-online", method.id, 0.1, 5, 5))
  ];
  const ceilings = constructCostCeilings(crossed, "linear-online", { maxCeilings: 3 });
  assert.equal(ceilings.status, "ok");
  assert.ok(ceilings.ceilings.some((ceiling) => ceiling.cpuMs === 10 && ceiling.wallMs === 15));
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
  assert.equal(timingCoverageEligible(5, 6), true);
  assert.equal(timingCoverageEligible(4, 6), false);
});

test("strict no-bin status cannot become a completed conclusion", () => {
  assert.deepEqual(assessCompletion({ strictAvailabilityByModel: { "linear-online": false, "tiny-recurrent": true }, strictCoverageByModel: { "linear-online": false, "tiny-recurrent": true }, ceilingCoverageComplete: true, ceilingTimingComplete: true }), { complete: false, conclusionEligible: false, status: "inconclusive-no-strict-bin" });
  assert.deepEqual(assessCompletion({ strictAvailabilityByModel: { "linear-online": false, "tiny-recurrent": false }, strictCoverageByModel: { "linear-online": false, "tiny-recurrent": false }, ceilingCoverageComplete: true, ceilingTimingComplete: true }), { complete: false, conclusionEligible: false, status: "inconclusive-no-strict-bin" });
  assert.deepEqual(assessCompletion({ strictAvailabilityByModel: { "linear-online": true, "tiny-recurrent": true }, strictCoverageByModel: { "linear-online": true, "tiny-recurrent": true }, ceilingCoverageComplete: true, ceilingTimingComplete: false }), { complete: false, conclusionEligible: false, status: "inconclusive-ceiling-coverage" });
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
  assert.ok(Object.hasOwn(batch, "maxRSS"));
});

test("the amendment declares five raw-batch samples and a distinct provenance version", () => {
  assert.equal(FINAL_PROTOCOL.calibrationBatches, 5);
  assert.equal(FINAL_PROTOCOL.measurementProtocolVersion, MEASUREMENT_PROTOCOL_VERSION);
  assert.equal(PROVENANCE_VERSION, "final-investigation-raw-batch-cv-k5-v1");
});

test("stable batch totals stay eligible while an internal segment outlier is retained", () => {
  const batches = [0.744, 0.750, 0.746, 0.748, 0.745].map((batchCpuMs, batchIndex) => ({
    batchCpuMs,
    batchWallMs: 1.2 + batchIndex * 0.002,
    segments: [{ cpuMs: 0.04, wallMs: 0.4 }, { cpuMs: batchIndex === 1 ? 0.65 : 0.04, wallMs: 0.4 }, { cpuMs: 0.04, wallMs: 0.4 }]
  }));
  const summary = summarizeMeasuredBatches(batches, 3);
  assert.equal(summary.batchCount, 5);
  assert.equal(summary.comparable, true);
  assert.equal(summary.segments.length, 15);
  assert.ok(summary.segments.some((segment) => segment.cpuMs === 0.65 && segment.batchIndex === 1));
});

test("unstable raw batch totals remain ineligible", () => {
  const batches = [0.6, 0.6, 1.8, 0.6, 0.6].map((batchCpuMs) => ({ batchCpuMs, batchWallMs: 1, segments: [] }));
  const summary = summarizeMeasuredBatches(batches, 3);
  assert.ok(summary.cpu.cv > 0.2);
  assert.equal(summary.comparable, false);
});

test("CV does not change when raw batch totals are equally scaled", () => {
  const base = [1, 2, 3, 4, 5].map((batchCpuMs) => ({ batchCpuMs, batchWallMs: batchCpuMs, segments: [] }));
  const scaled = base.map((batch) => ({ ...batch, batchCpuMs: batch.batchCpuMs * 7, batchWallMs: batch.batchWallMs * 7 }));
  const baseSummary = summarizeMeasuredBatches(base, 3);
  const scaledSummary = summarizeMeasuredBatches(scaled, 3);
  assert.ok(Math.abs(scaledSummary.cpu.cv - baseSummary.cpu.cv) < 1e-12);
  assert.ok(Math.abs(scaledSummary.wall.cv - baseSummary.wall.cv) < 1e-12);
  assert.ok(Math.abs(scaledSummary.dividedCpuMs - baseSummary.dividedCpuMs * 7) < 1e-12);
});

test("five measured batches each contain the locked repeat count", async () => {
  let calls = 0;
  const measured = await measureCalibrationBatches(async () => {
    calls += 1;
    return { mse: calls, cost: calls };
  }, 3, 5);
  assert.equal(calls, 15);
  assert.equal(measured.batchCount, 5);
  assert.equal(measured.batches.length, 5);
  assert.ok(measured.batches.every((batch) => batch.results.length === 3 && batch.segments.length === 3));
  assert.equal(measured.rawBatchCpuMs.length, 5);
  assert.equal(measured.rawBatchWallMs.length, 5);
  assert.equal(measured.segments.length, 15);
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

test("coverage also fingerprints the locked execution configuration", () => {
  const plans = { "linear-online": [{ binId: "bin-1", selections: { "causal-gate": { params: { probeInterval: 2 }, budget: 30 } } }], "tiny-recurrent": [] };
  const manifest = buildEvaluationManifest(plans, "strict-bin");
  const entry = manifest.find((item) => item.methodId === "causal-gate");
  const row = { evaluationMode: entry.mode, model: entry.model, methodId: entry.methodId, cellId: entry.cellId, seed: entry.seed, bin: { id: entry.binId }, suite: entry.suite, configFingerprint: entry.configFingerprint, executionFingerprint: executionFingerprint({ model: entry.model, methodId: entry.methodId, config: { horizon: 240, recurrence: 0.6, noise: 0.04, streamVariant: "heldout-recurring", seed: entry.seed }, params: { probeInterval: 8 }, updateBudget: 30 }), streamSpec: { variant: "heldout-recurring" } };
  const audit = auditCoverage([row], [entry]);
  assert.deepEqual(audit.wrongStream, [entry.key]);
});

test("paired differences keep a missing seed as a missing pair", () => {
  const gateRows = [{ seed: 100, mse: 4 }, { seed: 101, mse: 5 }, { seed: 102, mse: 6 }];
  const controlRows = [{ seed: 100, mse: 3 }, { seed: 102, mse: 4 }];
  assert.deepEqual(pairSeedDifferences(gateRows, controlRows, [100, 101, 102]), [
    { seed: 100, difference: 1 },
    { seed: 101, difference: null },
    { seed: 102, difference: 2 }
  ]);
});

test("complete structure cannot become a conclusion with inconclusive analysis", () => {
  const state = finalizeReportState({ completion: { complete: true, status: "complete" }, analysisDecision: "inconclusive-non-comparable", runClassification: "registered-protocol" });
  assert.deepEqual(state, { complete: false, status: "inconclusive-non-comparable", structuralComplete: true, conclusionEligible: false });
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
