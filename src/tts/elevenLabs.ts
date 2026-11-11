import fs from "node:fs";
import { loadEnvFile } from "node:process";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { execFile, type ChildProcess } from "node:child_process";

loadEnvFile(".env");

export const elevenLabs = async (input: string): Promise<void> => {
  if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID) {
    const client = new ElevenLabsClient({
      apiKey: process.env.ELEVENLABS_API_KEY,
    });
    const response = await client.textToSpeech.convert(
      process.env.ELEVENLABS_VOICE_ID,
      {
        modelId: "eleven_v4",
        text: input,
      },
    );

    const chunks: Uint8Array[] = [];
    for await (const chunk of response) {
      chunks.push(chunk);
    }

    fs.writeFileSync("elevenLabsSpeech.mp3", Buffer.concat(chunks));
    const child = execFile("afplay", ["elevenLabsSpeech.mp3"]);

    child.on("close", () => {
      console.log("Speech successfully completed.");
    });
  }
};

elevenLabs(
  "Allow me to introduce myself. I am Jarvis, a virtual artificial intelligence. Importing all preferences from home interface. Systems are now fully operational.",
);
