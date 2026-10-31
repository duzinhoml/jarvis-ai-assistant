import type { LocalCommand } from "./router.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const openApplication = async (appName: string): Promise<string> => {
  try {
    await execFileAsync("open", ["-a", appName]);
    return `Opening ${appName}, Sir.`;
  } catch (error) {
    console.error(`Failed to open ${appName}:`, error);
    return `Sir, I couldn't open ${appName}.`;
  }
};

export const executeLocalCommand = async (
  command: LocalCommand,
): Promise<string> => {
  if (command === "GET_TIME") {
    const currentTime = new Date().toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `Sir, the current time is ${currentTime}`;
  }

  if (command === "GET_DATE") {
    const currentDate = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    return `Sir, today is ${currentDate}.`;
  }

  if (command === "GET_BATTERY") {
    try {
      const { stdout } = await execFileAsync("pmset", ["-g", "batt"]);
      const match = stdout.match(/\d+%/);
      if (match === null) {
        return "Sir, I couldn't determine your battery percentage.";
      }

      if (stdout.includes("discharging")) {
        return `Sir, your battery is at ${match[0]}, and you're running on battery power.`;
      } else if (stdout.includes("charging")) {
        return `Sir, your battery is at ${match[0]}, and your MacBook is charging.`;
      }

      return `Sir, your MacBook's battery is currently at ${match[0]}.`;
    } catch (error) {
      console.error("Failed to retrieve battery information:", error);
      return "Sir, I encountered an issue retrieving your battery information.";
    }
  }

  if (command === "OPEN_SAFARI") {
    return openApplication("Safari");
  }

  if (command === "OPEN_CHROME") {
    return openApplication("Google Chrome");
  }

  if (command === "OPEN_VSCODE") {
    return openApplication("Visual Studio Code");
  }

  if (command === "OPEN_FINDER") {
    return openApplication("Finder");
  }

  if (command === "OPEN_STUDY_MUSIC") {
    await execFileAsync("open", [
      "-a",
      "Google Chrome",
      "https://www.youtube.com/watch?v=606RfUUgzx4&list=PLTjaZUE_brhE&index=2",
    ]);

    return "Playing your study music, Sir.";
  }

  if (command === "PAUSE_MUSIC") {
    try {
      await execFileAsync("osascript", [
        "-e",
        'tell application "Music" to pause',
      ]);
      return "Playback paused, Sir.";
    } catch (error) {
      console.error("Failed to pause music:", error);
      return "Sir, I was unable to pause your music.";
    }
  }

  if (command === "RESUME_MUSIC") {
    try {
      await execFileAsync("osascript", [
        "-e",
        'tell application "Music" to play',
      ]);
      return "Playback resumed, Sir.";
    } catch (error) {
      console.error("Failed to resume music:", error);
      return "Sir, I was unable to resume your music.";
    }
  }

  return "Unsupported local command.";
};
