import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { kokoroSpeech } from "./tts/kokoro.js";

const execFileAsync = promisify(execFile);

export const speak = async (text: string): Promise<void> => {
  try {
    await kokoroSpeech(text);
  } catch (error) {
    const interrupted =
      error instanceof Error && "signal" in error && error.signal === "SIGINT";
    if (interrupted) return;

    console.error("Failed to run Kokoro:", error);
    await execFileAsync("say", [text]);
  }
};
