import { processMessage } from "./ai.js";
import { systemPrompt } from "./prompt.js";
import {
  loadConversationHistory,
  saveConversationHistory,
  type ConversationTurn,
  type ConversationHistoryFile,
  MAX_CONTEXT_TURNS,
  MAX_CONTEXT_CHARACTERS,
  selectRecentTurns,
  countTurnCharacters,
} from "./history.js";

export {
  processMessage,
  systemPrompt,
  loadConversationHistory,
  saveConversationHistory,
  type ConversationTurn,
  type ConversationHistoryFile,
  MAX_CONTEXT_TURNS,
  MAX_CONTEXT_CHARACTERS,
  selectRecentTurns,
  countTurnCharacters,
};
