import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { AudioFrameBuffer } from "../../audio/frameBuffer.js";
import { createAudioBuffers, resetAudioBuffers } from "../../audio/audioBuffer.js";
import { containsWakeWord, removeWakeWord } from "../../voice/wakeWord.js";
import * as memory from "../../memory/index.js";
import type { ClassificationResult } from "../../commands/classifier.js";
import type { ConversationTurn } from "../../conversation/history.js";
import { waitForAbort } from "./request-harness.js";

type ConversationCall = {
  input: string;
  signal: AbortSignal | undefined;
  onSpeaking: (() => boolean) | undefined;
};
type Options = {
  classify?: (input: string, signal?: AbortSignal) => Promise<ClassificationResult>;
  conversation?: (call: ConversationCall) => Promise<ConversationTurn | null>;
};

// Drain deterministic in-memory async work, without sleeping or polling services.
export async function flushVoiceTasks() {
  for (let index = 0; index < 50; index++) await Promise.resolve();
}

export async function voiceHarness(options: Options = {}) {
  const logs: unknown[][] = [];
  const errors: unknown[][] = [];
  const spoken: string[] = [];
  const executed: string[] = [];
  const classifications: { input: string; signal: AbortSignal | undefined }[] = [];
  const conversations: ConversationCall[] = [];
  const files = new Map<string, Buffer>();
  const snapshots: Buffer[] = [];
  const wakeTranscripts: (string | Promise<string>)[] = [];
  const commandTranscripts: string[] = [];
  const intervals: (() => void)[] = [];
  const clearedIntervals = new Set<unknown>();
  let now = 0;
  let stopCalls = 0;
  let workerShutdowns = 0;

  class FakeProcess extends EventEmitter {
    env = { JARVIS_HISTORY_ENABLED: "false" };
    exitCode: number | undefined;
  }
  const fakeProcess = new FakeProcess();
  class FakeChild extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    stdin = Object.assign(new EventEmitter(), { destroyed: false, writable: true });
    killed = false;
    exitCode = null;
    signalCode = null;
    kill() { this.killed = true; return true; }
  }
  const child = new FakeChild();
  class FakeVAD {
    processFrame(samples: Int16Array) { return samples[0] ? "VOICE" : "SILENCE"; }
    destroy() {}
  }

  const imports: Record<string, unknown> = {
    "../audio/index.js": {
      startMicrophone: () => child,
      isNativePlaybackEvent: () => false,
      sendNativePlaybackCommand: async () => { throw new Error("Unexpected native playback"); },
      createAudioBuffers, resetAudioBuffers, AudioFrameBuffer,
      createWavBuffer: (pcm: Buffer) => Buffer.from(pcm),
    },
    "../conversation/index.js": {
      systemPrompt: "Synthetic system prompt",
      loadConversationHistory: async () => { throw new Error("Unexpected history read"); },
      saveConversationHistory: async () => { throw new Error("Unexpected history write"); },
      selectRecentTurns: () => [],
      processMessage: async (
        input: string,
        _history: unknown,
        onSpeaking: (() => boolean) | undefined,
        _isCurrent: unknown,
        _facts: unknown,
        signal?: AbortSignal,
      ) => {
        const call = { input, signal, onSpeaking };
        conversations.push(call);
        return options.conversation ? options.conversation(call) : waitForAbort(signal);
      },
    },
    "node:fs/promises": {
      writeFile: async (path: string, data: Buffer) => {
        files.set(path, Buffer.from(data));
        if (path === "wakeSnapshot.wav") snapshots.push(Buffer.from(data));
      },
      unlink: async (path: string) => { files.delete(path); },
    },
    "../stt/transcription.js": {
      transcribeAudio: async (path: string) => {
        const text = path === "wakeSnapshot.wav" ? wakeTranscripts.shift() : commandTranscripts.shift();
        if (text === undefined) throw new Error("Missing synthetic transcript");
        return text;
      },
    },
    "./wakeWord.js": { containsWakeWord, removeWakeWord },
    "../tts/index.js": {
      speak: async (text: string) => { spoken.push(text); return true; },
      stopKokoroPlayback: () => { stopCalls++; },
      shutdownKokoroWorker: async () => { workerShutdowns++; },
      configureNativePlayback: () => {},
    },
    "../commands/index.js": {
      classifyIntent: async (input: string, _last: unknown, _keys: unknown, signal?: AbortSignal) => {
        classifications.push({ input, signal });
        if (signal?.aborted) return { status: "CANCELLED" };
        if (options.classify) return options.classify(input, signal);
        return input.includes("time") ? { status: "COMMAND", command: "GET_TIME" } : { status: "NONE" };
      },
      executeLocalCommand: async (command: string) => { executed.push(command); return "Synthetic time answer"; },
    },
    "@ozymandiasthegreat/vad": {
      default: async () => FakeVAD,
      VADMode: { VERY_AGGRESSIVE: 3 },
      VADEvent: { VOICE: "VOICE", SILENCE: "SILENCE" },
      __esModule: true,
    },
    "node:readline": { createInterface: () => new EventEmitter() },
    "node:path": { resolve: (path: string) => `/synthetic/${path}` },
    "../memory/index.js": {
      ...memory,
      loadMemoryFile: async () => ({ version: 1, facts: [] }),
      saveMemoryFile: async () => { throw new Error("Unexpected memory write"); },
    },
  };

  const moduleObject = { exports: {} };
  const source = readFileSync(new URL("../../voice/controller.ts", import.meta.url), "utf8");
  runInNewContext(transformSync(source, { loader: "ts", format: "cjs", target: "es2022" }).code, {
    module: moduleObject,
    exports: moduleObject.exports,
    require: (name: string) => {
      if (!(name in imports)) throw new Error("Unexpected controller test import");
      return imports[name];
    },
    Buffer, AbortController,
    Date: class extends Date { static override now() { return now; } },
    process: fakeProcess,
    console: {
      log: (...args: unknown[]) => logs.push(args),
      warn: () => {},
      error: (...args: unknown[]) => errors.push(args),
    },
    setInterval: (callback: () => void) => { intervals.push(callback); return callback; },
    clearInterval: (handle: unknown) => { clearedIntervals.add(handle); },
    setTimeout: () => { throw new Error("Unexpected native timeout"); },
    clearTimeout: () => {},
  });
  const { startVoiceController } = moduleObject.exports as { startVoiceController: () => Promise<void> };
  await startVoiceController();

  function feedVoice(marker = 1) { child.stdout.emit("data", Buffer.alloc(960, marker)); }
  async function checkWake(transcript: string | Promise<string>, marker = 2) {
    wakeTranscripts.push(transcript);
    feedVoice(marker);
    for (const tick of intervals) if (!clearedIntervals.has(tick)) tick();
    await flushVoiceTasks();
  }
  async function finishCommand(transcript: string) {
    commandTranscripts.push(transcript);
    child.stdout.emit("data", Buffer.alloc(960 * 50));
    await flushVoiceTasks();
  }
  async function startCommand(text: string) {
    now += 1001;
    await checkWake(`Jarvis, ${text}`, 1);
    await finishCommand(text);
  }
  async function shutdown() {
    fakeProcess.emit("SIGINT");
    await flushVoiceTasks();
  }

  return {
    logs, errors, spoken, executed, classifications, conversations, snapshots, files,
    checkWake, finishCommand, startCommand, shutdown,
    stopCalls: () => stopCalls,
    workerShutdowns: () => workerShutdowns,
  };
}
