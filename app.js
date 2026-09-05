import { DEFAULT_CONFIG, METHOD_DEFS, formatNumber, runComparison } from "./src/core.js";

const STORAGE_KEY = "learn-when-it-matters:v1:last-run";
const colors = { signal: "#c9ff4f", red: "#ff7c8c", blue: "#77b8ff", violet: "#c0a3ff", orange: "#ffae72", green: "#6ee0b5", slate: "#a6b2bc" };
const $ = (id) => document.getElementById(id);
let activeRun = null;
let lastRun = null;

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

function renderResults(run) {
  lastRun = run;
  const bestMse = run.results.find((result) => result.methodId === run.bestByMse);
  const bestEfficiency = run.results.find((result) => result.methodId === run.bestByEfficiency);
  $("bestMse").textContent = formatNumber(bestMse.mse, 4);
  $("bestMseMethod").textContent = method(bestMse.methodId).label;
  $("bestEfficiency").textContent = formatNumber(bestEfficiency.errorPerCost, 5);
  $("bestEfficiencyMethod").textContent = `${method(bestEfficiency.methodId).label} · probes included`;
  $("decisionCount").textContent = formatNumber(run.results.reduce((sum, result) => sum + result.updateCount + result.probeCount, 0), 0);
  $("resultsBody").innerHTML = run.results.map((result) => {
    const item = method(result.methodId);
    const signal = result.methodId === run.bestByMse ? "best raw" : result.methodId === run.bestByEfficiency ? "best / cost" : "—";
    return `<tr><td><span class="method-dot" style="background:${colors[item.tone]}"></span>${item.label}</td><td>${formatNumber(result.mse, 4)}</td><td>${result.updateCount}</td><td>${result.probeCount}</td><td>${result.discardedCandidates ?? result.discardedUpdates}</td><td>${formatNumber(result.cost, 0)}</td><td class="${signal !== "—" ? "signal-text" : ""}">${signal}</td></tr>`;
  }).join("");
  $("chartEmpty").hidden = false;
  $("chartEmpty").style.display = "none";
  drawChart(run);
  const causal = run.results.find((result) => result.methodId === "causal-gate");
  const classical = run.results.find((result) => result.methodId === "classical");
  const winner = bestEfficiency.methodId === "causal-gate" ? "The causal gate currently leads the cost-normalized readout, but this is one seeded browser stream." : `The cost-normalized lead is ${method(bestEfficiency.methodId).label}; the usefulness gate should not be expanded without held-out local evidence.`;
  $("readoutText").textContent = `${winner} It used ${causal.probeCount} probes, ${causal.discardedCandidates ?? causal.discardedUpdates} discarded candidates, and ${formatNumber(causal.costLedger.elapsedWallMs, 1)} ms wall time; RLS is included as a classical tracking control (${formatNumber(classical.mse, 4)} MSE).`;
}

async function run() {
  if (activeRun) return;
  const config = readConfig();
  activeRun = { cancelled: false };
  $("runButton").disabled = true;
  $("cancelButton").disabled = false;
  $("progressWrap").hidden = false;
  setProgress(0, "Preparing stream");
  $("runStatus").textContent = "Predictions are frozen before each label; methods are paired on one stream.";
  try {
    const runResult = await runComparison(config, (fraction) => setProgress(fraction, "Running paired methods"), () => activeRun?.cancelled);
    if (activeRun?.cancelled) return;
    renderResults(runResult);
    setProgress(1, "Comparison complete");
    $("runStatus").textContent = `Complete. ${runResult.config.horizon} labels scored across ${METHOD_DEFS.length} methods.`;
    showToast("Comparison complete");
  } catch (error) {
    if (error.message !== "Experiment cancelled") {
      $("runStatus").textContent = `Run failed: ${error.message}`;
      showToast("The run failed; configuration was not discarded.");
    } else {
      $("runStatus").textContent = "Run cancelled. You can change the budget and retry.";
    }
  } finally {
    activeRun = null;
    $("runButton").disabled = false;
    $("cancelButton").disabled = true;
  }
}

function exportRun() {
  if (!lastRun) { showToast("Run a comparison before exporting."); return; }
  const blob = new Blob([JSON.stringify({ ...lastRun, exportVersion: "lwm.v1" }, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob); link.download = `learn-when-it-matters-seed-${lastRun.config.seed}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  showToast("Versioned run exported.");
}

function saveLocally() {
  if (!lastRun) { showToast("Run a comparison before saving."); return; }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lastRun));
  showToast("Run saved in this browser.");
}

async function importRun(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.version !== 1 || !parsed.config || !Array.isArray(parsed.results)) throw new Error("This is not a Learn When It Matters v1 run.");
    if (!parsed.results.every((result) => result.methodId && Number.isFinite(result.mse) && Array.isArray(result.predictions))) throw new Error("Run results are incomplete.");
    setConfig(parsed.config);
    renderResults(parsed);
    showToast("Run imported and reopened.");
  } catch (error) {
    showToast(`Import rejected: ${error.message}`);
  } finally { event.target.value = ""; }
}

function reset() {
  if (activeRun) { activeRun.cancelled = true; }
  setConfig(DEFAULT_CONFIG);
  lastRun = null;
  $("bestMse").textContent = "—"; $("bestMseMethod").textContent = "run to measure"; $("bestEfficiency").textContent = "—"; $("bestEfficiencyMethod").textContent = "probes included"; $("decisionCount").textContent = "—";
  $("resultsBody").innerHTML = '<tr><td colspan="7" class="empty-cell">No run yet. The seeded example is ready.</td></tr>';
  $("chartEmpty").style.display = "grid";
  $("runStatus").textContent = "Ready. The example stream is deterministic.";
  $("readoutText").textContent = "A frontier with no improvement is still a useful negative result. Run the comparison to see whether the gate earns its probe overhead on this stream.";
  showToast("Example configuration restored.");
}

for (const id of ["horizon", "recurrence", "noise"]) $(id).addEventListener("input", updateValueLabels);
$("runButton").addEventListener("click", run);
$("cancelButton").addEventListener("click", () => { if (activeRun) activeRun.cancelled = true; });
$("exportButton").addEventListener("click", exportRun);
$("saveButton").addEventListener("click", saveLocally);
$("importInput").addEventListener("change", importRun);
$("resetButton").addEventListener("click", reset);
$("themeToggle").addEventListener("click", () => document.body.classList.toggle("light"));
window.addEventListener("resize", () => { if (lastRun) drawChart(lastRun); });

renderLegend();
updateValueLabels();
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const restored = JSON.parse(saved);
    if (restored.version === 1 && restored.config && Array.isArray(restored.results)) {
      setConfig(restored.config);
      renderResults(restored);
      $("runStatus").textContent = "Saved run restored locally. Run fresh or import another versioned file.";
    }
  }
} catch { /* localStorage may be disabled; the run remains usable. */ }
