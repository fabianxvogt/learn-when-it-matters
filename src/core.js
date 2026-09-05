export const METHOD_DEFS = [
  { id: "causal-gate", label: "Causal gate", tone: "signal" },
  { id: "always", label: "Always-update", tone: "red" },
  { id: "periodic", label: "Periodic", tone: "blue" },
  { id: "random", label: "Random", tone: "violet" },
  { id: "surprise", label: "Pre-label surprise", tone: "orange" },
  { id: "change-point", label: "Change-point", tone: "green" },
  { id: "classical", label: "RLS tracker", tone: "slate" }
];

export const DEFAULT_CONFIG = {
  horizon: 480,
  recurrence: 0.82,
  noise: 0.08,
  updateBudget: 120,
  seed: 42,
  probeCost: 2,
  probeInterval: 4,
  gateMargin: 0.012,
  surpriseThreshold: 0.18,
  changeThreshold: 0.11,
  periodicInterval: 12,
  randomProbability: 0.25
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function mulberry32(seed) {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function normalizeConfig(input = {}) {
  const config = { ...DEFAULT_CONFIG, ...input };
  config.horizon = clamp(Math.round(Number(config.horizon) || DEFAULT_CONFIG.horizon), 60, 1200);
  config.recurrence = clamp(Number(config.recurrence) || 0, 0, 0.98);
  config.noise = clamp(Number(config.noise) || 0, 0, 0.45);
  config.updateBudget = clamp(Math.round(Number(config.updateBudget) || DEFAULT_CONFIG.updateBudget), 1, config.horizon);
  config.seed = Math.round(Number(config.seed) || DEFAULT_CONFIG.seed);
  config.probeCost = clamp(Number(config.probeCost) || DEFAULT_CONFIG.probeCost, 0, 10);
  config.probeInterval = clamp(Math.round(Number(config.probeInterval) || DEFAULT_CONFIG.probeInterval), 1, 24);
  config.gateMargin = clamp(Number(config.gateMargin) || DEFAULT_CONFIG.gateMargin, 0, 0.2);
  config.surpriseThreshold = clamp(Number(config.surpriseThreshold) || DEFAULT_CONFIG.surpriseThreshold, 0.01, 2);
  config.changeThreshold = clamp(Number(config.changeThreshold) || DEFAULT_CONFIG.changeThreshold, 0.01, 1);
  config.periodicInterval = clamp(Math.round(Number(config.periodicInterval) || DEFAULT_CONFIG.periodicInterval), 1, 48);
  config.randomProbability = clamp(Number(config.randomProbability) || DEFAULT_CONFIG.randomProbability, 0.01, 1);
  return config;
}

export function generateStream(inputConfig = {}) {
  const config = normalizeConfig(inputConfig);
  const rng = mulberry32(config.seed);
  const stream = [];
  let previousX = 0;
  let previousY = 0;

  for (let t = 0; t < config.horizon; t += 1) {
    // The generator has a recurring hidden forcing term. The evaluator never exposes
    // its phase or regime marker to an online method.
    const period = config.streamVariant === "heldout-recurring" ? 53 : 72;
    const recurring = config.streamVariant === "never-repeating" ? gaussian(rng) * 0.42 : Math.sin((2 * Math.PI * t) / period) * 0.62;
    const slowCycle = Math.sin((2 * Math.PI * t) / (config.streamVariant === "heldout-recurring" ? 137 : 181)) * 0.28;
    const pulse = config.streamVariant === "never-repeating" ? 0 : Math.sin((2 * Math.PI * t) / 31) > 0.86 ? 0.36 : -0.05;
    const latent = recurring + slowCycle + pulse;
    const noiseScale = config.streamVariant === "heldout-recurring" ? 1.7 : config.streamVariant === "never-repeating" ? 1.25 : 1;
    const x = config.recurrence * previousX + (1 - config.recurrence) * latent + gaussian(rng) * config.noise * noiseScale;
    const y = 0.58 * x + 0.28 * previousY + 0.12 * slowCycle + gaussian(rng) * config.noise * noiseScale;
    stream.push({ t, x, y });
    previousX = x;
    previousY = y;
  }
  return stream;
}

class LinearRegressor {
  constructor() {
    this.weights = [0, 0, 0];
  }

  clone() {
    const clone = new LinearRegressor();
    clone.weights = [...this.weights];
    return clone;
  }

  predict(features) {
    return this.weights[0] * features[0] + this.weights[1] * features[1] + this.weights[2] * features[2];
  }

  update(features, target) {
    const error = target - this.predict(features);
    const rate = 0.045;
    this.weights = this.weights.map((weight, index) => weight + rate * error * features[index]);
  }
}

class RlsTracker extends LinearRegressor {
  constructor() {
    super();
    this.covariance = [
      [8, 0, 0],
      [0, 8, 0],
      [0, 0, 8]
    ];
  }

  update(features, target) {
    const lambda = 0.985;
    const p = this.covariance;
    const pPhi = p.map((row) => row[0] * features[0] + row[1] * features[1] + row[2] * features[2]);
    const denominator = lambda + features[0] * pPhi[0] + features[1] * pPhi[1] + features[2] * pPhi[2];
    const gain = pPhi.map((value) => value / denominator);
    const error = target - this.predict(features);
    this.weights = this.weights.map((weight, index) => weight + gain[index] * error);
    const next = p.map((row, rowIndex) => row.map((value, colIndex) => (value - gain[rowIndex] * pPhi[colIndex]) / lambda));
    this.covariance = next.map((row) => row.map((value) => clamp(value, -100, 100)));
  }
}

function featuresFor(stream, index) {
  const current = stream[index];
  const previousY = index === 0 ? 0 : stream[index - 1].y;
  return [1, current.x, previousY];
}

function historicalLoss(model, history) {
  if (history.length === 0) return 0;
  let total = 0;
  for (const sample of history) total += (model.predict(sample.features) - sample.target) ** 2;
  return total / history.length;
}

function wantsUpdate(methodId, context) {
  const { step, inputSurprise, lastResidual, residualMean, config, random } = context;
  // This callback is intentionally pre-label: current y_t, current residual, and
  // current squared error are not part of its inputs.
  if (methodId === "always") return true;
  if (methodId === "periodic") return step % config.periodicInterval === 0;
  if (methodId === "random") return random() < config.randomProbability;
  if (methodId === "surprise") return inputSurprise > config.surpriseThreshold;
  if (methodId === "change-point") {
    return step > 18 && Math.abs(lastResidual - residualMean) > config.changeThreshold;
  }
  if (methodId === "classical") return true;
  return false;
}

export async function runMethod(methodId, stream, inputConfig = {}, progress = () => {}, cancel = () => false) {
  const config = normalizeConfig(inputConfig);
  const model = methodId === "classical" ? new RlsTracker() : new LinearRegressor();
  const random = mulberry32(config.seed + methodId.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0));
  const history = [];
  const predictions = [];
  const losses = [];
  const updates = [];
  const actionTrace = [];
  const probeTrace = [];
  let updateCount = 0;
  let probeCount = 0;
  let discardedUpdates = 0;
  let discardedCandidates = 0;
  let budgetSkipped = 0;
  let residualMean = 0;
  let lastResidual = 0;
  let lastProbeUseful = false;
  let pendingShadow = null;
  let probeForwards = 0;
  let probeGradients = 0;
  let stateCopies = 0;
  let totalLoss = 0;
  const startedAt = performance.now?.() ?? Date.now();

  for (let step = 0; step < stream.length; step += 1) {
    if (cancel()) throw new Error("Experiment cancelled");
    const features = featuresFor(stream, step);
    // Freeze the production prediction before reading the current label. Everything
    // below the decision line uses only x_t plus state/history through t-1.
    const prediction = model.predict(features);
    const inputSurprise = step === 0 ? 0 : Math.abs(stream[step].x - stream[step - 1].x);
    const shouldUpdate = methodId === "causal-gate"
      ? (step < 8 ? step % 2 === 0 : lastProbeUseful)
      : wantsUpdate(methodId, { step, inputSurprise, lastResidual, residualMean, config, random });
    actionTrace.push(shouldUpdate ? "update" : "skip");

    // A shadow candidate is built from an already revealed sample. Its transfer is
    // scored on the next input only after y_t arrives, so the evidence can affect
    // t+1 and later decisions, never the current prediction or action.
    if (methodId === "causal-gate" && step > 0 && step % config.probeInterval === 0) {
      const baseline = model.clone();
      const candidate = model.clone();
      const laggedSample = history.at(-1);
      candidate.update(laggedSample.features, laggedSample.target);
      pendingShadow = { baseline, candidate, createdAt: step };
      probeCount += 1;
      probeGradients += 1;
      stateCopies += 2;
    }

    const target = stream[step].y;
    const squaredError = (prediction - target) ** 2;
    predictions.push(prediction);
    losses.push(squaredError);
    totalLoss += squaredError;

    if (pendingShadow) {
      const shadowPrediction = pendingShadow.candidate.predict(features);
      const shadowLoss = (shadowPrediction - target) ** 2;
      const baselineLoss = (pendingShadow.baseline.predict(features) - target) ** 2;
      const improvement = baselineLoss - shadowLoss;
      lastProbeUseful = improvement > config.gateMargin * Math.max(baselineLoss, 0.01);
      probeForwards += 3;
      if (!lastProbeUseful) { discardedUpdates += 1; discardedCandidates += 1; }
      probeTrace.push({ createdAt: pendingShadow.createdAt, resolvedAt: step, improvement, useful: lastProbeUseful });
      pendingShadow = null;
    }
    if (shouldUpdate && updateCount < config.updateBudget) {
      model.update(features, target);
      updateCount += 1;
      updates.push(step);
    } else if (shouldUpdate) {
      discardedUpdates += 1;
      budgetSkipped += 1;
    }

    const residual = target - prediction;
    residualMean = step === 0 ? residual : 0.96 * residualMean + 0.04 * residual;
    lastResidual = residual;
    history.push({ features, target });
    if (history.length > 48) history.shift();
    if (step % 60 === 0) {
      progress(step / stream.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  progress(1);
  const mse = totalLoss / stream.length;
  const elapsedMs = (performance.now?.() ?? Date.now()) - startedAt;
  const forwardPasses = stream.length + updateCount + probeForwards;
  const gradientEvaluations = updateCount + probeGradients;
  const optimizerOperations = methodId === "classical" ? updateCount * 30 : updateCount * 3;
  const candidateGradientOperations = probeGradients * 3;
  const cost = forwardPasses + optimizerOperations + candidateGradientOperations + stateCopies * config.probeCost;
  return {
    methodId,
    predictions,
    losses,
    updates,
    actionTrace,
    labels: stream.map((sample) => sample.y),
    probeTrace,
    updateCount,
    probeCount,
    discardedUpdates,
    discardedCandidates,
    budgetSkipped,
    mse,
    cost,
    errorPerCost: mse / Math.max(cost, 1),
    finalPrediction: predictions.at(-1),
    budgetUsed: updateCount / config.updateBudget,
    costLedger: {
      forwardPasses,
      probeForwards,
      gradientEvaluations,
      candidateGradients: probeGradients,
      optimizerOperations,
      matrixOperations: methodId === "classical" ? updateCount * 30 : 0,
      candidateGradientOperations,
      stateCopies,
      discardedWork: discardedCandidates,
      budgetSkipped,
      elapsedWallMs: Math.max(0, elapsedMs),
      totalWork: cost
    }
  };
}

export async function runComparison(inputConfig = {}, progress = () => {}, cancel = () => false) {
  const config = normalizeConfig(inputConfig);
  const stream = generateStream(config);
  const results = [];
  for (let index = 0; index < METHOD_DEFS.length; index += 1) {
    const method = METHOD_DEFS[index];
    const result = await runMethod(
      method.id,
      stream,
      config,
      (fraction) => progress((index + fraction) / METHOD_DEFS.length),
      cancel
    );
    results.push(result);
  }
  const ranked = [...results].sort((a, b) => a.mse - b.mse);
  return {
    version: 1,
    config,
    stream,
    results,
    bestByMse: ranked[0].methodId,
    bestByEfficiency: [...results].sort((a, b) => a.errorPerCost - b.errorPerCost)[0].methodId,
    heldOutSplit: { training: "browser example only", heldOut: "local runner locks unseen recurrence/noise", neverRepeatingControl: true },
    completedAt: new Date().toISOString()
  };
}

export function formatNumber(value, digits = 3) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

export { normalizeConfig };
