import { parentPort } from "node:worker_threads";
import { KokoroTTS } from "kokoro-js";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";

let ttsPromise: Promise<KokoroTTS> | null = null;

let isShuttingDown: boolean = false;
let activeGenerations: number = 0;

const canShutdown = (): boolean => {
  return isShuttingDown && activeGenerations === 0;
};

const finishShutdown = (): void => {
  if (canShutdown()) parentPort?.close();
};

parentPort?.on("message", async (message) => {
  if (message.type === "shutdown") {
    isShuttingDown = true;
    finishShutdown();
    return;
  }

  if (message.type === "generate" && !isShuttingDown) {
    const text = message.text;
    if (typeof text !== "string") return;

    const requestId = message.requestId;
    if (typeof requestId !== "number") return;

    activeGenerations++;

    if (ttsPromise === null) {
      ttsPromise = KokoroTTS.from_pretrained(
        "onnx-community/Kokoro-82M-v1.0-ONNX",
        {
          dtype: "q8",
          device: "cpu",
        },
      );
    }

    let tts: KokoroTTS;

    try {
      tts = await ttsPromise;
    } catch (error) {
      console.error(error);
      ttsPromise = null;

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      parentPort?.postMessage({
        type: "error",
        requestId,
        message: errorMessage,
      });

      activeGenerations--;
      finishShutdown();

      return;
    }

    try {
      const audio = await tts.generate(text, {
        voice: "bm_daniel",
        speed: 1.0,
      });

      if (isShuttingDown) return;

      const output = `jarvisSpeech-${randomUUID()}.wav`;
      await audio.save(output);

      if (isShuttingDown) {
        try {
          await unlink(output);
        } catch (error) {
          console.error("Failed to delete Kokoro audio:", error);
        }

        return;
      }

      parentPort?.postMessage({ type: "generated", requestId, output });
    } catch (error) {
      console.error(error);

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      parentPort?.postMessage({
        type: "error",
        requestId,
        message: errorMessage,
      });
    } finally {
      activeGenerations--;
      finishShutdown();
    }
  }
});
