import { DEFAULT_CONFIG, METHOD_DEFS, generateStream, getStreamSpec, mulberry32 } from "./core.js";

class TinyRecurrentLearner {
  constructor() {
    this.weights = [0, 0, 0];
    this.hidden = 0;
  }

  clone() {
    const clone = new TinyRecurrentLearner();
    clone.weights = [...this.weights];
    clone.hidden = this.hidden;
    return clone;
  }

  view(input) {
    const normalizedInput = Math.tanh(input);
    const proposedHidden = Math.tanh(0.82 * this.hidden + 0.22 * normalizedInput);
    const features = [1, normalizedInput, proposedHidden];
    const prediction = this.weights[0] * features[0] + this.weights[1] * features[1] + this.weights[2] * features[2];
    return { features, proposedHidden, prediction };
  }

  update(view, target) {
    const error = target - view.prediction;
    const rate = 0.035;
    this.weights = this.weights.map((weight, index) => weight + rate * error * view.features[index]);
    this.hidden = view.proposedHidden;
  }

  advance(view) {
    this.hidden = view.proposedHidden;
  }
}

class TinyRecurrentRlsLearner extends TinyRecurrentLearner {
  constructor() {
    super();
    this.covariance = [[8, 0, 0], [0, 8, 0], [0, 0, 8]];
  }

  clone() {
    const clone = new TinyRecurrentRlsLearner();
    clone.weights = [...this.weights];
    clone.hidden = this.hidden;
    clone.covariance = this.covariance.map((row) => [...row]);
    return clone;
  }

  update(view, target) {
    const lambda = 0.985;
    const phi = view.features;
    const pPhi = this.covariance.map((row) => row[0] * phi[0] + row[1] * phi[1] + row[2] * phi[2]);
    const denominator = lambda + phi[0] * pPhi[0] + phi[1] * pPhi[1] + phi[2] * pPhi[2];
    const gain = pPhi.map((value) => value / denominator);
    const error = target - view.prediction;
    this.weights = this.weights.map((weight, index) => weight + gain[index] * error);
    this.covariance = this.covariance.map((row, rowIndex) => row.map((value, columnIndex) => (value - gain[rowIndex] * pPhi[columnIndex]) / lambda));
    this.hidden = view.proposedHidden;
  }
}

function historicalLoss(model, history) {
  if (!history.length) return 0;
  return history.reduce((sum, sample) => sum + (model.view(sample.input).prediction - sample.target) ** 2, 0) / history.length;
}

function decision(methodId, state) {
  if (methodId === "always" || methodId === "classical") return true;
  if (methodId === "periodic") return state.step % state.config.periodicInterval === 0;
  if (methodId === "random") return state.random() < state.config.randomProbability;
  if (methodId === "surprise") return state.inputSurprise > state.config.surpriseThreshold;
  if (methodId === "change-point") return state.step > 18 && Math.abs(state.lastResidual - state.residualMean) > state.config.changeThreshold;
  return state.step < 8 ? state.step % 2 === 0 : state.lastProbeUseful;
}

export async function runRecurrentMethod(methodId, inputStream, inputConfig = {}, progress = () => {}, cancel = () => false) {
  const config = { ...DEFAULT_CONFIG, ...inputConfig };
  const stream = inputStream ?? generateStream(config);
  const model = methodId === "classical" ? new TinyRecurrentRlsLearner() : new TinyRecurrentLearner();
  const random = mulberry32(config.seed + methodId.length * 17);
  const history = [];
  const predictions = [];
  const losses = [];
  const actionTrace = [];
  const updates = [];
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
    const point = stream[step];
    const view = model.view(point.x);
    const preLabelDecision = decision(methodId, {
      step,
      config,
      random,
      inputSurprise: step === 0 ? 0 : Math.abs(point.x - stream[step - 1].x),
      lastResidual,
      residualMean,
      lastProbeUseful
    });
    actionTrace.push(preLabelDecision ? "update" : "skip");

    if (methodId === "causal-gate" && step > 0 && step % config.probeInterval === 0) {
      const baseline = model.clone();
      const candidate = model.clone();
      const lagged = history.at(-1);
      candidate.update(lagged.view, lagged.target);
      pendingShadow = { baseline, candidate, createdAt: step };
      probeCount += 1;
      probeGradients += 1;
      stateCopies += 2;
    }

    const loss = (view.prediction - point.y) ** 2;
    predictions.push(view.prediction);
    losses.push(loss);
    totalLoss += loss;
    if (pendingShadow) {
      const shadowLoss = (pendingShadow.candidate.view(point.x).prediction - point.y) ** 2;
      const baselineLoss = (pendingShadow.baseline.view(point.x).prediction - point.y) ** 2;
      const improvement = baselineLoss - shadowLoss;
      lastProbeUseful = improvement > config.gateMargin * Math.max(baselineLoss, 0.01);
      probeForwards += 2;
      if (!lastProbeUseful) { discardedUpdates += 1; discardedCandidates += 1; }
      probeTrace.push({ createdAt: pendingShadow.createdAt, resolvedAt: step, improvement, useful: lastProbeUseful });
      pendingShadow = null;
    }
    if (preLabelDecision && updateCount < config.updateBudget) {
      model.update(view, point.y);
      updateCount += 1;
      updates.push(step);
    } else if (preLabelDecision) { discardedUpdates += 1; budgetSkipped += 1; }
    model.advance(view);
    const residual = point.y - view.prediction;
    residualMean = step === 0 ? residual : 0.96 * residualMean + 0.04 * residual;
    lastResidual = residual;
    history.push({ input: point.x, view, target: point.y });
    if (history.length > 32) history.shift();
    if (step % 60 === 0) { progress(step / stream.length); await new Promise((resolve) => setTimeout(resolve, 0)); }
  }
  progress(1);
  const elapsedMs = (performance.now?.() ?? Date.now()) - startedAt;
  const forwardPasses = stream.length + probeForwards;
  const gradientEvaluations = updateCount + probeGradients;
  const optimizerOperations = methodId === "classical" ? updateCount * 30 : updateCount * 3;
  const candidateGradientOperations = probeGradients * 3;
  const cost = forwardPasses + optimizerOperations + candidateGradientOperations + stateCopies * config.probeCost;
  return {
    methodId,
    model: "tiny-recurrent",
    predictions,
    labels: stream.map((point) => point.y),
    losses,
    actionTrace,
    updates,
    probeTrace,
    mse: totalLoss / stream.length,
    cost,
    updateCount,
    probeCount,
    discardedUpdates,
    discardedCandidates,
    budgetSkipped,
    errorPerCost: (totalLoss / stream.length) / Math.max(cost, 1),
    costLedger: { forwardPasses, probeForwards, gradientEvaluations, candidateGradients: probeGradients, optimizerOperations, matrixOperations: methodId === "classical" ? updateCount * 30 : 0, candidateGradientOperations, stateCopies, discardedWork: discardedCandidates, budgetSkipped, elapsedWallMs: Math.max(0, elapsedMs), totalWork: cost }
  };
}

export async function runTinyRecurrentComparison(inputConfig = {}, progress = () => {}, cancel = () => false) {
  const config = { ...DEFAULT_CONFIG, ...inputConfig };
  const stream = generateStream(config);
  const results = [];
  for (let index = 0; index < METHOD_DEFS.length; index += 1) {
    const item = METHOD_DEFS[index];
    results.push(await runRecurrentMethod(item.id, stream, config, (fraction) => progress((index + fraction) / METHOD_DEFS.length), cancel));
  }
  return { model: "tiny-recurrent", version: 1, config, streamSpec: getStreamSpec(config), inputNormalization: "tanh", results };
}
