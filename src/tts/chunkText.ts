export const chunkText = (text: string): string[] => {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length);

  const chunks: string[] = [];
  let currentChunk: string = "";
  const maxLength = 200;

  for (const sentence of sentences) {
    if (sentence.length > maxLength) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = "";

      chunks.push(...wordChunkText(sentence, maxLength));
    } else {
      const totalLength =
        currentChunk.length + sentence.length + (currentChunk ? 1 : 0);

      if (totalLength > maxLength) {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = sentence;
      } else
        currentChunk = `${currentChunk ? currentChunk + " " : ""}${sentence}`;
    }
  }

  if (currentChunk.length) chunks.push(currentChunk);
  return chunks;
};

const wordChunkText = (sentence: string, maxLength: number): string[] => {
  const words = sentence.split(/\s+/);

  const chunks: string[] = [];
  let currentWordChunk = "";

  for (const word of words) {
    const totalLength =
      currentWordChunk.length + word.length + (currentWordChunk ? 1 : 0);

    if (word.length > maxLength) {
      if (currentWordChunk) chunks.push(currentWordChunk);
      currentWordChunk = "";

      for (let i = 0; i < word.length; i += maxLength) {
        chunks.push(word.slice(i, i + maxLength));
      }

      continue;
    }

    if (totalLength > maxLength) {
      if (currentWordChunk) chunks.push(currentWordChunk);
      currentWordChunk = word;
    } else {
      currentWordChunk = `${currentWordChunk ? currentWordChunk + " " : ""}${word}`;
    }
  }

  if (currentWordChunk) chunks.push(currentWordChunk);

  return chunks;
};
