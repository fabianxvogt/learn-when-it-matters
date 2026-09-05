import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DEFAULT_CONFIG, METHOD_DEFS, generateStream, mulberry32, runMethod } from "../src/core.js";
import { runRecurrentMethod } from "../src/recurrent.js";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, "").split("=");
  return [key, value ?? true];
}));
const seeds = Math.max(1, Number(args.seeds || 5));
const budgets = String(args.budgets || "30,60,120").split(",").map(Number).filter((value) => Number.isFinite(value) && value > 0);
const baseConfig = { ...DEFAULT_CONFIG, horizon: Number(args.horizon || 240), seed: Number(args.seed || 42) };
if (args.recurrence !== undefined) baseConfig.recurrence = Number(args.recurrence);
if (args.noise !== undefined) baseConfig.noise = Number(args.noise);
const trainSeeds = Array.from({ length: Math.min(3, seeds) }, (_, index) => baseConfig.seed + index);
const streamFor = (config, seed, variant) => generateStream({ ...config, seed, streamVariant: variant });
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

function candidateGrid(methodId) {
  if (methodId === "periodic") return [{ periodicInterval: 6 }, { periodicInterval: 12 }, { periodicInterval: 24 }];
  if (methodId === "random") return [{ randomProbability: 0.15 }, { randomProbability: 0.25 }, { randomProbability: 0.35 }];
  if (methodId === "surprise") return [{ surpriseThreshold: 0.08 }, { surpriseThreshold: 0.18 }, { surpriseThreshold: 0.3 }];
  if (methodId === "change-point") return [{ changeThreshold: 0.06 }, { changeThreshold: 0.11 }, { changeThreshold: 0.2 }];
  if (methodId === "causal-gate") return [{ probeInterval: 2, gateMargin: 0.005 }, { probeInterval: 4, gateMargin: 0.012 }, { probeInterval: 8, gateMargin: 0.03 }];
  return [{}];
}

async function trainSelect(methodId, budget) {
  let best = null;
  for (const candidate of candidateGrid(methodId)) {
    const rows = [];
    for (const seed of trainSeeds) {
      const stream = streamFor({ ...baseConfig, horizon: Math.min(baseConfig.horizon, 160) }, seed, undefined);
      rows.push(await runMethod(methodId, stream, { ...baseConfig, ...candidate, updateBudget: budget, seed }));
    }
    const score = mean(rows.map((row) => row.mse)) + 0.00005 * mean(rows.map((row) => row.cost));
    if (!best || score < best.score) best = { params: candidate, score, trainMse: mean(rows.map((row) => row.mse)), trainCost: mean(rows.map((row) => row.cost)) };
  }
  return best;
}

async function tuneFrontier() {
  const frontier = {};
  for (const budget of budgets) {
    frontier[budget] = {};
    for (const method of METHOD_DEFS) frontier[budget][method.id] = await trainSelect(method.id, budget);
  }
  return frontier;
}

function compactResult(result) {
  return {
    methodId: result.methodId,
    model: result.model || "linear-online",
    mse: result.mse,
    areaUnderAdaptation: result.losses.reduce((sum, value) => sum + value, 0),
    cost: result.cost,
    updateCount: result.updateCount,
    probeCount: result.probeCount,
    discardedUpdates: result.discardedUpdates,
    discardedCandidates: result.discardedCandidates,
    budgetSkipped: result.budgetSkipped,
    firstLoss: result.losses[0],
    worstLoss: Math.max(...result.losses),
    costLedger: result.costLedger
  };
}

async function evaluateLocked(budget, frontier, variant, count = seeds) {
  const runs = [];
  for (let index = 0; index < count; index += 1) {
    const seed = baseConfig.seed + index;
    const stream = streamFor({ ...baseConfig, updateBudget: budget }, seed, variant);
    const results = [];
    for (const method of METHOD_DEFS) {
      const tuned = frontier[budget][method.id]?.params || {};
      results.push(compactResult(await runMethod(method.id, stream, { ...baseConfig, ...tuned, updateBudget: budget, seed })));
    }
    runs.push({ seed, streamVariant: variant || "training-recurring", results });
  }
  return runs;
}

function bootstrapInterval(values, seed) {
  if (values.length < 2) return [values[0] ?? 0, values[0] ?? 0];
  const rng = mulberry32(seed);
  const samples = [];
  for (let draw = 0; draw < 300; draw += 1) {
    const resample = Array.from({ length: values.length }, () => values[Math.floor(rng() * values.length)]);
    samples.push(mean(resample));
  }
  samples.sort((a, b) => a - b);
  return [samples[Math.floor(samples.length * 0.025)], samples[Math.floor(samples.length * 0.975)]];
}

function summarize(batch, label) {
  const methods = {};
  for (const definition of METHOD_DEFS) {
    const rows = batch.map((run) => run.results.find((result) => result.methodId === definition.id));
    const causalRows = batch.map((run) => run.results.find((result) => result.methodId === "causal-gate"));
    const pairedMse = rows.map((row, index) => causalRows[index].mse - row.mse);
    methods[definition.id] = {
      method: definition.label,
      meanMse: mean(rows.map((row) => row.mse)),
      mseInterval: bootstrapInterval(rows.map((row) => row.mse), 100 + definition.id.length),
      meanCost: mean(rows.map((row) => row.cost)),
      meanUpdates: mean(rows.map((row) => row.updateCount)),
      meanProbes: mean(rows.map((row) => row.probeCount)),
      meanDiscarded: mean(rows.map((row) => row.discardedUpdates)),
      meanDiscardedCandidates: mean(rows.map((row) => row.discardedCandidates ?? row.discardedUpdates)),
      meanWallMs: mean(rows.map((row) => row.costLedger.elapsedWallMs)),
      causalMinusMethodMse: mean(pairedMse),
      pairedMseInterval: bootstrapInterval(pairedMse, 500 + definition.id.length)
    };
  }
  return { label, seeds: batch.map((run) => run.seed), methods };
}

async function recurrentBatch(variant) {
  const runs = [];
  for (let index = 0; index < seeds; index += 1) {
    const seed = baseConfig.seed + index;
    const config = { ...baseConfig, seed, streamVariant: variant };
    const stream = streamFor(config, seed, variant);
    const results = [];
    for (const method of METHOD_DEFS) results.push(compactResult(await runRecurrentMethod(method.id, stream, config)));
    runs.push({ seed, streamVariant: variant || "training-recurring", results });
  }
  return runs;
}

const frontier = await tuneFrontier();
const budgetsReport = {};
for (const budget of budgets) {
  const training = await evaluateLocked(budget, frontier, undefined);
  const heldOutRecurring = await evaluateLocked(budget, frontier, "heldout-recurring");
  const neverRepeating = await evaluateLocked(budget, frontier, "never-repeating");
  budgetsReport[budget] = {
    lockedParameters: frontier[budget],
    training,
    heldOutRecurring,
    neverRepeating,
    summary: {
      training: summarize(training, "training recurring stream"),
      heldOutRecurring: summarize(heldOutRecurring, "held-out unseen recurrence/noise"),
      neverRepeating: summarize(neverRepeating, "never-repeating control")
    }
  };
}

const recurrentHeldOut = await recurrentBatch("heldout-recurring");
const recurrentNeverRepeating = await recurrentBatch("never-repeating");
const outputPath = resolve(args.out || "outputs/repeated-run.json");
mkdirSync(dirname(outputPath), { recursive: true });
const report = {
  version: 1,
  protocol: "pre-label action; train-only bounded tuning; frozen parameters on held-out streams; paired seeds; probe/discarded work and wall-clock time charged",
  config: baseConfig,
  seeds,
  budgets,
  frontier: budgetsReport,
  recurrentModel: {
    model: "tiny-recurrent",
    note: "Local-only recurrent extension; browser remains a linear online-regressor preview.",
    heldOutRecurring: recurrentHeldOut,
    neverRepeating: recurrentNeverRepeating
  }
};
writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(`Wrote train-tuned frozen frontiers for budgets ${budgets.join(", ")} and ${seeds} recurrent-model seeds to ${outputPath}`);
