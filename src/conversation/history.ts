import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ConversationTurn = {
  userMessage: string;
  aiResponse: string;
  completionTimestamp: string;
};

export type ConversationHistoryFile = {
  version: 1;
  turns: ConversationTurn[];
};

export const isConversationTurn = (
  value: unknown,
): value is ConversationTurn => {
  if (typeof value !== "object" || value === null) return false;

  if (
    !("userMessage" in value) ||
    !("aiResponse" in value) ||
    !("completionTimestamp" in value)
  )
    return false;

  if (
    typeof value.userMessage === "string" &&
    typeof value.aiResponse === "string" &&
    typeof value.completionTimestamp === "string"
  ) {
    const numericTime = Date.parse(value.completionTimestamp);

    if (Number.isFinite(numericTime)) return true;
  }

  return false;
};

export const isConversationHistoryFile = (
  value: unknown,
): value is ConversationHistoryFile => {
  if (typeof value !== "object" || value === null) return false;

  if (!("version" in value) || !("turns" in value)) return false;

  if (
    value.version === 1 &&
    Array.isArray(value.turns) &&
    value.turns.every(isConversationTurn)
  )
    return true;

  return false;
};

export const loadConversationHistory = async (
  filePath: string,
): Promise<ConversationHistoryFile> => {
  let file;

  try {
    file = await readFile(filePath, "utf-8");
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error) {
      if (error.code === "ENOENT") return { version: 1, turns: [] };
    }
    throw error;
  }

  const fileObj: unknown = JSON.parse(file);

  if (isConversationHistoryFile(fileObj)) return fileObj;
  else
    throw new Error(
      "Conversation history has an invalid format. Expected version 1 and an array of valid conversation turns.",
    );
};

export const saveConversationHistory = async (
  filePath: string,
  historyFile: ConversationHistoryFile,
): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });

  const stringHistory = JSON.stringify(historyFile);

  const tempFile = join(
    dirname(filePath),
    `conversationHistory-${randomUUID()}`,
  );

  try {
    await writeFile(tempFile, stringHistory);
    await rename(tempFile, filePath);
  } catch (error) {
    try {
      await unlink(tempFile);
    } finally {
      throw error;
    }
  }
};

export const MAX_CONTEXT_TURNS = 10;
export const MAX_CONTEXT_CHARACTERS = 6000;

export const selectRecentTurns = (
  turns: ConversationTurn[],
): ConversationTurn[] => {
  const recentTurns: ConversationTurn[] = turns.slice(-MAX_CONTEXT_TURNS);
  let characterCount: number = 0;

  for (const turn of recentTurns) {
    characterCount += countTurnCharacters(turn);
  }

  while (characterCount > MAX_CONTEXT_CHARACTERS && recentTurns.length) {
    const recentTurn = recentTurns.shift();
    if (recentTurn) characterCount -= countTurnCharacters(recentTurn);
  }

  return recentTurns;
};

export const countTurnCharacters = (turn: ConversationTurn): number => {
  const sumOfCharacters = turn.userMessage.length + turn.aiResponse.length;

  return sumOfCharacters;
};
