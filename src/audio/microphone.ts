import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type ListeningState = "IDLE" | "LISTENING" | "PROCESSING" | "SPEAKING";
export type NativePlaybackCommand =
  | { type: "play"; id: number; path: string }
  | { type: "stop"; id: number };
export type NativePlaybackEvent =
  | { type: "playbackFinished"; id: number }
  | { type: "playbackStopped"; id: number }
  | { type: "playbackError"; id: number; message: string };

export const isNativePlaybackEvent = (
  value: unknown,
): value is NativePlaybackEvent => {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || !Number.isSafeInteger(value.id)) return false;
  if (!("type" in value)) return false;

  if (value.type === "playbackFinished" || value.type === "playbackStopped") {
    return true;
  }

  return (
    value.type === "playbackError" &&
    "message" in value &&
    typeof value.message === "string"
  );
};

export const sendNativePlaybackCommand = (
  child: ChildProcessWithoutNullStreams,
  command: NativePlaybackCommand,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    child.stdin.write(JSON.stringify(command) + "\n", (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
};

export const startMicrophone = (
  source: "sox" | "native" = "sox",
): ChildProcessWithoutNullStreams => {
  if (source === "native") return spawn("swift", ["native/audio/main.swift"]);

  const child = spawn("sox", [
    "-q",
    "-d",
    "-r",
    "16000",
    "-c",
    "1",
    "-b",
    "16",
    "-e",
    "signed-integer",
    "-L",
    "-t",
    "raw",
    "-",
  ]);
  return child;
};
