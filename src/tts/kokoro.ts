import { KokoroTTS } from "kokoro-js";
import { execFile, type ChildProcess } from "node:child_process";
import { unlink } from "node:fs/promises";

let activePlayback: ChildProcess | null = null;
let interruptPlayback: (() => void) | null = null;

let ttsPromise: Promise<KokoroTTS> | null = null;

export const kokoroSpeech = async (text: string): Promise<void> => {
  if (ttsPromise === null) {
    console.log("Initializing Kokoro...");

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
    ttsPromise = null;
    throw error;
  }

  const audio = await tts.generate(text, {
    voice: "bm_daniel",
    speed: 1.0,
  });

  const output = "jarvisSpeech.wav";

  try {
    await audio.save(output);

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
};

export const stopKokoroPlayback = (): void => {
  interruptPlayback?.();
};
