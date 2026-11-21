import { normalizeMemoryKey, type MemoryFact, isMemoryFact } from "./index.js";

export const findMemoryFact = (
  facts: MemoryFact[],
  searchKey: string,
): MemoryFact | undefined => {
  const normalizedKey = normalizeMemoryKey(searchKey);
  const fact = facts.find((fact) => {
    return normalizeMemoryKey(fact.key) === normalizedKey;
  });

  return fact;
};

export const upsertMemoryFact = (
  facts: MemoryFact[],
  fact: MemoryFact,
): MemoryFact[] => {
  if (!isMemoryFact(fact))
    throw new Error(
      "Cannot remember an invalid fact. Key and value must be non-empty strings.",
    );

  const normalizedKey = normalizeMemoryKey(fact.key);
  const copyFacts = [...facts];
  const index = copyFacts.findIndex((existingFact) => {
    return normalizeMemoryKey(existingFact.key) === normalizedKey;
  });

  const newFact: MemoryFact = { key: normalizedKey, value: fact.value };

  if (index !== -1) copyFacts[index] = newFact;
  else copyFacts.push(newFact);

  return copyFacts;
};

export const removeMemoryFact = (
  facts: MemoryFact[],
  searchKey: string,
): MemoryFact[] => {
  const normalizedKey = normalizeMemoryKey(searchKey);

  const newFacts = facts.filter((fact) => {
    return normalizeMemoryKey(fact.key) !== normalizedKey;
  });

  return newFacts;
};
