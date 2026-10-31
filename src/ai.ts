import ollama from "ollama";
import { speak } from "./speech.js";

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

export const processMessage = async (
  userInput: string,
  conversationHistory: Message[],
  onSpeaking?: () => void,
): Promise<void> => {
  conversationHistory.push({ role: "user", content: userInput });

  const response = await ollama.chat({
    model: "qwen3:1.7b",
    messages: conversationHistory,
  });

  conversationHistory.push({
    role: "assistant",
    content: response.message.content,
  });
  console.log(`J.A.R.V.I.S.: ${response.message.content}`);
  onSpeaking?.();
  await speak(response.message.content);
};
