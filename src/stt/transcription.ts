import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const transcribeAudio = async (filePath: string): Promise<string> => {
  const { stdout } = await execFileAsync("whisper-cli", [
    "-m",
    "models/ggml-base.en.bin",
    "-f",
    filePath,
    "-nt",
    "-np",
  ]);
  return stdout.trim();
};
