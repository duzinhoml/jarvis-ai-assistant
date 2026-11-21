import { type MemoryFact, normalizeMemoryKey } from "./index.js";

export const MAX_MEMORY_CONTEXT_FACTS = 10;
export const MAX_MEMORY_CONTEXT_CHARACTERS = 2000;

export const selectMemoryContextFacts = (
  facts: MemoryFact[],
  request: string,
): MemoryFact[] => {
  const relevantFacts = facts.filter((fact) =>
    isMemoryFactRelevant(fact, request),
  );

  const selectedFacts = relevantFacts.slice(0, MAX_MEMORY_CONTEXT_FACTS);

  while (
    JSON.stringify(selectedFacts).length > MAX_MEMORY_CONTEXT_CHARACTERS &&
    selectedFacts.length
  ) {
    selectedFacts.pop();
  }

  return selectedFacts;
};

export const buildMemoryContext = (
  facts: MemoryFact[],
  request: string,
): string | undefined => {
  const selectedFacts = selectMemoryContextFacts(facts, request);
  if (!selectedFacts.length) return undefined;

  return JSON.stringify(selectedFacts);
};

export const tokenizeMemoryText = (input: string): string[] => {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length);
};

export const isMemoryFactRelevant = (
  fact: MemoryFact,
  request: string,
): boolean => {
  const tokenizedKey = tokenizeMemoryText(fact.key);
  const tokenizedRequest = tokenizeMemoryText(request);

  const ignoreTokens = [
    "a",
    "an",
    "and",
    "for",
    "in",
    "is",
    "my",
    "of",
    "the",
    "to",
    "with",
    "your",
  ];

  const normalizedKey = normalizeMemoryKey(fact.key);
  if (normalizedKey === "learning_preference")
    return isLearningRequest(request);

  return tokenizedKey.some((token) => {
    if (!ignoreTokens.includes(token)) {
      return tokenizedRequest.includes(token);
    }
  });
};

export const isLearningRequest = (request: string): boolean => {
  const tokens = tokenizeMemoryText(request);

  return tokens.includes("explain") || tokens.includes("teach");
};
