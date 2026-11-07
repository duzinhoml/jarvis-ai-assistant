import { startMicrophone, type ListeningState } from "./microphone.js";
import { createWavBuffer, systemPrompt } from "./utils/index.js";
import { createAudioBuffers, resetAudioBuffers } from "./audioBuffer.js";
import { writeFile, unlink } from "node:fs/promises";
import { transcribeAudio } from "./transcription.js";
import { containsWakeWord } from "./wakeWord.js";
import { processMessage } from "./ai.js";
import { speak } from "./speech.js";
import { executeLocalCommand, classifyIntent } from "./commands/index.js";
import VADBuilder, { VADMode, VADEvent } from "@ozymandiasthegreat/vad";
import { AudioFrameBuffer } from "./audio/frameBuffer.js";
import { stopKokoroPlayback } from "./tts/kokoro.js";

export const startVoiceController = async (): Promise<void> => {
  const child = startMicrophone();

  type Message = {
    role: "user" | "assistant" | "system";
    content: string;
  };

  const conversationHistory: Message[] = [
    { role: "system", content: systemPrompt },
  ];

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

  const VAD = await VADBuilder();
  const vad = new VAD(VADMode.VERY_AGGRESSIVE, 16000);
  const frameBuffer = new AudioFrameBuffer();
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
      const cleanedWakeTranscription = transcription
        .replace(/^jarvis\b[,.!?]*\s*/i, "")
        .trim();
      const wakeContainsCommand = cleanedWakeTranscription.length > 0;

      if (
        containsWakeWord(transcription) &&
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

    try {
      const pcmBuffer = Buffer.concat(buffers.command);
      const wavBuffer = createWavBuffer(pcmBuffer);
      await writeFile("command.wav", wavBuffer);
      const transcription = await transcribeAudio("command.wav");

      const cleanedTranscription = transcription
        .replace(/^jarvis\b[,.!?]*\s*/i, "")
        .trim();
      if (cleanedTranscription.length === 0) {
        console.log("No valid command detected");
        return;
      }
      console.log("Cleaned command:", cleanedTranscription);
      const classification = await classifyIntent(cleanedTranscription);

      if (classification.status === "COMMAND") {
        state = "SPEAKING";
        console.log("JARVIS is speaking...");
        const commandResponse = await executeLocalCommand(
          classification.command,
        );
        console.log(`J.A.R.V.I.S.: ${commandResponse}`);
        await speak(commandResponse);
      } else if (classification.status === "NONE") {
        await processMessage(cleanedTranscription, conversationHistory, () => {
          state = "SPEAKING";
          console.log("JARVIS is speaking...");
        });
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
        await unlink("command.wav");
      } catch (error) {
        console.error("Unable to delete command.wav:", error);
      }
      if (!isShuttingDown && commandSessionId === sessionId) {
        resetListeningSession();
        console.log("JARVIS is ready for another command");
      }
    }
  };

  process.on("SIGINT", () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    clearInterval(wakeInterval);

    console.log("Shutting down voice controller...");

    child.kill("SIGTERM");
  });

  const wakeInterval = setInterval(() => {
    if (isShuttingDown) return;
    checkWakeWord().catch((error) => {
      if (isShuttingDown) return;
      console.error("Wake-word check failed:", error);
    });
  }, 1000);

  child.on("error", (error) => {
    isShuttingDown = true;
    clearInterval(wakeInterval);
    console.error("Microphone process failed:", error);
  });

  child.on("close", () => {
    isShuttingDown = true;
    clearInterval(wakeInterval);
    vad.destroy();
    console.log("Microphone process finished.");
  });
};
