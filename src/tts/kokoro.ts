import { KokoroTTS } from "kokoro-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { unlink } from "node:fs/promises";

const execFileAsync = promisify(execFile);

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
    await execFileAsync("afplay", [output]);
  } finally {
    try {
      await unlink(output);
    } catch (error) {
      console.error("Failed to delete Kokoro audio:", error);
    }
  }
};
