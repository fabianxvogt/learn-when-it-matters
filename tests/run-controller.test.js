import test from "node:test";
import assert from "node:assert/strict";
import { createRunController } from "../src/run-controller.js";

test("late run A cannot overwrite imported run B", () => {
  const controller = createRunController();
  const a = controller.begin({ seed: 1 });
  const importB = controller.beginImport();
  const dom = { status: "Imported B", result: "B", runDisabled: false, pauseDisabled: true, cancelDisabled: true };

  assert.equal(controller.commit(a, () => {
    dom.status = "A complete";
    dom.result = "A";
    dom.runDisabled = true;
  }), false);
  assert.equal(controller.commit(importB, () => {
    dom.status = "Imported B";
    dom.result = "B";
    dom.runDisabled = false;
  }), true);
  assert.deepEqual(dom, { status: "Imported B", result: "B", runDisabled: false, pauseDisabled: true, cancelDisabled: true });
});

test("late rejection after reset cannot replace reset state", () => {
  const controller = createRunController();
  const a = controller.begin({ seed: 1 });
  const resetGeneration = controller.reset();
  const dom = { status: "Ready", result: "none", runDisabled: false, pauseDisabled: true, cancelDisabled: true };

  assert.equal(controller.commit(a, () => {
    dom.status = "Run failed";
    dom.result = "A";
    dom.runDisabled = true;
  }), false);
  assert.equal(controller.commit(resetGeneration, () => {
    dom.status = "Ready";
    dom.result = "none";
    dom.runDisabled = false;
  }), true);
  assert.deepEqual(dom, { status: "Ready", result: "none", runDisabled: false, pauseDisabled: true, cancelDisabled: true });
});

test("cancel A releases its wait and lets B own controls", async () => {
  const controller = createRunController();
  const a = controller.begin({ seed: 1 });
  assert.equal(controller.togglePause(a), true);
  const waiting = controller.waitIfPaused(a);
  controller.cancel();
  const b = controller.begin({ seed: 2 });
  await waiting;

  const dom = { status: "B running", result: "B", runDisabled: true, pauseDisabled: false, cancelDisabled: false };
  assert.equal(controller.commit(a, () => {
    dom.status = "A cleanup";
    dom.result = "A";
    dom.runDisabled = false;
  }), false);
  assert.equal(controller.commit(b, () => {
    dom.status = "B running";
    dom.result = "B";
  }), true);
  assert.deepEqual(dom, { status: "B running", result: "B", runDisabled: true, pauseDisabled: false, cancelDisabled: false });
});

test("overlapping imports and reset invalidate every stale read", () => {
  const controller = createRunController();
  const importA = controller.beginImport();
  const importB = controller.beginImport();
  const resetGeneration = controller.reset();
  const dom = { status: "Ready", result: "none", runDisabled: false };

  assert.equal(controller.commit(importA, () => { dom.status = "A"; dom.result = "A"; }), false);
  assert.equal(controller.commit(importB, () => { dom.status = "B"; dom.result = "B"; }), false);
  assert.equal(controller.commit(resetGeneration, () => { dom.status = "Ready"; dom.result = "none"; dom.runDisabled = false; }), true);
  assert.deepEqual(dom, { status: "Ready", result: "none", runDisabled: false });
});
