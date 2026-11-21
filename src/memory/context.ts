import { type MemoryFact, normalizeMemoryKey } from "./index.js";

export const MAX_MEMORY_CONTEXT_FACTS = 10;
export const MAX_MEMORY_CONTEXT_CHARACTERS = 2000;

export const selectMemoryContextFacts = (
  facts: MemoryFact[],
  request: string,
  previousRequest?: string,
): MemoryFact[] => {
  const scoredFacts = facts.map((fact) => {
    return { fact, score: scoreMemoryFact(fact, request, previousRequest) };
  });

  const relevantFacts = scoredFacts
    .filter((scoredFact) => {
      return scoredFact.score > 0;
    })
    .sort((a, b) => b.score - a.score)
    .map((scoredFact) => {
      return scoredFact.fact;
    });

  const selectedFacts: MemoryFact[] = [];

  for (const fact of relevantFacts) {
    if (selectedFacts.length >= MAX_MEMORY_CONTEXT_FACTS) break;

    const tempFacts = [...selectedFacts, fact];
    if (JSON.stringify(tempFacts).length <= MAX_MEMORY_CONTEXT_CHARACTERS)
      selectedFacts.push(fact);
  }

  return selectedFacts;
};

export const buildMemoryContext = (
  facts: MemoryFact[],
  request: string,
  previousRequest?: string,
): string | undefined => {
  const selectedFacts = selectMemoryContextFacts(
    facts,
    request,
    previousRequest,
  );
  if (!selectedFacts.length) return undefined;

  return JSON.stringify(selectedFacts);
};

export const tokenizeMemoryText = (input: string): string[] => {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length)
    .map((token) => normalizeMemoryToken(token));
};

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

export const isMemoryFactRelevant = (
  fact: MemoryFact,
  request: string,
): boolean => {
  const tokenizedKey = tokenizeMemoryText(fact.key);
  const tokenizedRequest = tokenizeMemoryText(request);

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
  const joinedTokens = ` ${tokens.join(" ")} `;

  return (
    tokens.includes("explain") ||
    tokens.includes("teach") ||
    joinedTokens.includes(" help me understand ") ||
    joinedTokens.includes(" walk me through ")
  );
};

export const scoreMemoryFact = (
  fact: MemoryFact,
  request: string,
  previousRequest?: string,
): number => {
  if (normalizeMemoryKey(fact.key) === "learning_preference")
    return isLearningRequest(request) ? 1 : 0;

  const retrievalText = buildMemoryRetrievalText(request, previousRequest);

  if (!isMemoryFactRelevant(fact, retrievalText)) return 0;

  const tokenizedKey = tokenizeMemoryText(fact.key);
  const tokenizedRequest = tokenizeMemoryText(request);
  const tokenizedRetrievalText = tokenizeMemoryText(retrievalText);

  let currentMatches: number = 0;
  let contextOnlyMatches: number = 0;
  const keyTokenSet = new Set(tokenizedKey);

  for (const keyToken of keyTokenSet) {
    if (ignoreTokens.includes(keyToken)) continue;

    if (tokenizedRequest.includes(keyToken)) currentMatches++;
    else if (tokenizedRetrievalText.includes(keyToken)) contextOnlyMatches++;
  }

  return currentMatches + contextOnlyMatches / (contextOnlyMatches + 1);
};

export const normalizeMemoryToken = (token: string): string => {
  if (token === "colour") token = "color";
  if (token === "favourite") token = "favorite";

  return token;
};

export const isMemoryFollowUpRequest = (request: string): boolean => {
  const tokenizedRequest = `${tokenizeMemoryText(request).join(" ")} `;

  const acceptedPrefixes = [
    "what color is it ",
    "what about its ",
    "how about its ",
    "tell me more about it ",
  ];

  if (
    acceptedPrefixes.some((prefix) => {
      return tokenizedRequest.startsWith(prefix);
    })
  )
    return true;

  return false;
};

export const buildMemoryRetrievalText = (
  request: string,
  previousRequest?: string,
): string => {
  if (isMemoryFollowUpRequest(request) && previousRequest?.trim().length) {
    return `${request} ${previousRequest.slice(0, 500)}`;
  }

  return request;
};
