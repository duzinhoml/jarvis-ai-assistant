export const containsWakeWord = (transcription: string): boolean => {
  return transcription.trim().toLowerCase().includes("jarvis");
};
