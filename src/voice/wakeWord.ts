export const containsWakeWord = (
  transcription: string,
  isSpeaking: boolean,
): boolean => {
  return isSpeaking
    ? /(?:(?:hey|hi)\s+)?jarvis\b(?!['’]s\b)/i.test(transcription.trim())
    : /^(?:(?:hey|hi)\s+)?jarvis\b(?!['’]s\b)/i.test(transcription.trim());
};

export const removeWakeWord = (transcription: string): string => {
  const matches = [
    ...transcription.matchAll(/(?:(?:hey|hi)\s+)?jarvis\b(?!['’]s\b)/gi),
  ];
  const lastMatch = matches.at(-1);
  if (!lastMatch) return transcription.trim();

  const cleanedTranscription = transcription.slice(lastMatch.index);

  return cleanedTranscription
    .replace(/^(?:(?:hey|hi)\s+)?jarvis\b(?!['’]s\b)[,.!?]*\s*/i, "")
    .trim();
};
