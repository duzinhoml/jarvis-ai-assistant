export type MemoryFact = {
  key: string;
  value: string;
};

export type MemoryFile = {
  version: 1;
  facts: MemoryFact[];
};

export type MemoryCommand =
  | { action: "remember"; fact: MemoryFact }
  | { action: "recall"; key: string }
  | { action: "forget"; key: string }
  | { action: "list" };
