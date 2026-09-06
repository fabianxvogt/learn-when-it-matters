import test from "node:test";
import assert from "node:assert/strict";
import { createRunController } from "../src/run-controller.js";

test("late run A cannot overwrite imported run B", () => {
  const controller = createRunController();
  const a = controller.begin({ seed: 1 });
  const importB = controller.beginImport();
  let visible = "B";

  assert.equal(controller.commit(a, () => { visible = "late A"; }), false);
  assert.equal(controller.commit(importB, () => { visible = "B"; }), true);
  assert.equal(visible, "B");
});

test("late rejection after reset cannot replace reset state", () => {
  const controller = createRunController();
  const a = controller.begin({ seed: 1 });
  const resetGeneration = controller.reset();
  let visible = "Ready";

  assert.equal(controller.commit(a, () => { visible = "late A error"; }), false);
  assert.equal(controller.commit(resetGeneration, () => { visible = "Ready"; }), true);
  assert.equal(visible, "Ready");
});

test("cancel A releases its wait and lets B own controls", async () => {
  const controller = createRunController();
  const a = controller.begin({ seed: 1 });
  assert.equal(controller.togglePause(a), true);
  const waiting = controller.waitIfPaused(a);
  controller.cancel();
  const b = controller.begin({ seed: 2 });
  await waiting;

  let controls = "B";
  assert.equal(controller.commit(a, () => { controls = "late A cleanup"; }), false);
  assert.equal(controller.commit(b, () => { controls = "B"; }), true);
  assert.equal(controls, "B");
});

test("overlapping imports and reset invalidate every stale read", () => {
  const controller = createRunController();
  const importA = controller.beginImport();
  const importB = controller.beginImport();
  const resetGeneration = controller.reset();
  let visible = "Ready";

  assert.equal(controller.commit(importA, () => { visible = "A"; }), false);
  assert.equal(controller.commit(importB, () => { visible = "B"; }), false);
  assert.equal(controller.commit(resetGeneration, () => { visible = "Ready"; }), true);
  assert.equal(visible, "Ready");
});
