import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type ListeningState = "IDLE" | "LISTENING" | "PROCESSING" | "SPEAKING";

export const startMicrophone = (): ChildProcessWithoutNullStreams => {
  const child = spawn("rec", [
    "-q",
    "-r",
    "16000",
    "-c",
    "1",
    "-b",
    "16",
    "-e",
    "signed-integer",
    "-t",
    "raw",
    "-",
  ]);
  return child;
};
