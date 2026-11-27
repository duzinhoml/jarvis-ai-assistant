import { test } from "node:test";
import assert from "node:assert/strict";
import { deferred, waitForAbort } from "./helpers/request-harness.js";
import { flushVoiceTasks, voiceHarness } from "./helpers/voice-harness.js";

test("processing stop aborts the conversation and the next time command still works", async () => {
  const harness = await voiceHarness();
  try {
    await harness.startCommand("explain memory");
    assert.equal(harness.conversations.length, 1);
    const oldSignal = harness.conversations[0]?.signal;
    assert.equal(oldSignal?.aborted, false);

    await harness.checkWake("Jarvis, stop.");
    assert.equal(oldSignal?.aborted, true);
    await harness.finishCommand("stop.");
    assert.equal(harness.classifications.length, 1, "stop must bypass classification");
    assert.deepEqual(harness.spoken, []);
    assert.deepEqual(harness.errors, []);

    await harness.startCommand("what time is it?");
    assert.deepEqual(harness.executed, ["GET_TIME"]);
    assert.deepEqual(harness.spoken, ["Synthetic time answer"]);
  } finally { await harness.shutdown(); }
});

test("replacement during classification cancels the original and executes only the replacement", async () => {
  const harness = await voiceHarness({ classify: async (input, signal) => {
    if (input.includes("explain")) return waitForAbort(signal);
    return { status: "COMMAND", command: "GET_TIME" };
  } });
  try {
    await harness.startCommand("explain memory");
    const oldSignal = harness.classifications[0]?.signal;
    await harness.checkWake("Jarvis, what time is it?");
    assert.equal(oldSignal?.aborted, true);
    await harness.finishCommand("what time is it?");
    assert.deepEqual(harness.executed, ["GET_TIME"]);
    assert.equal(harness.conversations.length, 0);
    assert.deepEqual(harness.errors, []);
  } finally { await harness.shutdown(); }
});

test("processing wake snapshot excludes the original command audio", async () => {
  const harness = await voiceHarness();
  try {
    await harness.startCommand("explain memory");
    await harness.checkWake("Jarvis, stop.", 2);
    const interruption = harness.snapshots.at(-1);
    assert.ok(interruption);
    assert.equal(interruption.length, 960);
    assert.ok(interruption.every(byte => byte === 2));
    await harness.finishCommand("stop.");
  } finally { await harness.shutdown(); }
});

test("processing background speech without a wake word leaves the active request alone", async () => {
  const harness = await voiceHarness();
  try {
    await harness.startCommand("explain memory");
    const active = harness.conversations[0]?.signal;
    await harness.checkWake("Some unrelated background speech");
    assert.equal(active?.aborted, false);
    assert.equal(harness.stopCalls(), 0);
    assert.equal(harness.classifications.length, 1);
    assert.deepEqual(harness.errors, []);
  } finally { await harness.shutdown(); }
});

test("a processing snapshot keeps anchored matching even if speech starts before transcription finishes", async () => {
  const harness = await voiceHarness();
  try {
    await harness.startCommand("explain memory");
    const transcript = deferred<string>();
    await harness.checkWake(transcript.promise);
    const call = harness.conversations[0];
    assert.ok(call);
    assert.equal(call.onSpeaking?.(), true);
    transcript.resolve("background words Jarvis stop");
    await flushVoiceTasks();
    assert.equal(call.signal?.aborted, false, "captured PROCESSING must not use unanchored SPEAKING matching");
    assert.equal(harness.stopCalls(), 0);
  } finally { await harness.shutdown(); }
});

test("shutdown during wake transcription prevents late wake results from reviving listening", async () => {
  const harness = await voiceHarness();
  await harness.startCommand("explain memory");
  const transcript = deferred<string>();
  await harness.checkWake(transcript.promise);
  await harness.shutdown();
  const wakeCount = harness.logs.filter(args => args[0] === "Wake word detected! JARVIS is now listening...").length;
  transcript.resolve("Jarvis, what time is it?");
  await flushVoiceTasks();
  assert.equal(harness.logs.filter(args => args[0] === "Wake word detected! JARVIS is now listening...").length, wakeCount);
  assert.equal(harness.workerShutdowns(), 1);
  assert.deepEqual(harness.executed, []);
  assert.deepEqual(harness.errors, []);
});

test("late old-command cleanup cannot cancel a replacement request", async () => {
  const oldResult = deferred<null>();
  let calls = 0;
  const harness = await voiceHarness({ conversation: async ({ signal }) => {
    if (calls++ === 0) return oldResult.promise;
    return waitForAbort(signal);
  } });
  try {
    await harness.startCommand("explain memory");
    await harness.checkWake("Jarvis, explain promises");
    await harness.finishCommand("explain promises");
    assert.equal(harness.conversations.length, 2);
    const current = harness.conversations[1]?.signal;
    oldResult.resolve(null);
    await flushVoiceTasks();
    assert.equal(current?.aborted, false);
    assert.equal(harness.logs.some(args => args[0] === "JARVIS is ready for another command"), false);
    await harness.checkWake("Jarvis, stop");
    assert.equal(current?.aborted, true, "new controller must still be registered after old finally runs");
    await harness.finishCommand("stop");
    assert.deepEqual(harness.errors, []);
  } finally { oldResult.resolve(null); await harness.shutdown(); }
});
