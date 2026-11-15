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
