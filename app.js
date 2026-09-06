import { DEFAULT_CONFIG, METHOD_DEFS, formatNumber, runComparison } from "./src/core.js";
import { createRunController } from "./src/run-controller.js";
import { isValidImportedRun } from "./src/run-validation.js";

const STORAGE_KEY = "learn-when-it-matters:v1:last-run";
const colors = { signal: "#c9ff4f", red: "#ff7c8c", blue: "#77b8ff", violet: "#c0a3ff", orange: "#ffae72", green: "#6ee0b5", slate: "#a6b2bc" };
const $ = (id) => document.getElementById(id);
let lastRun = null;
const runController = createRunController();

function readConfig() {
  return {
    horizon: Number($("horizon").value),
    recurrence: Number($("recurrence").value),
    noise: Number($("noise").value),
    updateBudget: Number($("updateBudget").value),
    seed: Number($("seed").value),
    probeCost: Number($("probeCost").value),
    probeInterval: Number($("probeInterval").value)
  };
}

function setConfig(config) {
  const merged = { ...DEFAULT_CONFIG, ...config };
  $("horizon").value = merged.horizon;
  $("recurrence").value = merged.recurrence;
  $("noise").value = merged.noise;
  $("updateBudget").value = merged.updateBudget;
  $("seed").value = merged.seed;
  $("probeCost").value = merged.probeCost;
  $("probeInterval").value = merged.probeInterval;
  updateValueLabels();
}

function updateValueLabels() {
  $("horizonValue").textContent = $("horizon").value;
  $("recurrenceValue").textContent = Number($("recurrence").value).toFixed(2);
  $("noiseValue").textContent = Number($("noise").value).toFixed(2);
}

function method(id) { return METHOD_DEFS.find((item) => item.id === id); }

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("show"), 2600);
}

function setProgress(fraction, label = "Running comparison") {
  const value = Math.round(fraction * 100);
  $("progressBar").style.width = `${value}%`;
  $("progressValue").textContent = `${value}%`;
  $("progressLabel").textContent = label;
}

function renderLegend() {
  $("legend").innerHTML = METHOD_DEFS.map((item) => `<span class="legend-item"><i class="legend-swatch" style="background:${colors[item.tone]}"></i>${item.label}</span>`).join("");
}

function currentJob() { return runController.current(); }

function setProgressFor(job, fraction, label) {
  if (!runController.isCurrent(job)) return false;
  setProgress(fraction, label);
  return true;
}

function renderAccessibleChartTable(run) {
  $("chartDataBody").innerHTML = run.results.map((result) => {
    const points = rolling(result.losses);
    const item = method(result.methodId);
    return `<tr><td>${item.label}</td><td>${formatNumber(result.mse, 4)}</td><td>${formatNumber(points[0], 4)}</td><td>${formatNumber(points.at(-1), 4)}</td></tr>`;
  }).join("");
}

function renderTrace(run) {
  const select = $("traceMethod");
  if (!select.options.length) {
    select.innerHTML = METHOD_DEFS.map((item) => `<option value="${item.id}">${item.label}</option>`).join("");
  }
  const selected = run.results.find((result) => result.methodId === select.value) ?? run.results[0];
  select.value = selected.methodId;
  const probeByStep = new Map();
  for (const probe of selected.probeTrace ?? []) {
    probeByStep.set(probe.createdAt, `probe → t${probe.resolvedAt}`);
    probeByStep.set(probe.resolvedAt, `${probe.useful ? "useful" : "discarded"} probe`);
  }
  $("traceBody").innerHTML = run.stream.map((sample, index) => `<tr><td>${index}</td><td>${formatNumber(sample.x, 4)}</td><td>${formatNumber(selected.predictions[index], 4)}</td><td>${formatNumber(sample.y, 4)}</td><td>${selected.actionTrace[index] ?? "—"}</td><td>${formatNumber(selected.losses[index], 4)}</td><td>${probeByStep.get(index) ?? "—"}</td></tr>`).join("");
  const ledger = selected.costLedger;
  $("traceSummary").textContent = `${method(selected.methodId).label}: total cost ${formatNumber(selected.cost, 0)}; ${ledger.forwardPasses} forward passes, ${ledger.probeForwards} charged probe forwards, ${ledger.candidateGradientOperations} candidate-gradient operations, ${ledger.stateCopies} state copies, ${ledger.discardedWork} discarded candidates, ${formatNumber(ledger.elapsedWallMs, 1)} ms wall time.`;
}

function rolling(values, radius = 12) {
  return values.map((_, index) => {
    const start = Math.max(0, index - radius + 1);
    const section = values.slice(start, index + 1);
    return section.reduce((sum, value) => sum + value, 0) / section.length;
  });
}

function drawChart(run) {
  const canvas = $("errorChart");
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * scale));
  canvas.height = Math.max(1, Math.floor(rect.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);
  if (!run?.results?.length) return;
  const all = run.results.flatMap((result) => rolling(result.losses));
  const max = Math.max(...all, 0.01);
  const pad = { left: 35, right: 12, top: 15, bottom: 23 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--border");
  ctx.lineWidth = 1;
  for (let row = 0; row < 4; row += 1) {
    const y = pad.top + (chartH * row) / 3;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--dim");
    ctx.font = "10px system-ui";
    ctx.fillText(formatNumber(max * (1 - row / 3), 2), 5, y + 3);
  }
  for (const result of run.results) {
    const points = rolling(result.losses);
    const item = method(result.methodId);
    ctx.strokeStyle = colors[item.tone];
    ctx.globalAlpha = result.methodId === "causal-gate" ? 1 : 0.66;
    ctx.lineWidth = result.methodId === "causal-gate" ? 2 : 1.2;
    ctx.beginPath();
    points.forEach((value, index) => {
      const x = pad.left + (index / Math.max(1, points.length - 1)) * chartW;
      const y = pad.top + (1 - value / max) * chartH;
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--dim");
  ctx.font = "10px system-ui";
  ctx.fillText("t", width - 12, height - 7);
}

function renderResults(run, context = null) {
  if (context !== null && !runController.commit(context, () => {})) return false;
  lastRun = run;
  const bestMse = run.results.find((result) => result.methodId === run.bestByMse) ?? [...run.results].sort((a, b) => a.mse - b.mse)[0];
  const bestEfficiency = run.results.find((result) => result.methodId === run.bestByEfficiency) ?? [...run.results].sort((a, b) => a.errorPerCost - b.errorPerCost)[0];
  $("bestMse").textContent = formatNumber(bestMse.mse, 4);
  $("bestMseMethod").textContent = `${method(bestMse.methodId).label} · descriptive only`;
  $("bestEfficiency").textContent = formatNumber(bestEfficiency.errorPerCost, 5);
  $("bestEfficiencyMethod").textContent = `${method(bestEfficiency.methodId).label} · descriptive only`;
  $("decisionCount").textContent = formatNumber(run.results.reduce((sum, result) => sum + result.updateCount + result.probeCount, 0), 0);
  $("resultsBody").innerHTML = run.results.map((result) => {
    const item = method(result.methodId);
    return `<tr><td><span class="method-dot" style="background:${colors[item.tone]}"></span>${item.label}</td><td>${formatNumber(result.mse, 4)}</td><td>${result.updateCount}</td><td>${result.probeCount}</td><td>${result.discardedCandidates ?? result.discardedUpdates}</td><td>${formatNumber(result.cost, 0)}</td></tr>`;
  }).join("");
  $("chartEmpty").hidden = false;
  $("chartEmpty").style.display = "none";
  drawChart(run);
  renderAccessibleChartTable(run);
  renderTrace(run);
  const causal = run.results.find((result) => result.methodId === "causal-gate");
  const classical = run.results.find((result) => result.methodId === "classical");
  $("readoutText").textContent = `One seeded browser stream only: the readouts are descriptive, not a scientific winner, equivalence, or negative result. The causal gate charged ${causal.probeCount} probes, ${causal.discardedCandidates ?? causal.discardedUpdates} discarded candidates, and ${formatNumber(causal.costLedger.elapsedWallMs, 1)} ms wall time; RLS is included as a classical tracking control (${formatNumber(classical.mse, 4)} MSE).`;
  return true;
}

async function run() {
  const config = readConfig();
  const job = runController.begin(config);
  if (!runController.isCurrent(job)) return;
  $("runButton").disabled = true;
  $("pauseButton").disabled = false;
  $("pauseButton").textContent = "Pause run";
  $("cancelButton").disabled = false;
  $("progressWrap").hidden = false;
  setProgressFor(job, 0, "Preparing stream");
  $("runStatus").textContent = "Predictions are frozen before each label; methods are paired on one stream.";
  try {
    const runResult = await runComparison(
      job.config,
      (fraction) => setProgressFor(job, fraction, job.paused ? "Paused" : "Running paired methods"),
      () => job.cancelled || !runController.isCurrent(job),
      () => runController.waitIfPaused(job)
    );
    if (!runController.isCurrent(job)) return;
    if (!renderResults(runResult, job)) return;
    setProgressFor(job, 1, "Comparison complete");
    if (runController.isCurrent(job)) {
      $("runStatus").textContent = `Complete. ${runResult.config.horizon} labels scored across ${METHOD_DEFS.length} methods.`;
      showToast("Comparison complete");
    }
  } catch (error) {
    if (runController.isCurrent(job)) {
      if (error.message !== "Experiment cancelled") {
        $("runStatus").textContent = `Run failed: ${error.message}`;
        showToast("The run failed; configuration was not discarded.");
      } else {
        $("runStatus").textContent = "Run cancelled. You can change the budget and retry.";
      }
    }
  } finally {
    if (runController.isCurrent(job)) {
      const finishedGeneration = runController.finish(job);
      if (finishedGeneration !== false && runController.isCurrentGeneration(finishedGeneration)) {
        $("runButton").disabled = false;
        $("pauseButton").disabled = true;
        $("pauseButton").textContent = "Pause run";
        $("cancelButton").disabled = true;
      }
    }
  }
}

function exportRun() {
  if (!lastRun) { showToast("Run a comparison before exporting."); return; }
  const blob = new Blob([JSON.stringify({ ...lastRun, exportVersion: "lwm.v1" }, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob); link.download = `learn-when-it-matters-seed-${lastRun.config.seed}.json`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  showToast("Versioned run exported.");
}

function saveLocally() {
  if (!lastRun) { showToast("Run a comparison before saving."); return; }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lastRun));
    showToast("Run saved in this browser.");
  } catch (error) {
    showToast(`Save unavailable: ${error.message}`);
  }
}

function setIdleControls(generation = null) {
  if (generation !== null && !runController.isCurrentGeneration(generation)) return false;
  $("runButton").disabled = false;
  $("pauseButton").disabled = true;
  $("pauseButton").textContent = "Pause run";
  $("cancelButton").disabled = true;
  return true;
}

function cancelCurrentRun() {
  const job = currentJob();
  if (!job) return false;
  const cancellation = runController.cancel();
  if (!cancellation || !runController.isCurrentGeneration(cancellation.generation)) return false;
  if (!setIdleControls(cancellation.generation)) return false;
  $("runStatus").textContent = "Run cancelled. You can change the budget and retry.";
  return true;
}

async function importRun(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const importGeneration = runController.beginImport();
  if (!runController.isCurrentGeneration(importGeneration)) return;
  setIdleControls(importGeneration);
  $("runStatus").textContent = "Reading saved run…";
  try {
    const parsed = JSON.parse(await file.text());
    if (!runController.isCurrentGeneration(importGeneration)) return;
    if (!isValidImportedRun(parsed)) throw new Error("This is not a complete Learn When It Matters v1 run.");
    if (!runController.isCurrentGeneration(importGeneration)) return;
    setConfig(parsed.config);
    if (renderResults(parsed, importGeneration) && runController.isCurrentGeneration(importGeneration)) {
      $("runStatus").textContent = "Saved run imported and reopened. Run fresh or import another versioned file.";
      showToast("Run imported and reopened.");
    }
  } catch (error) {
    if (runController.isCurrentGeneration(importGeneration)) {
      $("runStatus").textContent = `Import rejected: ${error.message}`;
      showToast(`Import rejected: ${error.message}`);
    }
  } finally {
    if (runController.isCurrentGeneration(importGeneration)) event.target.value = "";
  }
}

function reset() {
  const resetGeneration = runController.reset();
  if (!runController.isCurrentGeneration(resetGeneration)) return;
  setConfig(DEFAULT_CONFIG);
  lastRun = null;
  setIdleControls(resetGeneration);
  $("bestMse").textContent = "—"; $("bestMseMethod").textContent = "run to measure"; $("bestEfficiency").textContent = "—"; $("bestEfficiencyMethod").textContent = "probes included"; $("decisionCount").textContent = "—";
  $("resultsBody").innerHTML = '<tr><td colspan="6" class="empty-cell">No run yet. The seeded example is ready.</td></tr>';
  $("chartDataBody").innerHTML = '<tr><td colspan="4" class="empty-cell">Run the comparison to populate this table.</td></tr>';
  $("traceBody").innerHTML = '<tr><td colspan="7" class="empty-cell">Run the comparison to populate this trace.</td></tr>';
  $("traceSummary").textContent = "Run a comparison to inspect its step trace.";
  $("chartEmpty").style.display = "grid";
  $("runStatus").textContent = "Ready. The example stream is deterministic.";
  $("readoutText").textContent = "This browser view is one seeded empirical instrument. Its readouts are descriptive only; they do not establish a scientific winner, equivalence, or negative result.";
  showToast("Example configuration restored.");
}

for (const id of ["horizon", "recurrence", "noise"]) $(id).addEventListener("input", updateValueLabels);
$("runButton").addEventListener("click", run);
$("pauseButton").addEventListener("click", () => {
  const job = currentJob();
  if (!job) return;
  const paused = runController.togglePause(job);
  if (!runController.isCurrent(job)) return;
  $("pauseButton").textContent = paused ? "Resume run" : "Pause run";
  $("runStatus").textContent = paused ? "Run paused. Resume or cancel when ready." : "Predictions are frozen before each label; methods are paired on one stream.";
});
$("cancelButton").addEventListener("click", cancelCurrentRun);
$("exportButton").addEventListener("click", exportRun);
$("saveButton").addEventListener("click", saveLocally);
$("importInput").addEventListener("change", importRun);
$("importLabel").addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $("importInput").click(); }
});
$("traceMethod").addEventListener("change", () => { if (lastRun) renderTrace(lastRun); });
$("resetButton").addEventListener("click", reset);
$("themeToggle").addEventListener("click", () => document.body.classList.toggle("light"));
window.addEventListener("resize", () => { if (lastRun) drawChart(lastRun); });

renderLegend();
updateValueLabels();
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const restored = JSON.parse(saved);
    if (isValidImportedRun(restored)) {
      setConfig(restored.config);
      renderResults(restored);
      $("runStatus").textContent = "Saved run restored locally. Run fresh or import another versioned file.";
    }
  }
} catch { /* localStorage may be disabled; the run remains usable. */ }
