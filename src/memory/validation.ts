import {
  type MemoryCommand,
  type MemoryFact,
  type MemoryFile,
  normalizeMemoryKey,
} from "./index.js";

export const isMemoryFact = (v: unknown): v is MemoryFact => {
  if (typeof v !== "object" || v === null) return false;

  if (!("key" in v) || !("value" in v)) return false;
  if (typeof v.key === "string" && typeof v.value === "string") {
    if (v.key.trim().length === 0 || v.value.trim().length === 0) return false;

    return true;
  }

  return false;
};

export const isMemoryFile = (v: unknown): v is MemoryFile => {
  if (typeof v !== "object" || v === null) return false;

  if (!("version" in v) || !("facts" in v)) return false;

  if (
    v.version === 1 &&
    Array.isArray(v.facts) &&
    v.facts.every(isMemoryFact)
  ) {
    const encounteredKeys: Set<string> = new Set();
    for (const fact of v.facts) {
      const normalizedKey = normalizeMemoryKey(fact.key);

      if (encounteredKeys.has(normalizedKey)) return false;
      encounteredKeys.add(normalizedKey);
    }

    return true;
  }

  return false;
};

export const isMemoryCommand = (v: unknown): v is MemoryCommand => {
  if (typeof v !== "object" || v === null || !("action" in v)) return false;

  if (v.action === "remember") {
    if ("fact" in v) return isMemoryFact(v.fact);
  }

  if (v.action === "recall" || v.action === "forget") {
    return "key" in v && typeof v.key === "string" && v.key.trim().length > 0;
  }

  if (v.action === "list") return true;

  return false;
};
