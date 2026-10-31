import { startVoiceController } from "./voiceController.js";

const main = async (): Promise<void> => {
  console.log("Initializing J.A.R.V.I.S...");
  await startVoiceController();
};

main().catch((error) => {
  console.error("JARVIS failed:", error);
  process.exitCode = 1;
});
