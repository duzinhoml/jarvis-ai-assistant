import VADBuilder, { VADMode, VADEvent } from "@ozymandiasthegreat/vad";

const testVAD = async () => {
  const VAD = await VADBuilder();
  const vad = new VAD(VADMode.AGGRESSIVE, 16000);

  const silenceFrame = Buffer.alloc(960);

  const result = vad.processBuffer(silenceFrame);
  console.log(result);
  vad.destroy();
};

testVAD().catch((error) => {
  console.error("Error occured:", error);
});
