import ollama from "ollama";
import { speak } from "../tts/index.js";

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

export const processMessage = async (
  userInput: string,
  conversationHistory: Message[],
  onSpeaking?: () => boolean,
): Promise<void> => {
  const response = await ollama.chat({
    model: "qwen3:1.7b",
    messages: [...conversationHistory, { role: "user", content: userInput }],
  });

  if (onSpeaking?.() === false) return;

  conversationHistory.push({
    role: "user",
    content: userInput,
  });

  conversationHistory.push({
    role: "assistant",
    content: response.message.content,
  });

  console.log(`J.A.R.V.I.S.: ${response.message.content}`);
  await speak(response.message.content);
};
