const sampleRate = 16000;
const channels = 1;
const bitsPerSample = 16;

const byteRate = sampleRate * channels * (bitsPerSample / 8);
const blockAlign = channels * (bitsPerSample / 8);

export const createWavBuffer = (pcmData: Buffer): Buffer => {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcmData.length, 40);

  const riffChunkSize = 36 + pcmData.length;
  header.writeUInt32LE(riffChunkSize, 4);

  return Buffer.concat([header, pcmData]);
};
