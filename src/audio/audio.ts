export const calculateRMS = (chunk: Buffer): number => {
  let sumOfSquares = 0;
  const sampleCount = Math.floor(chunk.length / 2);
  if (sampleCount === 0) return 0;

  for (let i = 0; i < sampleCount; ++i) {
    const sample = chunk.readInt16LE(i * 2);
    sumOfSquares += sample ** 2;
  }

  const avgSquaredSamples = sumOfSquares / sampleCount;
  return Math.sqrt(avgSquaredSamples);
};

export const isSpeechDetected = (rms: number, threshold: number): boolean => {
  return rms > threshold;
};

export const hasSilenceElapsed = (
  silenceStart: number,
  currentTime: number,
  durationMs: number,
): boolean => {
  const silenceDuration = currentTime - silenceStart;
  return silenceDuration >= durationMs;
};
