import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { DEFAULT_CONFIG, METHOD_DEFS, generateStream, getStreamSpec, mulberry32, runMethod } from "../src/core.js";
import { runRecurrentMethod } from "../src/recurrent.js";

export const MEASUREMENT_PROTOCOL_VERSION = "raw-batch-cv-k5-v1";
export const PROVENANCE_VERSION = "final-investigation-raw-batch-cv-k5-v1";

export const FINAL_PROTOCOL = {
  measurementProtocolVersion: MEASUREMENT_PROTOCOL_VERSION,
  trainSeeds: [42, 43, 44],
  evaluationSeeds: [100, 101, 102, 103, 104, 105, 106, 107],
  horizon: 240,
  budgets: [30, 60, 120],
  calibrationWarmups: 1,
  calibrationRepeats: 5,
  calibrationBatches: 5,
  tolerance: 0.15,
  maxTimingCv: 0.2,
  minimumInToleranceRate: 0.8,
  bootstrapResamples: 2000,
  cpuCapSeconds: 600,
  wallWatchdogSeconds: 1800,
  transition: { status: "not estimable", reason: "No hidden-switch stream fixture is included in this bounded pilot." }
};

const MODEL_DEFS = [
  { id: "linear-online", label: "Tiny linear online regressor" },
  { id: "tiny-recurrent", label: "Tiny recurrent learner" }
];

const TRAINING = { recurrence: 0.82, noise: 0.08, streamVariant: undefined };
const EVALUATION_CELLS = [
  { id: "recurrence-0.60-noise-0.04", recurrence: 0.60, noise: 0.04, streamVariant: "heldout-recurring", suite: "heldout-recurring" },
  { id: "recurrence-0.92-noise-0.18", recurrence: 0.92, noise: 0.18, streamVariant: "heldout-recurring", suite: "heldout-recurring" },
  { id: "never-repeat-0.60-noise-0.04", recurrence: 0.60, noise: 0.04, streamVariant: "never-repeating", suite: "never-repeating" },
  { id: "never-repeat-0.92-noise-0.18", recurrence: 0.92, noise: 0.18, streamVariant: "never-repeating", suite: "never-repeating" }
];

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, "").split("=");
  return [key, value ?? true];
}));

const numberArg = (key, fallback) => Number.isFinite(Number(args[key])) ? Number(args[key]) : fallback;
const outputPath = resolve(args.out || "work/final-investigation.json");
const customProtocolOverride = ["timing-repeats", "evaluation-seeds", "max-bins", "cpu-cap-seconds", "wall-watchdog-seconds"].some((key) => args[key] !== undefined);
const unsafeCpuCapOverride = args["cpu-cap-seconds"] !== undefined && numberArg("cpu-cap-seconds", FINAL_PROTOCOL.cpuCapSeconds) > FINAL_PROTOCOL.cpuCapSeconds;
const unsafeWallWatchdogOverride = args["wall-watchdog-seconds"] !== undefined && numberArg("wall-watchdog-seconds", FINAL_PROTOCOL.wallWatchdogSeconds) > FINAL_PROTOCOL.wallWatchdogSeconds;
const protocol = {
  ...FINAL_PROTOCOL,
  calibrationRepeats: Math.max(1, Math.floor(numberArg("timing-repeats", FINAL_PROTOCOL.calibrationRepeats))),
  evaluationSeeds: FINAL_PROTOCOL.evaluationSeeds.slice(0, Math.max(1, Math.floor(numberArg("evaluation-seeds", FINAL_PROTOCOL.evaluationSeeds.length)))),
  maxBins: Math.min(3, Math.max(1, Math.floor(numberArg("max-bins", 3)))),
  cpuCapSeconds: Math.min(FINAL_PROTOCOL.cpuCapSeconds, Math.max(1, numberArg("cpu-cap-seconds", FINAL_PROTOCOL.cpuCapSeconds))),
  wallWatchdogSeconds: Math.min(FINAL_PROTOCOL.wallWatchdogSeconds, Math.max(1, numberArg("wall-watchdog-seconds", FINAL_PROTOCOL.wallWatchdogSeconds)))
};

let activeCalibrationRepeats = protocol.calibrationRepeats;
let calibrationSizing = null;
let resourceGuard = () => false;

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const median = (values) => {
  const ordered = [...values].sort((a, b) => a - b);
  if (!ordered.length) return 0;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};
const coefficientOfVariation = (values) => {
  const average = mean(values);
  if (values.length < 2 || Math.abs(average) < 1e-9) return 0;
  const variance = mean(values.map((value) => (value - average) ** 2));
  return Math.sqrt(variance) / Math.abs(average);
};
const timingSummary = (samples) => ({
  samples,
  median: median(samples),
  mean: mean(samples),
  cv: coefficientOfVariation(samples)
});

function cpuMilliseconds(usage) {
  return (usage.userCPUTime + usage.systemCPUTime) / 1000;
}

export async function measureInvocation(invoke) {
  const beforeCpu = process.resourceUsage();
  const started = process.hrtime.bigint();
  const result = await invoke();
  const elapsedWallMs = Number(process.hrtime.bigint() - started) / 1e6;
  const afterCpu = process.resourceUsage();
  return {
    result,
    cpuMs: cpuMilliseconds(afterCpu) - cpuMilliseconds(beforeCpu),
    wallMs: elapsedWallMs
  };
}

export async function measureBatchInvocation(invoke, count) {
  const beforeCpu = process.resourceUsage();
  const started = process.hrtime.bigint();
  const results = [];
  const segments = [];
  for (let index = 0; index < count; index += 1) {
    const segmentCpu = process.resourceUsage();
    const segmentStarted = process.hrtime.bigint();
    results.push(await invoke());
    segments.push({
      cpuMs: cpuMilliseconds(process.resourceUsage()) - cpuMilliseconds(segmentCpu),
      wallMs: Number(process.hrtime.bigint() - segmentStarted) / 1e6
    });
  }
  const batchCpuMs = cpuMilliseconds(process.resourceUsage()) - cpuMilliseconds(beforeCpu);
  const batchWallMs = Number(process.hrtime.bigint() - started) / 1e6;
  const endUsage = process.resourceUsage();
  return {
    results,
    segments,
    batchCpuMs,
    batchWallMs,
    cpuMs: batchCpuMs / count,
    wallMs: batchWallMs / count,
    maxRSS: Number.isFinite(endUsage.maxRSS) ? endUsage.maxRSS : null
  };
}

export function summarizeMeasuredBatches(batches, repeatCount) {
  const rawBatchCpuMs = batches.map((batch) => batch.batchCpuMs);
  const rawBatchWallMs = batches.map((batch) => batch.batchWallMs);
  const cpu = timingSummary(rawBatchCpuMs);
  const wall = timingSummary(rawBatchWallMs);
  const segments = batches.flatMap((batch, batchIndex) => batch.segments.map((segment, repeatIndex) => ({ ...segment, batchIndex, repeatIndex })));
  const meanBatchCpuMs = mean(rawBatchCpuMs);
  const meanBatchWallMs = mean(rawBatchWallMs);
  return {
    batchCount: batches.length,
    repeatCount,
    rawBatchCpuMs,
    rawBatchWallMs,
    meanBatchCpuMs,
    meanBatchWallMs,
    dividedCpuMs: meanBatchCpuMs / repeatCount,
    dividedWallMs: meanBatchWallMs / repeatCount,
    cpu: { ...cpu, batchDivided: meanBatchCpuMs / repeatCount },
    wall: { ...wall, batchDivided: meanBatchWallMs / repeatCount },
    segments,
    comparable: timingIsComparable({ cpu, wall })
  };
}

export async function measureCalibrationBatches(invoke, repeatCount, batchCount = FINAL_PROTOCOL.calibrationBatches) {
  const batches = [];
  for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
    if (resourceGuard()) throw new Error("PILOT_RESOURCE_CAP_EXCEEDED_DURING_CALIBRATION_BATCHES");
    batches.push(await measureBatchInvocation(invoke, repeatCount));
  }
  return { ...summarizeMeasuredBatches(batches, repeatCount), batches };
}

export function timingIsComparable(timing, maxCv = FINAL_PROTOCOL.maxTimingCv) {
  return timing.cpu.cv <= maxCv && timing.wall.cv <= maxCv;
}

export function timingCoverageEligible(inBudgetCount, totalCount) {
  const outOfBudgetCount = totalCount - inBudgetCount;
  return totalCount > 0 && outOfBudgetCount * 5 < totalCount;
}

export function withinTolerance(value, center, tolerance = FINAL_PROTOCOL.tolerance) {
  return Math.abs(value - center) <= Math.max(Math.abs(center), 0.001) * tolerance;
}

export function candidateGrid(methodId) {
  if (methodId === "periodic") return [{ periodicInterval: 6 }, { periodicInterval: 12 }, { periodicInterval: 24 }];
  if (methodId === "random") return [{ randomProbability: 0.15 }, { randomProbability: 0.25 }, { randomProbability: 0.35 }];
  if (methodId === "surprise") return [{ surpriseThreshold: 0.08 }, { surpriseThreshold: 0.18 }, { surpriseThreshold: 0.3 }];
  if (methodId === "change-point") return [{ changeThreshold: 0.06 }, { changeThreshold: 0.11 }, { changeThreshold: 0.2 }];
  if (methodId === "causal-gate") return [{ probeInterval: 2, gateMargin: 0.005 }, { probeInterval: 4, gateMargin: 0.012 }, { probeInterval: 8, gateMargin: 0.03 }];
  return [{}];
}

function streamFor(config, seed, variant) {
  return generateStream({ ...config, seed, streamVariant: variant });
}

export function configFingerprint(config) {
  return JSON.stringify({ horizon: config.horizon, recurrence: config.recurrence, noise: config.noise, streamVariant: config.streamVariant ?? "training-recurring" });
}

export function executionFingerprint({ model, methodId, config, params, updateBudget }) {
  return JSON.stringify({ model, methodId, cell: JSON.parse(configFingerprint(config)), params: params ?? {}, updateBudget: updateBudget ?? config.updateBudget, seed: config.seed });
}

async function runModel(modelId, methodId, stream, config) {
  if (modelId === "tiny-recurrent") return runRecurrentMethod(methodId, stream, config);
  return runMethod(methodId, stream, config);
}

function trainingConfig(candidate, budget, seed) {
  return { ...DEFAULT_CONFIG, ...TRAINING, horizon: protocol.horizon, updateBudget: budget, seed, ...candidate };
}

function compactTrainingRow(measured, seed) {
  return { seed, mse: measured.result.mse, syntheticCost: measured.result.cost, updateCount: measured.result.updateCount };
}

async function calibrateCandidate(modelId, methodId, candidate, budget) {
  const config = trainingConfig(candidate, budget, protocol.trainSeeds[0]);
  const stream = streamFor(config, config.seed, undefined);
  for (let index = 0; index < protocol.calibrationWarmups; index += 1) await runModel(modelId, methodId, stream, config);
  const measured = await measureCalibrationBatches(() => runModel(modelId, methodId, stream, config), activeCalibrationRepeats, protocol.calibrationBatches);
  return {
    seed: config.seed,
    warmupCount: protocol.calibrationWarmups,
    repeatCount: activeCalibrationRepeats,
    batchCount: measured.batchCount,
    rawBatchCpuMs: measured.rawBatchCpuMs,
    rawBatchWallMs: measured.rawBatchWallMs,
    batchCpuMs: measured.meanBatchCpuMs,
    batchWallMs: measured.meanBatchWallMs,
    dividedCpuMs: measured.dividedCpuMs,
    dividedWallMs: measured.dividedWallMs,
    perBatch: measured.batches.map((batch, batchIndex) => ({ batchIndex, batchCpuMs: batch.batchCpuMs, batchWallMs: batch.batchWallMs, maxRSS: batch.maxRSS, perRepeat: batch.results.map((result, repeatIndex) => ({ repeatIndex, cpuMs: batch.segments[repeatIndex].cpuMs, wallMs: batch.segments[repeatIndex].wallMs, mse: result.mse, syntheticCost: result.cost })) })),
    perRepeat: measured.batches.flatMap((batch, batchIndex) => batch.results.map((result, repeatIndex) => ({ batchIndex, repeatIndex, cpuMs: batch.segments[repeatIndex].cpuMs, wallMs: batch.segments[repeatIndex].wallMs, mse: result.mse, syntheticCost: result.cost }))),
    segments: measured.segments,
    cpu: measured.cpu,
    wall: measured.wall,
    comparable: measured.comparable
  };
}

async function determineCalibrationRepeats() {
  const config = trainingConfig({}, 30, protocol.trainSeeds[0]);
  const stream = streamFor(config, config.seed, undefined);
  const boundarySamples = [];
  for (let index = 0; index < 5; index += 1) boundarySamples.push((await measureInvocation(async () => {})).cpuMs);
  const boundaryCpuMs = median(boundarySamples);
  const candidates = [];
  for (let count = 3; count <= 8; count += 1) {
    if (resourceGuard()) throw new Error("PILOT_RESOURCE_CAP_EXCEEDED_DURING_BATCH_SIZING");
    const batch = await measureInvocation(async () => {
      for (let repeat = 0; repeat < count; repeat += 1) await runModel("linear-online", "always", stream, config);
    });
    const boundaryFraction = boundaryCpuMs / Math.max(batch.cpuMs, 0.001);
    candidates.push({ count, boundaryCpuMs, batchCpuMs: batch.cpuMs, batchWallMs: batch.wallMs, boundaryFraction });
    if (boundaryFraction < 0.05) return { chosenCount: count, candidates, reason: "smallest-training-batch-under-five-percent-boundary-overhead" };
  }
  return { chosenCount: 8, candidates, reason: "capped-at-eight-training-batch" };
}

async function trainCandidate(modelId, methodId, candidate, budget) {
  const rows = [];
  for (const seed of protocol.trainSeeds) {
    const config = trainingConfig(candidate, budget, seed);
    const stream = streamFor(config, seed, undefined);
    rows.push(compactTrainingRow(await measureInvocation(() => runModel(modelId, methodId, stream, config)), seed));
  }
  const calibration = await calibrateCandidate(modelId, methodId, candidate, budget);
  return {
    model: modelId,
    methodId,
    budget,
    params: candidate,
    trainingRows: rows,
    trainMse: mean(rows.map((row) => row.mse)),
    trainSyntheticCost: mean(rows.map((row) => row.syntheticCost)),
    calibration,
    timingCpuMs: calibration.cpu.batchDivided,
    timingWallMs: calibration.wall.batchDivided,
    timingCv: Math.max(calibration.cpu.cv, calibration.wall.cv)
  };
}

export async function buildCalibrationTable(onCell = () => {}) {
  const table = [];
  for (const model of MODEL_DEFS) {
    for (const method of METHOD_DEFS) {
      for (const budget of protocol.budgets) {
        for (const params of candidateGrid(method.id)) {
          if (resourceGuard()) throw new Error("PILOT_RESOURCE_CAP_EXCEEDED_DURING_CALIBRATION");
          const cell = await trainCandidate(model.id, method.id, params, budget);
          table.push(cell);
          await onCell(cell, table.length);
        }
      }
    }
  }
  return table;
}

function logSpaced(start, end, count) {
  if (count <= 1 || Math.abs(end - start) < 1e-9) return [start];
  const safeStart = Math.max(start, 0.001);
  const safeEnd = Math.max(end, safeStart);
  return Array.from({ length: count }, (_, index) => Math.exp(Math.log(safeStart) + (Math.log(safeEnd) - Math.log(safeStart)) * (index / (count - 1))));
}

export function constructCommonBins(table, modelId, options = {}) {
  const tolerance = options.tolerance ?? FINAL_PROTOCOL.tolerance;
  const maxCv = options.maxTimingCv ?? FINAL_PROTOCOL.maxTimingCv;
  const maxBins = options.maxBins ?? 3;
  const methods = METHOD_DEFS.map((method) => method.id);
  const byMethod = Object.fromEntries(methods.map((methodId) => [methodId, table.filter((cell) => cell.model === modelId && cell.methodId === methodId && cell.calibration.comparable && cell.timingCv <= maxCv)]));
  const missingMethods = methods.filter((methodId) => byMethod[methodId].length === 0);
  const frontier = table.filter((cell) => cell.model === modelId && cell.calibration.comparable).map((cell) => ({ methodId: cell.methodId, budget: cell.budget, params: cell.params, trainMse: cell.trainMse, timingCpuMs: cell.timingCpuMs, timingWallMs: cell.timingWallMs, timingCv: cell.timingCv }));
  if (missingMethods.length) return { status: "no-common-bin", reason: "missing-comparable-method", missingMethods, measuredFrontier: frontier, bins: [] };
  const cpuLow = Math.max(...methods.map((methodId) => Math.min(...byMethod[methodId].map((cell) => cell.timingCpuMs))));
  const cpuHigh = Math.min(...methods.map((methodId) => Math.max(...byMethod[methodId].map((cell) => cell.timingCpuMs))));
  const wallLow = Math.max(...methods.map((methodId) => Math.min(...byMethod[methodId].map((cell) => cell.timingWallMs))));
  const wallHigh = Math.min(...methods.map((methodId) => Math.max(...byMethod[methodId].map((cell) => cell.timingWallMs))));
  if (cpuLow > cpuHigh || wallLow > wallHigh) return { status: "no-common-bin", reason: "empty-measured-range-intersection", ranges: { cpuLow, cpuHigh, wallLow, wallHigh }, measuredFrontier: frontier, bins: [] };
  const cpuCenters = logSpaced(cpuLow, cpuHigh, maxBins);
  const wallCenters = logSpaced(wallLow, wallHigh, maxBins);
  const bins = [];
  for (let index = 0; index < Math.min(cpuCenters.length, wallCenters.length); index += 1) {
    const center = { id: `bin-${index + 1}`, cpuMs: cpuCenters[index], wallMs: wallCenters[index] };
    const candidateCounts = Object.fromEntries(methods.map((methodId) => [methodId, byMethod[methodId].filter((cell) => withinTolerance(cell.timingCpuMs, center.cpuMs, tolerance) && withinTolerance(cell.timingWallMs, center.wallMs, tolerance)).length]));
    if (methods.every((methodId) => candidateCounts[methodId] > 0)) bins.push({ ...center, candidateCounts });
  }
  return { status: bins.length ? "ok" : "no-common-bin", reason: bins.length ? "common-measured-bins" : "no-candidate-within-tolerance", ranges: { cpuLow, cpuHigh, wallLow, wallHigh }, measuredFrontier: frontier, bins };
}

export function selectLockedCandidates(table, modelId, bins, options = {}) {
  const tolerance = options.tolerance ?? FINAL_PROTOCOL.tolerance;
  return bins.map((bin) => ({
    binId: bin.id,
    selections: Object.fromEntries(METHOD_DEFS.map((method) => {
      const candidates = table.filter((cell) => cell.model === modelId && cell.methodId === method.id && cell.calibration.comparable && withinTolerance(cell.timingCpuMs, bin.cpuMs, tolerance) && withinTolerance(cell.timingWallMs, bin.wallMs, tolerance));
      candidates.sort((left, right) => left.trainMse - right.trainMse || left.timingCpuMs - right.timingCpuMs || left.timingWallMs - right.timingWallMs);
      return [method.id, candidates[0] ?? null];
    }))
  }));
}

export function constructCostCeilings(table, modelId, options = {}) {
  const maxCv = options.maxTimingCv ?? FINAL_PROTOCOL.maxTimingCv;
  const maxCeilings = options.maxCeilings ?? options.maxBins ?? 3;
  const methods = METHOD_DEFS.map((method) => method.id);
  const eligible = table.filter((cell) => cell.model === modelId && cell.calibration.comparable && cell.timingCv <= maxCv);
  const frontier = eligible.map((cell) => ({ methodId: cell.methodId, budget: cell.budget, params: cell.params, trainMse: cell.trainMse, timingCpuMs: cell.timingCpuMs, timingWallMs: cell.timingWallMs, timingCv: cell.timingCv }));
  const envelopePoints = [];
  for (const left of eligible) {
    for (const right of eligible) envelopePoints.push({ cpuMs: Math.max(left.timingCpuMs, right.timingCpuMs), wallMs: Math.max(left.timingWallMs, right.timingWallMs) });
  }
  const candidates = [...new Map(envelopePoints.map((point) => [`${point.cpuMs.toFixed(6)}|${point.wallMs.toFixed(6)}`, point])).values()]
    .sort((left, right) => left.cpuMs - right.cpuMs || left.wallMs - right.wallMs);
  const feasible = candidates.filter((ceiling) => methods.every((methodId) => eligible.some((cell) => cell.methodId === methodId && cell.timingCpuMs <= ceiling.cpuMs && cell.timingWallMs <= ceiling.wallMs)));
  if (!feasible.length) return { status: "no-common-ceiling", reason: "no-train-feasible-upper-cost-ceiling", measuredFrontier: frontier, ceilings: [] };
  const indexes = feasible.length <= maxCeilings ? feasible.map((_, index) => index) : [0, Math.floor((feasible.length - 1) / 2), feasible.length - 1].slice(0, maxCeilings);
  return { status: "ok", reason: "train-feasible-upper-cost-ceilings", measuredFrontier: frontier, ceilings: indexes.map((index, ordinal) => ({ id: `ceiling-${ordinal + 1}`, ...feasible[index] })) };
}

export function selectCeilingCandidates(table, modelId, ceilings, options = {}) {
  const maxCv = options.maxTimingCv ?? FINAL_PROTOCOL.maxTimingCv;
  return ceilings.map((ceiling) => ({
    ceilingId: ceiling.id,
    cpuMs: ceiling.cpuMs,
    wallMs: ceiling.wallMs,
    selections: Object.fromEntries(METHOD_DEFS.map((method) => {
      const candidates = table.filter((cell) => cell.model === modelId && cell.methodId === method.id && cell.calibration.comparable && cell.timingCv <= maxCv && cell.timingCpuMs <= ceiling.cpuMs && cell.timingWallMs <= ceiling.wallMs);
      candidates.sort((left, right) => left.trainMse - right.trainMse || left.timingCpuMs - right.timingCpuMs || left.timingWallMs - right.timingWallMs);
      return [method.id, candidates[0] ?? null];
    }))
  }));
}

function fullEvaluationRow(measured, modelId, methodId, candidate, config, stream, timing, bin, evaluationMode = "strict-bin") {
  const result = measured.result;
  const inDeclaredRange = evaluationMode === "cost-ceiling"
    ? timing.cpuMs <= bin.cpuMs && timing.wallMs <= bin.wallMs
    : withinTolerance(timing.cpuMs, bin.cpuMs) && withinTolerance(timing.wallMs, bin.wallMs);
  return {
    model: modelId,
    methodId,
    params: candidate.params,
    evaluationMode,
    budget: candidate.budget,
    seed: config.seed,
    config,
    streamSpec: getStreamSpec(config),
    bin: { id: bin.id, cpuMs: bin.cpuMs, wallMs: bin.wallMs },
    timing: evaluationMode === "cost-ceiling"
      ? { cpuMs: timing.cpuMs, wallMs: timing.wallMs, batchCpuMs: timing.batchCpuMs, batchWallMs: timing.batchWallMs, repeatCount: timing.repeatCount, cpuInTolerance: null, wallInTolerance: null, atOrBelowCeiling: inDeclaredRange }
      : { cpuMs: timing.cpuMs, wallMs: timing.wallMs, batchCpuMs: timing.batchCpuMs, batchWallMs: timing.batchWallMs, repeatCount: timing.repeatCount, cpuInTolerance: withinTolerance(timing.cpuMs, bin.cpuMs), wallInTolerance: withinTolerance(timing.wallMs, bin.wallMs), atOrBelowCeiling: null },
    configFingerprint: configFingerprint(config),
    executionFingerprint: executionFingerprint({ model: modelId, methodId, config, params: candidate.params, updateBudget: candidate.budget }),
    binValidityReason: evaluationMode === "cost-ceiling" ? (inDeclaredRange ? "at-or-below-train-locked-ceiling" : "over-train-locked-ceiling") : (inDeclaredRange ? "in-tolerance" : "outside-declared-cpu-or-wall-tolerance"),
    mse: result.mse,
    areaUnderAdaptation: result.losses.reduce((sum, value) => sum + value, 0),
    predictions: result.predictions,
    labels: result.labels,
    losses: result.losses,
    actionTrace: result.actionTrace,
    updates: result.updates,
    probeTrace: result.probeTrace,
    updateCount: result.updateCount,
    probeCount: result.probeCount,
    discardedUpdates: result.discardedUpdates,
    discardedCandidates: result.discardedCandidates,
    budgetSkipped: result.budgetSkipped,
    cost: result.cost,
    costLedger: result.costLedger
  };
}

function cpuUsedSince(startUsage) {
  const current = process.resourceUsage();
  return cpuMilliseconds(current) - cpuMilliseconds(startUsage);
}

function parseJsonHash(path) {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function hostMetadata() {
  const cpu = os.cpus();
  const usage = process.resourceUsage();
  const lockfile = ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"].find((name) => existsSync(name));
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpu[0]?.model ?? "unknown",
    cpuCount: cpu.length,
    args: process.argv.slice(2),
    lockfile: lockfile ? { name: lockfile, sha256: parseJsonHash(lockfile) } : null,
    timestamp: new Date().toISOString(),
    warmupCount: protocol.calibrationWarmups,
    calibrationRepeats: protocol.calibrationRepeats,
    calibrationBatches: protocol.calibrationBatches,
    measurementProtocolVersion: protocol.measurementProtocolVersion,
    rss: { value: Number.isFinite(usage.maxRSS) ? usage.maxRSS : null, unit: "platform-native process.resourceUsage.maxRSS", source: "process.resourceUsage" },
    explicitGc: typeof global.gc === "function"
  };
}

export function bootstrapInterval(values, seed, draws = FINAL_PROTOCOL.bootstrapResamples) {
  if (!values.length) return [null, null];
  const rng = mulberry32(seed);
  const samples = [];
  for (let draw = 0; draw < draws; draw += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) total += values[Math.floor(rng() * values.length)];
    samples.push(total / values.length);
  }
  samples.sort((left, right) => left - right);
  return [samples[Math.floor(samples.length * 0.025)], samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.975))]];
}

export function signPermutation(values) {
  if (!values.length) return { observedMean: null, pValue: null, permutations: 0 };
  const observed = Math.abs(mean(values));
  const permutations = values.length <= 12 ? 2 ** values.length : 4096;
  const rng = mulberry32(values.length * 4099 + Math.round(observed * 1e6));
  let atLeast = 0;
  for (let draw = 0; draw < permutations; draw += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) total += (values.length <= 12 ? ((draw >> index) & 1 ? 1 : -1) : (rng() < 0.5 ? -1 : 1)) * values[index];
    if (Math.abs(total / values.length) >= observed - 1e-12) atLeast += 1;
  }
  return { observedMean: mean(values), pValue: atLeast / permutations, permutations };
}

export async function replayTrace(modelId, methodId, config, providedStream = null) {
  const stream = providedStream ?? streamFor(config, config.seed, config.streamVariant);
  const result = await runModel(modelId, methodId, stream, config);
  return { labels: result.labels, predictions: result.predictions, actionTrace: result.actionTrace, updates: result.updates, probeTrace: result.probeTrace };
}

export async function runReplayAudit() {
  const config = { ...DEFAULT_CONFIG, horizon: 60, updateBudget: 12, seed: 707 };
  const rows = [];
  for (const model of MODEL_DEFS) {
    for (const method of METHOD_DEFS) {
      const first = await replayTrace(model.id, method.id, config);
      const second = await replayTrace(model.id, method.id, config);
      const equal = JSON.stringify(first) === JSON.stringify(second);
      rows.push({ model: model.id, methodId: method.id, equal, fields: ["labels", "predictions", "actionTrace", "updates", "probeTrace"] });
    }
  }
  return { complete: rows.every((row) => row.equal), rows, timingExcluded: true, config };
}

function comparableRow(row) {
  return row.timing.cpuInTolerance && row.timing.wallInTolerance;
}

export function buildEvaluationManifestForModels(plansByModel, mode, selectedModels = MODEL_DEFS) {
  const manifest = [];
  for (const model of selectedModels) {
    for (const plan of plansByModel[model.id] ?? []) {
      const binId = mode === "cost-ceiling" ? plan.ceilingId : plan.binId;
      for (const cell of EVALUATION_CELLS) {
        for (const seed of protocol.evaluationSeeds) {
          const expectedConfig = { horizon: protocol.horizon, recurrence: cell.recurrence, noise: cell.noise, streamVariant: cell.streamVariant, seed };
          for (const method of METHOD_DEFS) {
            const selection = plan.selections[method.id];
            manifest.push({ mode, model: model.id, methodId: method.id, cellId: cell.id, suite: cell.suite, seed, binId, configFingerprint: configFingerprint(expectedConfig), executionFingerprint: executionFingerprint({ model: model.id, methodId: method.id, config: expectedConfig, params: selection?.params, updateBudget: selection?.budget }), key: `${mode}|${model.id}|${method.id}|${cell.id}|${seed}|${binId}` });
          }
        }
      }
    }
  }
  return manifest;
}

export function buildEvaluationManifest(plansByModel, mode) {
  return buildEvaluationManifestForModels(plansByModel, mode, MODEL_DEFS);
}

export function auditCoverage(rows, manifest) {
  const expected = new Map(manifest.map((entry) => [entry.key, entry]));
  const seen = new Map();
  const unexpected = [];
  const wrongStream = [];
  for (const row of rows) {
    const mode = row.evaluationMode;
    const key = `${mode}|${row.model}|${row.methodId}|${row.cellId}|${row.seed}|${row.bin.id}`;
    if (!expected.has(key)) unexpected.push(key);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    const expectedEntry = expected.get(key);
    if (expectedEntry && (row.suite !== expectedEntry.suite || row.streamSpec.variant !== (expectedEntry.suite === "heldout-recurring" ? "heldout-recurring" : "never-repeating") || row.configFingerprint !== expectedEntry.configFingerprint || row.executionFingerprint !== expectedEntry.executionFingerprint)) wrongStream.push(key);
  }
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
  const missing = manifest.filter((entry) => !seen.has(entry.key)).map((entry) => entry.key);
  return {
    requiredRows: manifest.length,
    receivedRows: rows.length,
    missing,
    duplicates,
    unexpected,
    wrongStream,
    complete: manifest.length > 0 && missing.length === 0 && duplicates.length === 0 && unexpected.length === 0 && wrongStream.length === 0
  };
}

export function pairSeedDifferences(gateRows, controlRows, seeds = protocol.evaluationSeeds) {
  const gateBySeed = new Map(gateRows.map((row) => [row.seed, row]));
  const controlBySeed = new Map(controlRows.map((row) => [row.seed, row]));
  return seeds.map((seed) => {
    const gateRow = gateBySeed.get(seed);
    const controlRow = controlBySeed.get(seed);
    return { seed, difference: gateRow && controlRow ? gateRow.mse - controlRow.mse : null };
  });
}

function analyzeHeldOut(rows, coverage = { complete: false }) {
  const groups = new Map();
  for (const row of rows.filter((item) => item.suite === "heldout-recurring")) {
    const key = `${row.model}|${row.cellId}|${row.bin.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const comparisons = [];
  for (const [key, group] of groups) {
    const [model, cellId, binId] = key.split("|");
    const byMethod = Object.fromEntries(METHOD_DEFS.map((method) => [method.id, group.filter((row) => row.methodId === method.id)]));
    const inToleranceCounts = Object.fromEntries(METHOD_DEFS.map((method) => [method.id, byMethod[method.id].filter(comparableRow).length]));
    const rates = Object.fromEntries(METHOD_DEFS.map((method) => [method.id, mean(byMethod[method.id].map((row) => comparableRow(row) ? 1 : 0))]));
    const valid = METHOD_DEFS.every((method) => byMethod[method.id].length === protocol.evaluationSeeds.length && timingCoverageEligible(inToleranceCounts[method.id], byMethod[method.id].length));
    const gateRows = byMethod["causal-gate"];
    const controls = Object.fromEntries(METHOD_DEFS.filter((method) => method.id !== "causal-gate").map((method) => {
      const paired = pairSeedDifferences(gateRows, byMethod[method.id]);
      const observed = paired.filter((pair) => pair.difference !== null).map((pair) => pair.difference);
      const pairingComplete = paired.every((pair) => pair.difference !== null);
      return [method.id, { pairedDifferences: paired, pairingComplete, meanDifference: pairingComplete ? mean(observed) : null, bootstrapInterval: pairingComplete ? bootstrapInterval(observed, model.length + cellId.length + binId.length) : null, signPermutation: pairingComplete ? signPermutation(observed) : null, valid: valid && pairingComplete }];
    }));
    comparisons.push({ model, cellId, binId, valid, inToleranceRates: rates, controls });
  }
  const descriptiveSuites = {};
  for (const row of rows) {
    const key = `${row.suite}|${row.model}|${row.cellId}|${row.bin.id}|${row.methodId}`;
    if (!descriptiveSuites[key]) descriptiveSuites[key] = { suite: row.suite, model: row.model, cellId: row.cellId, binId: row.bin.id, methodId: row.methodId, seeds: [], mse: [], cpuMs: [], wallMs: [] };
    descriptiveSuites[key].seeds.push(row.seed);
    descriptiveSuites[key].mse.push(row.mse);
    descriptiveSuites[key].cpuMs.push(row.timing.cpuMs);
    descriptiveSuites[key].wallMs.push(row.timing.wallMs);
  }
  const descriptive = Object.values(descriptiveSuites).map((item) => ({ ...item, meanMse: mean(item.mse), meanCpuMs: mean(item.cpuMs), meanWallMs: mean(item.wallMs) }));
  const positiveByModel = Object.fromEntries(MODEL_DEFS.map((model) => [model.id, comparisons.some((comparison) => comparison.model === model.id && comparison.valid && Object.values(comparison.controls).every((control) => control.bootstrapInterval[1] < 0))]));
  const modelsHaveCommonBin = Object.fromEntries(MODEL_DEFS.map((model) => [model.id, comparisons.some((comparison) => comparison.model === model.id && comparison.valid)]));
  const positive = coverage.complete && MODEL_DEFS.every((model) => positiveByModel[model.id]);
  const negative = coverage.complete && !positive && MODEL_DEFS.every((model) => modelsHaveCommonBin[model.id]);
  return { coverage, comparisons, descriptiveSuites: descriptive, positiveByModel, modelsHaveCommonBin, decision: !coverage.complete ? "inconclusive-incomplete-matrix" : positive ? "positive-evidence-exploratory" : negative ? "no-demonstrated-advantage" : "inconclusive-non-comparable" };
}

export function analyzeCostCeilings(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.suite}|${row.model}|${row.cellId}|${row.bin.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, group]) => {
    const [suite, model, cellId, ceilingId] = key.split("|");
    const byMethod = Object.fromEntries(METHOD_DEFS.map((method) => [method.id, group.filter((row) => row.methodId === method.id)]));
    const methods = Object.fromEntries(METHOD_DEFS.map((method) => [method.id, {
      seeds: byMethod[method.id].map((row) => row.seed),
      meanMse: mean(byMethod[method.id].map((row) => row.mse)),
      meanCpuMs: mean(byMethod[method.id].map((row) => row.timing.cpuMs)),
      meanWallMs: mean(byMethod[method.id].map((row) => row.timing.wallMs)),
      inCeilingCount: byMethod[method.id].filter((row) => row.timing.atOrBelowCeiling).length,
      inCeilingRate: mean(byMethod[method.id].map((row) => row.timing.atOrBelowCeiling ? 1 : 0))
    }]));
    const gateMse = methods["causal-gate"]?.meanMse;
    const completePairedSeeds = METHOD_DEFS.every((method) => byMethod[method.id].length === protocol.evaluationSeeds.length);
    const timingCoverageComplete = completePairedSeeds && METHOD_DEFS.every((method) => timingCoverageEligible(methods[method.id].inCeilingCount, byMethod[method.id].length));
    return {
      suite,
      model,
      cellId,
      ceilingId,
      completePairedSeeds,
      timingCoverageComplete,
      status: timingCoverageComplete ? "descriptive-ceiling-eligible" : "inconclusive-ceiling-coverage",
      descriptiveOnly: true,
      methods,
      gateMinusControlMeanMse: Object.fromEntries(METHOD_DEFS.filter((method) => method.id !== "causal-gate").map((method) => [method.id, gateMse - methods[method.id].meanMse]))
    };
  });
}

export function assessCompletion({ strictAvailable, strictAvailabilityByModel, strictCoverageComplete, strictCoverageByModel, ceilingCoverageComplete, ceilingTimingComplete, runClassification = "registered-protocol" }) {
  const modelsHaveStrict = strictAvailabilityByModel ? MODEL_DEFS.every((model) => strictAvailabilityByModel[model.id] === true) : strictAvailable === true;
  const modelsHaveStrictCoverage = strictCoverageByModel ? MODEL_DEFS.every((model) => strictCoverageByModel[model.id] === true) : strictCoverageComplete === true;
  if (runClassification !== "registered-protocol") return { complete: false, conclusionEligible: false, status: "inconclusive-custom-nonregistered-run" };
  if (!modelsHaveStrict) return { complete: false, conclusionEligible: false, status: "inconclusive-no-strict-bin" };
  if (!modelsHaveStrictCoverage || !ceilingCoverageComplete) return { complete: false, conclusionEligible: false, status: "inconclusive-incomplete-matrix" };
  if (!ceilingTimingComplete) return { complete: false, conclusionEligible: false, status: "inconclusive-ceiling-coverage" };
  return { complete: true, conclusionEligible: true, status: "complete" };
}

export function finalizeReportState({ completion, analysisDecision, runClassification }) {
  const conclusionEligible = completion.complete && !analysisDecision.startsWith("inconclusive") && runClassification === "registered-protocol";
  return {
    complete: conclusionEligible,
    status: conclusionEligible ? "complete" : (completion.status === "complete" ? "inconclusive-non-comparable" : completion.status),
    structuralComplete: completion.complete,
    conclusionEligible
  };
}

function makeReport(partial) {
  return {
    version: 3,
    status: partial.status ?? "running",
    complete: partial.complete ?? false,
    protocol: { ...protocol, calibrationRepeats: activeCalibrationRepeats },
    provenanceVersion: PROVENANCE_VERSION,
    host: partial.host,
    fallbackLadder: [
      { timingRepeats: 3, evaluationSeeds: 8, maxBins: 3 },
      { timingRepeats: 3, evaluationSeeds: 5, maxBins: 3 },
      { timingRepeats: 3, evaluationSeeds: 5, maxBins: 1 }
    ],
    calibration: partial.calibration ?? [],
    commonBins: partial.commonBins ?? {},
    lockedSelections: partial.lockedSelections ?? {},
    costCeilings: partial.costCeilings ?? {},
    ceilingSelections: partial.ceilingSelections ?? {},
    heldOutRows: partial.heldOutRows ?? [],
    ceilingRows: partial.ceilingRows ?? [],
    expectedManifests: partial.expectedManifests ?? {},
    coverageAudits: partial.coverageAudits ?? {},
    transitionDiagnostics: FINAL_PROTOCOL.transition,
    measurementCalibration: partial.measurementCalibration ?? null,
    checkpoints: partial.checkpoints ?? [],
    analysis: partial.analysis ?? null,
    ceilingAnalysis: partial.ceilingAnalysis ?? null,
    replayAudit: partial.replayAudit ?? null,
    source: { sha: partial.sourceSha ?? null },
    runClassification: partial.runClassification ?? "registered-protocol",
    completion: partial.completion ?? null,
    trainingFreeze: partial.trainingFreeze ?? null,
    progress: partial.progress ?? { stage: "not-started" }
  };
}

async function main() {
  mkdirSync(dirname(outputPath), { recursive: true });
  const startCpu = process.resourceUsage();
  const startWall = process.hrtime.bigint();
  const capExceeded = () => cpuUsedSince(startCpu) >= protocol.cpuCapSeconds * 1000 || Number(process.hrtime.bigint() - startWall) / 1e9 >= protocol.wallWatchdogSeconds;
  resourceGuard = capExceeded;
  const snapshot = (note) => ({ note, timestamp: new Date().toISOString(), loadAverage: os.loadavg(), cpuModel: os.cpus()[0]?.model ?? "unknown", cpuCount: os.cpus().length, platform: process.platform, node: process.version, activeJobNote: args.activeJobNote || "single serialized process; no worker parallelism" });
  const sourceSha = args.sourceSha || (() => {
    try { return execFileSync("git", ["rev-parse", "--verify", "HEAD"], { encoding: "utf8" }).trim(); } catch { return null; }
  })();
  let phase = "initializing";
  let terminationReason = "not-finished";
  let report = makeReport({ host: { ...hostMetadata(), startSnapshot: snapshot("start") }, sourceSha, measurementCalibration: null, checkpoints: [], runClassification: customProtocolOverride ? "custom-nonregistered-inconclusive" : "registered-protocol" });
  const persist = () => writeFileSync(outputPath, JSON.stringify(report, null, 2));
  report.progress = { stage: "manifest-initialized", phase };
  persist();
  try {
    if (unsafeCpuCapOverride || unsafeWallWatchdogOverride) throw new Error("UNSAFE_RESOURCE_CAP_OVERRIDE_REJECTED");
    phase = "replay-audit";
    report.progress = { stage: "replay-audit", phase };
    report.replayAudit = await runReplayAudit();
    persist();
    if (!report.replayAudit.complete) throw new Error("REPLAY_AUDIT_FAILED");
    phase = "batch-sizing";
    report.progress = { stage: "batch-sizing", phase, startedAt: new Date().toISOString() };
    persist();
    calibrationSizing = await determineCalibrationRepeats();
    activeCalibrationRepeats = calibrationSizing.chosenCount;
    report.measurementCalibration = calibrationSizing;
    report.protocol.calibrationRepeats = activeCalibrationRepeats;
    persist();
    phase = "calibration";
    report.progress = { stage: "calibration", phase, startedAt: new Date().toISOString(), completedCells: 0 };
    report.calibration = [];
    await buildCalibrationTable(async (cell, count) => {
      report.calibration.push(cell);
      report.progress.completedCells = count;
      report.checkpoints.push(snapshot(`completed calibration cell ${cell.model}/${cell.methodId}/${cell.budget}/${cell.params && JSON.stringify(cell.params)}`));
      persist();
    });
    report.progress = { stage: "common-bin-construction", calibrationCells: report.calibration.length };
    for (const model of MODEL_DEFS) {
      report.commonBins[model.id] = constructCommonBins(report.calibration, model.id, protocol);
      report.lockedSelections[model.id] = selectLockedCandidates(report.calibration, model.id, report.commonBins[model.id].bins, protocol);
      report.costCeilings[model.id] = constructCostCeilings(report.calibration, model.id, protocol);
      report.ceilingSelections[model.id] = selectCeilingCandidates(report.calibration, model.id, report.costCeilings[model.id].ceilings, protocol);
    }
    report.trainingFreeze = {
      status: "frozen-before-heldout",
      provenanceVersion: PROVENANCE_VERSION,
      calibrationRows: report.calibration.length,
      models: Object.fromEntries(MODEL_DEFS.map((model) => [model.id, { commonBinStatus: report.commonBins[model.id].status, ceilingStatus: report.costCeilings[model.id].status }]))
    };
    report.expectedManifests.strict = buildEvaluationManifest(report.lockedSelections, "strict-bin");
    report.expectedManifests.ceiling = buildEvaluationManifest(report.ceilingSelections, "cost-ceiling");
    report.expectedManifests.strictByModel = Object.fromEntries(MODEL_DEFS.map((model) => [model.id, buildEvaluationManifestForModels(report.lockedSelections, "strict-bin", [model])]));
    report.expectedManifests.ceilingByModel = Object.fromEntries(MODEL_DEFS.map((model) => [model.id, buildEvaluationManifestForModels(report.ceilingSelections, "cost-ceiling", [model])]));
    report.fallbackRung = { name: "full-fixed-repetition-batch", timingRepeats: activeCalibrationRepeats, evaluationSeeds: protocol.evaluationSeeds.length, maxBins: protocol.maxBins, chosenFrom: "training-only calibration and declared resource cap" };
    persist();
    phase = "heldout-evaluation";
    report.progress = { stage: "heldout-evaluation", phase, rows: 0 };
    const runPlans = async (model, plans, targetRows, evaluationMode) => {
      for (const plan of plans) {
        const bin = evaluationMode === "cost-ceiling"
          ? { id: plan.ceilingId, cpuMs: plan.cpuMs, wallMs: plan.wallMs }
          : report.commonBins[model.id].bins.find((item) => item.id === plan.binId);
        for (const cell of EVALUATION_CELLS) {
          for (const seed of protocol.evaluationSeeds) {
            const configBase = { ...DEFAULT_CONFIG, horizon: protocol.horizon, recurrence: cell.recurrence, noise: cell.noise, seed, streamVariant: cell.streamVariant };
            const stream = streamFor(configBase, seed, cell.streamVariant);
            for (const method of METHOD_DEFS) {
              if (capExceeded()) throw new Error("PILOT_RESOURCE_CAP_EXCEEDED");
              const candidate = plan.selections[method.id];
              if (!candidate) throw new Error(`MISSING_LOCKED_CANDIDATE:${model.id}:${bin.id}:${method.id}`);
              const config = { ...configBase, ...candidate.params, updateBudget: candidate.budget };
              const measuredBatch = await measureBatchInvocation(() => runModel(model.id, method.id, stream, config), activeCalibrationRepeats);
              const measured = { result: measuredBatch.results[0], cpuMs: measuredBatch.cpuMs, wallMs: measuredBatch.wallMs };
              const row = fullEvaluationRow(measured, model.id, method.id, candidate, config, stream, { cpuMs: measuredBatch.cpuMs, wallMs: measuredBatch.wallMs, batchCpuMs: measuredBatch.batchCpuMs, batchWallMs: measuredBatch.batchWallMs, repeatCount: activeCalibrationRepeats }, bin, evaluationMode);
              row.repeatOutputs = measuredBatch.results.map((result) => ({ mse: result.mse, predictions: result.predictions, labels: result.labels, actionTrace: result.actionTrace, updates: result.updates, probeTrace: result.probeTrace }));
              row.cellId = cell.id;
              row.suite = cell.suite;
              targetRows.push(row);
              report.progress.rows = report.heldOutRows.length + report.ceilingRows.length;
              if (report.progress.rows % 8 === 0) persist();
            }
          }
          report.checkpoints.push(snapshot(`completed ${evaluationMode}/${model.id}/${bin.id}/${cell.id}`));
          persist();
        }
      }
    };
    for (const model of MODEL_DEFS) {
      await runPlans(model, report.lockedSelections[model.id] ?? [], report.heldOutRows, "strict-bin");
      await runPlans(model, report.ceilingSelections[model.id] ?? [], report.ceilingRows, "cost-ceiling");
    }
    report.coverageAudits.strict = auditCoverage(report.heldOutRows, report.expectedManifests.strict);
    report.coverageAudits.ceiling = auditCoverage(report.ceilingRows, report.expectedManifests.ceiling);
    report.coverageAudits.strictByModel = Object.fromEntries(MODEL_DEFS.map((model) => [model.id, auditCoverage(report.heldOutRows.filter((row) => row.model === model.id), report.expectedManifests.strictByModel[model.id])]));
    report.coverageAudits.ceilingByModel = Object.fromEntries(MODEL_DEFS.map((model) => [model.id, auditCoverage(report.ceilingRows.filter((row) => row.model === model.id), report.expectedManifests.ceilingByModel[model.id])]));
    report.analysis = analyzeHeldOut(report.heldOutRows, report.coverageAudits.strict);
    report.ceilingAnalysis = analyzeCostCeilings(report.ceilingRows);
    if (report.runClassification !== "registered-protocol") report.analysis.decision = "inconclusive-custom-nonregistered-run";
    const completion = assessCompletion({
      strictAvailabilityByModel: Object.fromEntries(MODEL_DEFS.map((model) => [model.id, report.commonBins[model.id]?.status === "ok" && report.lockedSelections[model.id]?.length > 0])),
      strictCoverageByModel: Object.fromEntries(MODEL_DEFS.map((model) => [model.id, report.coverageAudits.strictByModel[model.id].complete])),
      ceilingCoverageComplete: report.coverageAudits.ceiling.complete,
      ceilingTimingComplete: report.ceilingAnalysis.length > 0 && report.ceilingAnalysis.every((group) => group.timingCoverageComplete),
      runClassification: report.runClassification
    });
    const reportState = finalizeReportState({ completion, analysisDecision: report.analysis.decision, runClassification: report.runClassification });
    report.completion = { ...completion, ...reportState, strictCoverage: report.coverageAudits.strict, ceilingCoverage: report.coverageAudits.ceiling, ceilingTimingEligible: report.ceilingAnalysis.length > 0 && report.ceilingAnalysis.every((group) => group.timingCoverageComplete) };
    report.complete = reportState.complete;
    report.status = reportState.status;
    report.progress = { stage: "complete", rows: report.heldOutRows.length + report.ceilingRows.length };
    terminationReason = report.complete ? "completed" : "incomplete-required-matrix";
    phase = "complete";
  } catch (error) {
    report.status = "inconclusive";
    report.complete = false;
    terminationReason = error.message;
    report.progress = { stage: "interrupted", phase, rows: report.heldOutRows.length + report.ceilingRows.length, reason: error.message, lastCheckpoint: report.checkpoints.at(-1) ?? null };
    report.analysis = null;
    report.ceilingAnalysis = null;
  } finally {
    const totalCpuMs = cpuUsedSince(startCpu);
    const totalWallMs = Number(process.hrtime.bigint() - startWall) / 1e6;
    const endUsage = process.resourceUsage();
    report.host.cpuUsedMs = totalCpuMs;
    report.host.wallUsedMs = totalWallMs;
    report.host.rss.end = { value: Number.isFinite(endUsage.maxRSS) ? endUsage.maxRSS : null, unit: "platform-native process.resourceUsage.maxRSS", source: "process.resourceUsage" };
    report.host.endSnapshot = snapshot("end");
    report.termination = { reason: terminationReason, phase, totalCpuMs, totalWallMs, cpuCapSeconds: protocol.cpuCapSeconds, wallWatchdogSeconds: protocol.wallWatchdogSeconds, watchdogExceeded: totalCpuMs >= protocol.cpuCapSeconds * 1000 || totalWallMs >= protocol.wallWatchdogSeconds * 1000, lastCompletedCheckpoint: report.checkpoints.at(-1) ?? null };
    persist();
  }
  console.log(`Wrote ${report.status} final investigation report to ${outputPath}`);
  if (!report.complete) process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
