import { startVoiceController } from "./voice/controller.js";
import { shutdownKokoroWorker } from "./tts/kokoro.js";
import { loadEnvFile } from "node:process";

loadEnvFile(".env");

const main = async (): Promise<void> => {
  console.log("Initializing J.A.R.V.I.S...");
  await startVoiceController();
};

main().catch(async (error: unknown) => {
  console.error("JARVIS failed:", error);
  process.exitCode = 1;

  try {
    await shutdownKokoroWorker();
  } catch (shutdownError: unknown) {
    console.error("Startup cleanup failed:", shutdownError);
  }
});
