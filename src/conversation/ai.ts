import ollama from "ollama";
import { speak } from "../tts/index.js";
import {
  type ConversationTurn,
  MAX_CONTEXT_TURNS,
  MAX_CONTEXT_CHARACTERS,
} from "./index.js";

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

export const processMessage = async (
  userInput: string,
  conversationHistory: Message[],
  onSpeaking?: () => boolean,
  isSessionCurrent?: () => boolean,
): Promise<ConversationTurn | null> => {
  const response = await ollama.chat({
    model: "qwen3:1.7b",
    messages: [...conversationHistory, { role: "user", content: userInput }],
  });

  if (onSpeaking?.() === false) return null;

  console.log(`J.A.R.V.I.S.: ${response.message.content}`);
  const speechResult = await speak(response.message.content);

  if (!speechResult || isSessionCurrent?.() === false) return null;

  conversationHistory.push({
    role: "user",
    content: userInput,
  });

  conversationHistory.push({
    role: "assistant",
    content: response.message.content,
  });

  const excessMessages =
    conversationHistory.length - (1 + 2 * MAX_CONTEXT_TURNS);
  if (excessMessages > 0) conversationHistory.splice(1, excessMessages);

  let contextCharacterCount: number = 0;
  for (let i = 1; i < conversationHistory.length; ++i) {
    const message = conversationHistory[i];
    if (message) contextCharacterCount += message.content.length;
  }

  while (
    contextCharacterCount > MAX_CONTEXT_CHARACTERS &&
    conversationHistory.length > 1
  ) {
    const removedMessages = conversationHistory.splice(1, 2);

    for (const message of removedMessages) {
      contextCharacterCount -= message.content.length;
    }
  }

  return {
    userMessage: userInput,
    aiResponse: response.message.content,
    completionTimestamp: new Date().toISOString(),
  };
};
