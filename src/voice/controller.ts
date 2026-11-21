import {
  startMicrophone,
  isNativePlaybackEvent,
  sendNativePlaybackCommand,
  type ListeningState,
  createAudioBuffers,
  resetAudioBuffers,
  AudioFrameBuffer,
  createWavBuffer,
} from "../audio/index.js";
import {
  loadConversationHistory,
  processMessage,
  saveConversationHistory,
  systemPrompt,
  type ConversationHistoryFile,
  selectRecentTurns,
} from "../conversation/index.js";
import { writeFile, unlink } from "node:fs/promises";
import { transcribeAudio } from "../stt/transcription.js";
import { containsWakeWord, removeWakeWord } from "./wakeWord.js";
import {
  speak,
  stopKokoroPlayback,
  shutdownKokoroWorker,
  configureNativePlayback,
} from "../tts/index.js";
import {
  executeLocalCommand,
  classifyIntent,
  type LocalCommand,
} from "../commands/index.js";
import VADBuilder, { VADMode, VADEvent } from "@ozymandiasthegreat/vad";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import {
  findMemoryFact,
  loadMemoryFile,
  removeMemoryFact,
  saveMemoryFile,
  upsertMemoryFact,
  type MemoryCommand,
  type MemoryFact,
  type MemoryFile,
} from "../memory/index.js";

export const startVoiceController = async (): Promise<void> => {
  // Loading Conversation History
  const historyFilePath = resolve("data/conversation-history.json");
  let savedHistory: ConversationHistoryFile = { version: 1, turns: [] };
  let historyPersistenceEnable = process.env.JARVIS_HISTORY_ENABLED !== "false";
  let canPersistHistory: boolean = historyPersistenceEnable;

  if (canPersistHistory) {
    try {
      savedHistory = await loadConversationHistory(historyFilePath);
    } catch (error) {
      console.warn(
        "Saved conversation history could not be loaded. Continuing with session-only history; persistence is disabled for this session.",
        error,
      );
      canPersistHistory = false;
    }
  } else {
    console.warn(
      "Conversation history persistence is disabled. Using session-only history.",
    );
  }

  let historySaveQueue: Promise<void> = Promise.resolve();
  const queueHistorySave = async (): Promise<void> => {
    if (!canPersistHistory) return;

    const snapshot: ConversationHistoryFile = {
      version: 1,
      turns: [...savedHistory.turns],
    };

    historySaveQueue = historySaveQueue.then(async () => {
      if (!canPersistHistory) return;

      try {
        await saveConversationHistory(historyFilePath, snapshot);
      } catch (error) {
        canPersistHistory = false;
        console.warn(
          "Conversation history could not be saved. Continuing with session-only history; persistence is disabled for this session.",
          error,
        );
      }
    });

    return historySaveQueue;
  };

  // Loading Memory File
  const memoryFilePath = resolve("data/memory.json");
  let savedMemory: MemoryFile = { version: 1, facts: [] };
  let canPersistMemory: boolean = true;

  try {
    savedMemory = await loadMemoryFile(memoryFilePath);
  } catch (error) {
    canPersistMemory = false;
    console.warn(
      "Saved memory could not be loaded. Memory updates are disabled for this session.",
      error,
    );
  }

  const persistMemoryUpdate = async (
    memoryFacts: MemoryFact[],
  ): Promise<boolean> => {
    if (!canPersistMemory) return false;

    const snapshot: MemoryFile = { version: 1, facts: [...memoryFacts] };

    try {
      await saveMemoryFile(memoryFilePath, snapshot);

      savedMemory = snapshot;
      return true;
    } catch (error) {
      canPersistMemory = false;
      console.warn(
        "Saved memory could not be updated. The previous memory has been retained; further updates are disabled for this session.",
        error,
      );

      return false;
    }
  };

  type MemoryUpdate = (facts: MemoryFact[]) => MemoryFact[];
  let memoryUpdateQueue: Promise<boolean> = Promise.resolve(true);

  const queueMemoryUpdate = async (update: MemoryUpdate): Promise<boolean> => {
    memoryUpdateQueue = memoryUpdateQueue
      .then(async () => {
        if (!canPersistMemory) return false;

        const storedFacts = update(savedMemory.facts);

        return await persistMemoryUpdate(storedFacts);
      })
      .catch((error) => {
        console.warn(
          "Memory update failed. The previous memory has been retained.",
          error,
        );

        return false;
      });

    return memoryUpdateQueue;
  };

  const executeMemoryCommand = async (
    command: MemoryCommand,
  ): Promise<string> => {
    if (command.action === "remember") {
      const response = await queueMemoryUpdate((latestFacts: MemoryFact[]) => {
        return upsertMemoryFact(latestFacts, command.fact);
      });

      return response
        ? "I've saved that to memory, Sir."
        : "I couldn't save that to memory, Sir.";
    }

    if (command.action === "recall") {
      await memoryUpdateQueue;

      const fact = findMemoryFact(savedMemory.facts, command.key);
      return fact
        ? `I have ${fact.key} saved as ${fact.value}, Sir.`
        : "I don't have a saved value for that, Sir.";
    }

    if (command.action === "forget") {
      let factWasPresent: boolean = false;

      const response = await queueMemoryUpdate((latestFacts: MemoryFact[]) => {
        if (findMemoryFact(latestFacts, command.key)) factWasPresent = true;

        return removeMemoryFact(latestFacts, command.key);
      });

      if (!response) return "I couldn't remove that from saved memory, Sir.";

      if (factWasPresent) return "I've removed that from saved memory, Sir.";
      else return "I don't have a saved value for that, Sir.";
    }

    if (command.action === "list") {
      await memoryUpdateQueue;

      if (savedMemory.facts.length === 0)
        return "I don't have any saved facts yet, Sir.";

      const sentencedFacts = savedMemory.facts.map((fact) => {
        return `Your ${fact.key} is ${fact.value}.`;
      });

      const joinedFacts = sentencedFacts.join(" ");

      return `Here's what I have saved, Sir. ${joinedFacts}`;
    }

    return "That memory action isn't available yet, Sir.";
  };

  // VAD Initialization
  const VAD = await VADBuilder();
  const vad = new VAD(VADMode.VERY_AGGRESSIVE, 16000);
  const frameBuffer = new AudioFrameBuffer();

  const microphoneSource =
    process.env.JARVIS_AUDIO_SOURCE === "sox" ? "sox" : "native";
  const child = startMicrophone(microphoneSource);

  const pendingNativePlayback = new Map<
    number,
    { resolve: () => void; reject: (error: Error) => void }
  >();

  let nextNativePlaybackId = 0;

  const playNativeAudio = (path: string): Promise<void> => {
    if (
      isShuttingDown ||
      child.killed ||
      child.exitCode !== null ||
      child.signalCode !== null ||
      child.stdin.destroyed ||
      !child.stdin.writable
    ) {
      return Promise.reject(new Error("Native audio playback is unavailable"));
    }

    const id = ++nextNativePlaybackId;

    return new Promise((resolve, reject) => {
      let timedOut = false;
      let stopTimeout: ReturnType<typeof setTimeout> | undefined;

      const timeout = setTimeout(() => {
        timedOut = true;

        stopTimeout = setTimeout(() => {
          console.error("Native playback did not acknowledge STOP.");
          child.kill("SIGKILL");
        }, 2_000);

        sendNativePlaybackCommand(child, {
          type: "stop",
          id,
        }).catch((error: unknown) => {
          console.error("Native timeout cancellation failed:", error);
          child.kill("SIGKILL");
        });
      }, 120_000);

      const cleanup = (): void => {
        clearTimeout(timeout);
        clearTimeout(stopTimeout);
        pendingNativePlayback.delete(id);
      };

      const finish = (): void => {
        cleanup();

        if (timedOut) {
          reject(new Error(`Native playback ${id} timed out`));
        } else {
          resolve();
        }
      };

      const fail = (error: Error): void => {
        cleanup();
        reject(error);
      };

      pendingNativePlayback.set(id, {
        resolve: finish,
        reject: fail,
      });

      sendNativePlaybackCommand(child, {
        type: "play",
        id,
        path,
      }).catch((error: unknown) => {
        fail(error instanceof Error ? error : new Error(String(error)));
      });
    });
  };

  const stopNativeAudio = async (): Promise<void> => {
    if (
      child.killed ||
      child.exitCode !== null ||
      child.signalCode !== null ||
      child.stdin.destroyed ||
      !child.stdin.writable
    ) {
      return;
    }

    const ids = [...pendingNativePlayback.keys()];

    await Promise.all(
      ids.map((id) => sendNativePlaybackCommand(child, { type: "stop", id })),
    );
  };

  const rejectPendingNativePlayback = (error: Error): void => {
    for (const pending of pendingNativePlayback.values()) {
      pending.reject(error);
    }

    pendingNativePlayback.clear();
  };

  child.stdin.on("error", (error: Error) => {
    rejectPendingNativePlayback(error);
    console.error("Native audio command pipe failed:", error);
  });

  const nativeMessages = createInterface({
    input: child.stderr,
    crlfDelay: Infinity,
  });

  nativeMessages.on("line", (line: string) => {
    let message: unknown;

    try {
      message = JSON.parse(line);
    } catch {
      console.error(line);
      return;
    }

    if (isNativePlaybackEvent(message)) {
      const pending = pendingNativePlayback.get(message.id);
      if (!pending) return;

      pendingNativePlayback.delete(message.id);

      if (message.type === "playbackError") {
        pending.reject(new Error(message.message));
      } else {
        pending.resolve();
      }

      return;
    }

    console.error(line);
  });

  configureNativePlayback(
    microphoneSource === "native"
      ? { play: playNativeAudio, stop: stopNativeAudio }
      : null,
  );

  type Message = {
    role: "user" | "assistant" | "system";
    content: string;
  };

  const conversationHistory: Message[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const turn of selectRecentTurns(savedHistory.turns)) {
    conversationHistory.push({ role: "user", content: turn.userMessage });
    conversationHistory.push({ role: "assistant", content: turn.aiResponse });
  }

  let lastCommand: LocalCommand | null = null;

  const resetConversationHistory = (): void => {
    savedHistory.turns.length = 0;
    conversationHistory.splice(1);
    lastCommand = null;
  };

  const clearConversationHistory = async (): Promise<boolean> => {
    await historySaveQueue;
    resetConversationHistory();
    await queueHistorySave();

    return canPersistHistory;
  };

  let state: ListeningState = "IDLE";
  console.log(state);

  const buffers = createAudioBuffers();
  const MAX_BUFFER_BYTES = 16000 * 2 * 3;
  let totalBytes = 0;
  const MAX_PENDING_BYTES = 16000 * 2 * 5;
  let pendingBytes = 0;
  let commandBytes = 0;

  let isShuttingDown = false;

  const MAX_LISTENING_MS = 10000;
  const FIRST_COMMAND_TIMEOUT_MS = 4000;
  let listeningStart: number | null = null;
  let silenceHandled = false;
  let isTranscribing = false;
  let idleSpeechDetected: boolean = false;

  const SPEECH_COOLDOWN_MS = 1000;
  let cooldownUntil = 0;

  let sessionId = 0;

  let vadSilentFrames = 0;
  let vadVoiceDetected = false;
  const VAD_SILENCE_FRAMES = 50;

  const canDetectWakeWord = (): boolean => {
    return state === "IDLE" || state === "SPEAKING";
  };

  child.stdout.on("data", (chunk: Buffer) => {
    if (
      isShuttingDown ||
      Date.now() < cooldownUntil ||
      state === "PROCESSING"
    ) {
      return;
    }

    if (isTranscribing && canDetectWakeWord()) {
      buffers.pending.push(chunk);
      pendingBytes += chunk.length;
      while (pendingBytes > MAX_PENDING_BYTES) {
        const removedChunk = buffers.pending.shift();
        if (!removedChunk) break;
        pendingBytes -= removedChunk.length;
      }
    }

    if (canDetectWakeWord()) {
      buffers.wake.push(chunk);
      totalBytes += chunk.length;
      while (totalBytes > MAX_BUFFER_BYTES) {
        const removedChunk = buffers.wake.shift();
        if (!removedChunk) break;
        totalBytes -= removedChunk.length;
      }
    }

    if (state === "LISTENING") {
      buffers.command.push(chunk);
      commandBytes += chunk.length;
    }

    const frames = frameBuffer.addChunk(chunk);
    for (const frame of frames) {
      const samples = Int16Array.from({ length: frame.length / 2 }, (_, i) =>
        frame.readInt16LE(i * 2),
      );

      const result = vad.processFrame(samples);

      if (canDetectWakeWord() && result === VADEvent.VOICE) {
        idleSpeechDetected = true;
      }

      if (state === "LISTENING") {
        if (result === VADEvent.VOICE) {
          if (!vadVoiceDetected) listeningStart = Date.now();
          vadSilentFrames = 0;
          vadVoiceDetected = true;
        } else if (result === VADEvent.SILENCE) vadSilentFrames++;
      }
    }

    const vadSilenceElapsed =
      state === "LISTENING" &&
      vadVoiceDetected &&
      vadSilentFrames >= VAD_SILENCE_FRAMES;

    const maxListeningElapsed: boolean =
      listeningStart !== null &&
      Date.now() - listeningStart >= MAX_LISTENING_MS;

    const firstCommandTimeoutElapsed: boolean =
      state === "LISTENING" &&
      !vadVoiceDetected &&
      listeningStart !== null &&
      Date.now() - listeningStart >= FIRST_COMMAND_TIMEOUT_MS;

    if (firstCommandTimeoutElapsed) {
      resetListeningSession();
      console.log("First-command timeout: Returning to IDLE");
      return;
    }

    if (
      !silenceHandled &&
      (vadSilenceElapsed || maxListeningElapsed) &&
      state === "LISTENING"
    ) {
      console.log(
        maxListeningElapsed
          ? "Processing reason: MAX LISTENING TIME"
          : "Processing reason: VAD SILENCE DETECTED",
      );

      silenceHandled = true;
      state = "PROCESSING";
      console.log(state);
      processCommand().catch((error) =>
        console.error("Command processing failed:", error),
      );
    }
  });

  const checkWakeWord = async (): Promise<void> => {
    if (
      isTranscribing ||
      !canDetectWakeWord() ||
      !buffers.wake.length ||
      Date.now() < cooldownUntil
    ) {
      return;
    }

    if (!idleSpeechDetected) return;

    idleSpeechDetected = false;
    isTranscribing = true;
    const checkSessionId = sessionId;
    buffers.pending.length = 0;
    pendingBytes = 0;

    try {
      const pcmBuffer = Buffer.concat(buffers.wake);
      const wavBuffer = createWavBuffer(pcmBuffer);
      await writeFile("wakeSnapshot.wav", wavBuffer);
      const transcription = await transcribeAudio("wakeSnapshot.wav");
      const cleanedWakeTranscription = removeWakeWord(transcription);
      const wakeContainsCommand = cleanedWakeTranscription.length > 0;

      if (
        containsWakeWord(transcription, state === "SPEAKING") &&
        canDetectWakeWord() &&
        !isShuttingDown &&
        checkSessionId === sessionId
      ) {
        if (state === "SPEAKING") {
          sessionId++;
          stopKokoroPlayback();
          buffers.command.length = 0;
          commandBytes = 0;
        }

        buffers.command.push(pcmBuffer);
        buffers.command.push(...buffers.pending);
        commandBytes = Buffer.concat(buffers.command).length;
        buffers.wake.length = 0;
        totalBytes = 0;

        state = "LISTENING";
        listeningStart = Date.now();
        console.log("Wake word detected! JARVIS is now listening...");
        silenceHandled = false;
        vadSilentFrames = 0;
        vadVoiceDetected = wakeContainsCommand;
      }
      console.log(`Whisper heard: ${transcription}`);
    } finally {
      try {
        await unlink("wakeSnapshot.wav");
      } catch (error) {
        console.error("Unable to delete wakeSnapshot.wav:", error);
      }
      isTranscribing = false;
    }
  };

  const resetListeningSession = (): void => {
    sessionId++;
    resetAudioBuffers(buffers);
    commandBytes = 0;
    totalBytes = 0;
    pendingBytes = 0;
    silenceHandled = false;
    listeningStart = null;
    state = "IDLE";
    cooldownUntil = Date.now() + SPEECH_COOLDOWN_MS;
    vadSilentFrames = 0;
    vadVoiceDetected = false;
    idleSpeechDetected = false;
  };

  const processCommand = async (): Promise<void> => {
    const commandSessionId = sessionId;
    const commandFile = `command-${commandSessionId}.wav`;

    try {
      const pcmBuffer = Buffer.concat(buffers.command);
      const wavBuffer = createWavBuffer(pcmBuffer);
      await writeFile(commandFile, wavBuffer);
      const transcription = await transcribeAudio(commandFile);

      const cleanedTranscription = removeWakeWord(transcription);
      if (cleanedTranscription.length === 0) {
        console.log("No valid command detected");
        return;
      }
      console.log("Cleaned command:", cleanedTranscription);

      const normalizedCommand = cleanedTranscription
        .trim()
        .toLowerCase()
        .replace(/[.!?]+$/, "");
      if (normalizedCommand === "stop") return;

      await memoryUpdateQueue;

      const classification = await classifyIntent(
        cleanedTranscription,
        lastCommand,
        savedMemory.facts.map((fact) => fact.key),
      );
      if (commandSessionId !== sessionId) return;

      if (classification.status === "COMMAND") {
        state = "SPEAKING";
        console.log("JARVIS is speaking...");

        let commandResponse: string;
        if (classification.command === "CLEAR_HISTORY") {
          commandResponse = (await clearConversationHistory())
            ? "Your current and saved conversation history have been cleared, Sir."
            : "I've cleared this session's conversation history, but I couldn't confirm clearing the saved history, Sir.";
        } else
          commandResponse = await executeLocalCommand(classification.command);

        if (commandSessionId !== sessionId) return;

        if (classification.command !== "CLEAR_HISTORY")
          lastCommand = classification.command;

        console.log(`J.A.R.V.I.S.: ${commandResponse}`);
        await speak(commandResponse);
      } else if (classification.status === "MEMORY") {
        state = "SPEAKING";
        console.log("JARVIS is speaking...");

        const commandResponse = await executeMemoryCommand(
          classification.command,
        );

        if (commandSessionId !== sessionId || isShuttingDown) return;

        lastCommand = null;

        console.log(`J.A.R.V.I.S.: ${commandResponse}`);
        await speak(commandResponse);
      } else if (classification.status === "NONE") {
        if (commandSessionId === sessionId) lastCommand = null;

        const completedTurn = await processMessage(
          cleanedTranscription,
          conversationHistory,
          () => {
            if (commandSessionId !== sessionId) return false;

            state = "SPEAKING";
            console.log("JARVIS is speaking...");
            return true;
          },
          () => {
            return commandSessionId === sessionId && !isShuttingDown;
          },
          [...savedMemory.facts],
        );

        if (completedTurn !== null) {
          savedHistory.turns.push(completedTurn);
          await queueHistorySave();
        }
      } else {
        console.error("JARVIS could not classify the request.");
        state = "SPEAKING";
        const errorResponse =
          "I'm sorry, Sir. I couldn't process that request. Please try again.";
        console.log("J.A.R.V.I.S.:", errorResponse);
        await speak(errorResponse);
      }
    } catch (error) {
      if (!isShuttingDown && commandSessionId === sessionId) {
        console.error("JARVIS command processing failed:", error);
        try {
          state = "SPEAKING";
          await speak(
            "Sir, I'm having trouble processing your request. Please try again",
          );
        } catch (speechError) {
          console.error("JARVIS speech failed:", speechError);
        }
      }
    } finally {
      try {
        await unlink(commandFile);
      } catch (error) {
        console.error(`Unable to delete ${commandFile}:`, error);
      }
      if (!isShuttingDown && commandSessionId === sessionId) {
        resetListeningSession();
        console.log("JARVIS is ready for another command");
      }
    }
  };

  const shutdownVoiceController = (error?: Error): void => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    sessionId++;

    clearInterval(wakeInterval);
    stopKokoroPlayback();
    rejectPendingNativePlayback(
      error ?? new Error("Voice controller is shutting down"),
    );
    configureNativePlayback(null);

    if (!child.killed && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }

    vad.destroy();

    shutdownKokoroWorker().catch((shutdownError: unknown) => {
      console.error("Failed to shut down Kokoro worker:", shutdownError);
    });

    if (error) {
      console.error("Voice controller stopped:", error);
      process.exitCode = 1;
    } else {
      console.log("Shutting down voice controller...");
    }
  };

  process.on("SIGINT", () => shutdownVoiceController());
  process.on("SIGTERM", () => shutdownVoiceController());

  const wakeInterval = setInterval(() => {
    if (isShuttingDown) return;
    checkWakeWord().catch((error) => {
      if (isShuttingDown) return;
      console.error("Wake-word check failed:", error);
    });
  }, 1000);

  child.on("error", (error) => {
    shutdownVoiceController(error);
  });

  child.on("close", (code, signal) => {
    console.log("Microphone process finished.");

    if (!isShuttingDown) {
      shutdownVoiceController(
        new Error(`Microphone exited: code ${code}, signal ${signal}`),
      );
    }
  });
};
