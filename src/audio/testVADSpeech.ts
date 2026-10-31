import VADBuilder, { VADEvent, VADMode } from "@ozymandiasthegreat/vad";
import { AudioFrameBuffer } from "./frameBuffer.js";
import { startMicrophone } from "../microphone.js";
import { calculateRMS } from "../utils/audio.js";

const testVADSpeech = async () => {
  const VAD = await VADBuilder();
  const vad = new VAD(VADMode.VERY_AGGRESSIVE, 16000);

  const frameBuffer = new AudioFrameBuffer();

  let totalFrames = 0;
  let voiceFrames = 0;
  let lastVoiceFrame = -1;
  const voiceFramesPerSecond: number[] = [];
  let silentFrames = 0;
  let speechEnded = false;

  const microphone = startMicrophone();
  microphone.stdout.on("data", (chunk: Buffer) => {
    const frames = frameBuffer.addChunk(chunk);

    for (const frame of frames) {
      const rms = calculateRMS(frame);

      const samples = Int16Array.from({ length: frame.length / 2 }, (_, i) =>
        frame.readInt16LE(i * 2),
      );
      const result = vad.processFrame(samples);

      totalFrames++;
      const second = Math.floor(((totalFrames - 1) * 30) / 1000);

      if (result === VADEvent.VOICE) {
        console.log("VOICE DETECTED");
        console.log(rms);

        voiceFrames++;
        lastVoiceFrame = totalFrames;
        silentFrames = 0;

        voiceFramesPerSecond[second] = (voiceFramesPerSecond[second] ?? 0) + 1;
      } else if (result === VADEvent.SILENCE) {
        silentFrames++;
      } else if (result === VADEvent.ERROR) {
        console.error("VAD PROCESSING ERROR");
      }

      if (silentFrames >= 50 && voiceFrames > 0 && !speechEnded) {
        console.log("End of speech detected!");
        speechEnded = true;
        microphone.kill();
        break;
      }
    }
  });

  const timer = setTimeout(() => {
    microphone.kill();
    console.log("Stopping microphone...");
  }, 10000);

  microphone.on("close", () => {
    clearTimeout(timer);

    for (let i = 0; i < 10; ++i) {
      console.log(`Second ${i}: ${voiceFramesPerSecond[i] ?? 0} voice frames`);
    }

    const lastVoiceTime = lastVoiceFrame * 30;

    console.log("Total Frames:", totalFrames);
    console.log("Voice Frames:", voiceFrames);
    lastVoiceFrame === -1
      ? console.log("No speech detected")
      : console.log("Last Voice Detected:", lastVoiceTime / 1000, "seconds");

    vad.destroy();
    console.log("Microphone stopped. VAD cleaned up.");
  });
};

testVADSpeech().catch((error) => {
  console.error("Error occurred:", error);
});
