export type LocalCommand =
  | "GET_TIME"
  | "GET_DATE"
  | "OPEN_SAFARI"
  | "OPEN_CHROME"
  | "OPEN_VSCODE"
  | "OPEN_FINDER"
  | "GET_BATTERY"
  | "OPEN_STUDY_MUSIC"
  | "PAUSE_MUSIC"
  | "RESUME_MUSIC";

const LOCAL_COMMANDS = [
  "GET_TIME",
  "GET_DATE",
  "GET_BATTERY",
  "OPEN_SAFARI",
  "OPEN_CHROME",
  "OPEN_VSCODE",
  "OPEN_FINDER",
  "OPEN_STUDY_MUSIC",
  "PAUSE_MUSIC",
  "RESUME_MUSIC",
] as const;

export const isValidLocalCommand = (value: string): value is LocalCommand => {
  return (LOCAL_COMMANDS as readonly string[]).includes(value);
};

const hasNegation = (input: string): boolean => {
  return (
    input.includes("don't") ||
    input.includes("do not") ||
    input.includes("never")
  );
};

const isInformationalRequest = (input: string): boolean => {
  return (
    input.startsWith("explain") ||
    input.startsWith("how do i") ||
    input.startsWith("how to") ||
    input.startsWith("what happens if")
  );
};

export const getLocalCommand = (input: string): LocalCommand | null => {
  const cleanedInput = input
    .trim()
    .replace(/[.?!]+$/, "")
    .toLowerCase();

  if (isInformationalRequest(cleanedInput)) return null;

  if (cleanedInput === "what time is it") return "GET_TIME";
  if (cleanedInput === "what is today's date") return "GET_DATE";

  if (
    cleanedInput === "what's my battery percentage" ||
    cleanedInput === "what is my battery percentage" ||
    cleanedInput === "how much battery do i have"
  ) {
    return "GET_BATTERY";
  }

  if (
    (cleanedInput.includes("open") || cleanedInput.includes("launch")) &&
    cleanedInput.includes("safari") &&
    !hasNegation(cleanedInput)
  ) {
    return "OPEN_SAFARI";
  }

  if (
    (cleanedInput.includes("open") || cleanedInput.includes("launch")) &&
    cleanedInput.includes("chrome") &&
    !hasNegation(cleanedInput)
  ) {
    return "OPEN_CHROME";
  }

  if (
    (cleanedInput.includes("open") || cleanedInput.includes("launch")) &&
    (cleanedInput.includes("vs code") ||
      cleanedInput.includes("visual studio code")) &&
    !hasNegation(cleanedInput)
  ) {
    return "OPEN_VSCODE";
  }

  if (
    (cleanedInput.includes("open") || cleanedInput.includes("launch")) &&
    (cleanedInput.includes("finder") || cleanedInput.includes("files")) &&
    !hasNegation(cleanedInput)
  ) {
    return "OPEN_FINDER";
  }

  if (cleanedInput === "play my study music") return "OPEN_STUDY_MUSIC";

  return null;
};

export const isLocalCommand = (input: string): boolean => {
  return getLocalCommand(input) !== null;
};
