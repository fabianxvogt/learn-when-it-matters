import { METHOD_DEFS } from "./core.js";

const finite = (value) => Number.isFinite(value);
const nonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const ledgerKeys = ["forwardPasses", "probeForwards", "gradientEvaluations", "candidateGradients", "optimizerOperations", "matrixOperations", "candidateGradientOperations", "stateCopies", "discardedWork", "budgetSkipped", "elapsedWallMs", "totalWork"];

function validLedger(ledger) {
  return ledger && ledgerKeys.every((key) => finite(ledger[key]) && ledger[key] >= 0);
}

function validTrace(result, streamLength) {
  return Array.isArray(result.updates)
    && Array.isArray(result.probeTrace)
    && result.predictions.every(finite)
    && result.losses.every(finite)
    && result.actionTrace.every((action) => action === "update" || action === "skip")
    && result.updates.every((step) => Number.isInteger(step) && step >= 0 && step < streamLength)
    && result.probeTrace.every((probe) => Number.isInteger(probe.createdAt)
      && Number.isInteger(probe.resolvedAt)
      && probe.createdAt >= 0
      && probe.resolvedAt >= 0
      && probe.createdAt < streamLength
      && probe.resolvedAt < streamLength
      && finite(probe.improvement)
      && typeof probe.useful === "boolean");
}

export function isValidImportedRun(parsed) {
  const methodIds = new Set(METHOD_DEFS.map((item) => item.id));
  const config = parsed?.config;
  const configValid = config
    && Number.isInteger(config.horizon) && config.horizon >= 60 && config.horizon <= 1200
    && finite(config.recurrence) && config.recurrence >= 0 && config.recurrence <= 0.98
    && finite(config.noise) && config.noise >= 0 && config.noise <= 0.45
    && Number.isInteger(config.updateBudget) && config.updateBudget >= 1 && config.updateBudget <= config.horizon
    && Number.isInteger(config.seed) && config.seed >= 1 && config.seed <= 999999
    && finite(config.probeCost) && config.probeCost >= 0 && config.probeCost <= 10
    && Number.isInteger(config.probeInterval) && config.probeInterval >= 1 && config.probeInterval <= 24;
  return parsed?.version === 1
    && configValid
    && Array.isArray(parsed.stream)
    && parsed.stream.length === config.horizon
    && parsed.stream.every((sample, index) => sample && sample.t === index && finite(sample.x) && finite(sample.y))
    && Array.isArray(parsed.results)
    && parsed.results.length === METHOD_DEFS.length
    && parsed.results.every((result) => methodIds.has(result.methodId)
      && finite(result.mse)
      && finite(result.errorPerCost)
      && nonNegativeInteger(result.updateCount)
      && nonNegativeInteger(result.probeCount)
      && nonNegativeInteger(result.discardedUpdates)
      && nonNegativeInteger(result.discardedCandidates)
      && nonNegativeInteger(result.budgetSkipped)
      && Array.isArray(result.predictions)
      && Array.isArray(result.losses)
      && Array.isArray(result.actionTrace)
      && Array.isArray(result.labels)
      && result.predictions.length === result.losses.length
      && result.losses.length === result.actionTrace.length
      && result.labels.length === parsed.stream.length
      && parsed.stream.length === result.predictions.length
      && result.labels.every(finite)
      && result.updateCount <= config.updateBudget
      && result.probeCount <= config.horizon
      && validTrace(result, parsed.stream.length)
      && validLedger(result.costLedger)
      && finite(result.cost)
      && result.cost >= 0);
}
