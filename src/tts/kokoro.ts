import { execFile, type ChildProcess } from "node:child_process";
import { unlink } from "node:fs/promises";
import { chunkText } from "./chunkText.js";
import { Worker } from "node:worker_threads";

let activePlayback: ChildProcess | null = null;
let interruptPlayback: (() => void) | null = null;
let speechSession = 0;

const kokoroWorker = new Worker(
  new URL("../../dist/tts/kokoroWorker.js", import.meta.url),
);

kokoroWorker.on("message", (message) => {
  if (message.type === "generated") {
    const pending = pendingRequests.get(message.requestId);
    if (pending) {
      pending.resolve(message.output);
      pendingRequests.delete(message.requestId);
    } else {
      console.warn("Orphaned Kokoro WAV file:", message.output);
      unlink(message.output).catch((error) =>
        console.error("Failed to delete orphaned Kokoro WAV:", error),
      );
    }
  }

  if (message.type === "error") {
    const pending = pendingRequests.get(message.requestId);
    if (pending) {
      pending.reject(new Error(message.message));
      pendingRequests.delete(message.requestId);
    }
  }
});

kokoroWorker.on("error", (error) => {
  console.error(error);

  workerAvailable = false;

  for (const request of pendingRequests.values()) {
    request.reject(error instanceof Error ? error : new Error(String(error)));
  }

  pendingRequests.clear();
});

kokoroWorker.on("exit", (exitCode) => {
  if (exitCode === 0) console.log("Kokoro worker stopped.");
  else console.error("Kokoro worker exited with code:", exitCode);

  workerAvailable = false;
  workerExited = true;

  const error = new Error(`Worker exited with code: ${exitCode}`);
  for (const request of pendingRequests.values()) {
    request.reject(error);
  }

  pendingRequests.clear();
});

let workerAvailable: boolean = true;
let workerExited: boolean = false;

let nextRequestId: number = 0;

type PendingRequest = {
  resolve: (output: string) => void;
  reject: (error: Error) => void;
};
const pendingRequests = new Map<number, PendingRequest>();

const generateWorkerAudio = async (text: string): Promise<string> => {
  if (!workerAvailable) throw new Error("Kokoro worker is unavailable");

  const requestId = ++nextRequestId;

  return new Promise<string>((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });

    try {
      kokoroWorker.postMessage({ type: "generate", requestId, text });
    } catch (error) {
      pendingRequests.delete(requestId);
      throw error;
    }
  });
};

export const kokoroSpeech = async (text: string): Promise<void> => {
  const currentSession = ++speechSession;

  const chunks = chunkText(text);
  for (const chunk of chunks) {
    if (currentSession !== speechSession) return;
    console.log("Processing chunk:", chunk);

    const output = await generateWorkerAudio(chunk);

    if (currentSession !== speechSession) {
      try {
        await unlink(output);
      } catch (error) {
        console.error("Failed to delete Kokoro audio:", error);
      }

      return;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        let wasInterrupted = false;

        const child = execFile("afplay", [output]);
        activePlayback = child;

        interruptPlayback = () => {
          wasInterrupted = true;
          child.kill("SIGTERM");
        };

        child.on("close", (code, signal) => {
          if (activePlayback === child) {
            activePlayback = null;
            interruptPlayback = null;
          }

          if (wasInterrupted || signal === "SIGINT") resolve();
          else if (code === 0) resolve();
          else
            reject(
              new Error(`afplay exited with code ${code}, signal ${signal}`),
            );
        });

        child.on("error", (error) => {
          if (activePlayback === child) {
            activePlayback = null;
            interruptPlayback = null;
          }

          if (wasInterrupted) resolve();
          else reject(error);
        });
      });
    } finally {
      try {
        await unlink(output);
      } catch (error) {
        console.error("Failed to delete Kokoro audio:", error);
      }
    }
  }
};

export const stopKokoroPlayback = (): void => {
  speechSession++;
  interruptPlayback?.();
};

export const shutdownKokoroWorker = async (): Promise<void> => {
  if (workerExited) return;

  workerAvailable = false;

  for (const request of pendingRequests.values()) {
    request.reject(new Error("Kokoro worker is shutting down"));
  }

  pendingRequests.clear();

  await new Promise<void>((resolve, reject) => {
    const shutdownTimeout = setTimeout(() => {
      console.warn("Kokoro worker shutdown timed out.");

      kokoroWorker.removeListener("error", onShutdownError);
      kokoroWorker.removeListener("exit", onShutdownExit);

      reject(new Error("Kokoro worker failed to shut down within 10 seconds"));
    }, 10000);

    const onShutdownError = (error: Error): void => {
      clearTimeout(shutdownTimeout);
      kokoroWorker.removeListener("exit", onShutdownExit);
      reject(error);
    };

    const onShutdownExit = (): void => {
      clearTimeout(shutdownTimeout);
      kokoroWorker.removeListener("error", onShutdownError);
      resolve();
    };

    kokoroWorker.once("error", onShutdownError);
    kokoroWorker.once("exit", onShutdownExit);

    try {
      kokoroWorker.postMessage({ type: "shutdown" });
    } catch (error) {
      clearTimeout(shutdownTimeout);
      kokoroWorker.removeListener("error", onShutdownError);
      kokoroWorker.removeListener("exit", onShutdownExit);
      reject(error);
    }
  });
};
