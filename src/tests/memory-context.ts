import { test } from "node:test";
import assert from "node:assert/strict";
import { selectMemoryContextFacts } from "../memory/index.js";
import {
  buildMemoryContext,
  buildMemoryRetrievalText,
  isLearningRequest,
  scoreMemoryFact,
} from "../memory/context.js";

test("ranks stronger memory matches before weaker matches", () => {
  const facts = [
    { key: "rover_name", value: "My rover is named Rover" },
    { key: "test_rover", value: "I have a test rover" },
    { key: "code_editor", value: "I use VS Code for programming" },
  ];

  const result = selectMemoryContextFacts(facts, "Describe my test rover");

  const keys = result.map((fact) => fact.key);

  assert.deepEqual(keys, ["test_rover", "rover_name"]);
});

test("skips oversized facts and still selects smaller relevant facts", () => {
  const facts = [
    { key: "test_rover_description", value: "x".repeat(2100) },
    { key: "rover_name", value: "Copper Finch" },
  ];

  const result = selectMemoryContextFacts(facts, "Describe my test rover");

  const keys = result.map((fact) => fact.key);

  assert.deepEqual(keys, ["rover_name"]);
});

test("uses the previous subject without inheriting its teaching request", () => {
  const facts = [
    { key: "test_rover_color", value: "blue" },
    {
      key: "learning_preference",
      value: "attempt exercises before seeing solutions",
    },
  ];

  const result = selectMemoryContextFacts(
    facts,
    "What colour is it?",
    "Explain my test rover",
  );

  const keys = result.map((fact) => fact.key);

  assert.deepEqual(keys, ["test_rover_color"]);
});

test("does not inherit the previous subject for an unrelated request", () => {
  const facts = [
    { key: "test_rover_color", value: "blue" },
    { key: "learning_preference", value: "attempt exercises first" },
  ];

  const result = selectMemoryContextFacts(
    facts,
    "Help me understand TypeScript promises.",
    "Describe my test rover.",
  );

  assert.deepEqual(result.map((fact) => fact.key), ["learning_preference"]);
});

test("counts distinct meaningful words and preserves stored order for ties", () => {
  assert.equal(
    scoreMemoryFact({ key: "my_test_rover_rover", value: "example" }, "Describe my test rover"),
    2,
  );
  const facts = [
    { key: "rover_name", value: "Copper Finch" },
    { key: "rover_color", value: "blue" },
    { key: "test_rover", value: "prototype" },
  ];
  assert.deepEqual(
    selectMemoryContextFacts(facts, "Describe my test rover").map((fact) => fact.key),
    ["test_rover", "rover_name", "rover_color"],
  );
});

test("normalizes spelling in keys and requests without matching values", () => {
  assert.equal(scoreMemoryFact({ key: "favorite_color", value: "blue" }, "favourite colour"), 2);
  assert.equal(scoreMemoryFact({ key: "favourite_colour", value: "blue" }, "favorite color"), 2);
  assert.equal(scoreMemoryFact({ key: "code_editor", value: "favorite color" }, "favourite colour"), 0);
});

test("recognizes teaching phrases without partial-word matches", () => {
  for (const request of ["Explain closures", "Teach me promises", "Help me understand closures", "Walk me through promises"]) {
    assert.equal(isLearningRequest(request), true, request);
  }
  for (const request of ["My teacher likes blue", "Help me understanding", "Walk me throughout the park", "Help me launch my rover"]) {
    assert.equal(isLearningRequest(request), false, request);
  }
  assert.equal(
    scoreMemoryFact(
      { key: " Learning_Preference ", value: "practice first" },
      "What colour is it?",
      "Explain my test rover",
    ),
    0,
  );
});

test("looks beyond ten oversized candidates while selecting at most ten facts", () => {
  const oversized = Array.from({ length: 10 }, (_, index) => ({
    key: `test_rover_large_${index}`,
    value: "x".repeat(2100),
  }));
  const small = Array.from({ length: 12 }, (_, index) => ({
    key: `rover_fact_${index}`,
    value: "small",
  }));
  assert.deepEqual(
    selectMemoryContextFacts([...oversized, ...small], "Describe my test rover"),
    small.slice(0, 10),
  );
});

test("includes exact-budget JSON and skips a fact one character over budget", () => {
  const exact = { key: "rover", value: "x".repeat(1972) };
  assert.equal(JSON.stringify([exact]).length, 2000);
  assert.deepEqual(selectMemoryContextFacts([exact], "rover"), [exact]);

  const over = { ...exact, value: exact.value + "x" };
  const small = { key: "rover_name", value: "Copper Finch" };
  assert.deepEqual(selectMemoryContextFacts([over, small], "rover"), [small]);
});

test("packs remaining space and accounts for JSON escaping", () => {
  const large = { key: "rover_description", value: "x".repeat(1700) };
  const medium = { key: "rover_details", value: "x".repeat(500) };
  const small = { key: "rover_name", value: "Copper Finch" };
  assert.deepEqual(selectMemoryContextFacts([large, medium, small], "rover"), [large, small]);

  const escaped = { key: "rover_quote", value: '"'.repeat(1100) };
  assert.deepEqual(selectMemoryContextFacts([escaped, small], "rover"), [small]);
});

test("bounds previous context and ignores blank or unrelated context", () => {
  assert.equal(
    buildMemoryRetrievalText("Tell me more about it", "x".repeat(600)),
    "Tell me more about it " + "x".repeat(500),
  );
  for (const previous of [undefined, "", "   "]) {
    assert.equal(buildMemoryRetrievalText("What color is it?", previous), "What color is it?");
  }
  assert.equal(buildMemoryRetrievalText("Explain promises", "Describe my test rover"), "Explain promises");
  assert.equal(
    buildMemoryRetrievalText("Tell me more about Italy", "Describe my test rover"),
    "Tell me more about Italy",
  );
  assert.equal(
    scoreMemoryFact({ key: "test_rover", value: "example" }, "What about its name?", "x".repeat(500) + " test rover"),
    0,
  );
});

test("prioritizes the current question over ten earlier context-only matches", () => {
  const contextOnly = Array.from({ length: 10 }, (_, index) => ({
    key: `test_rover_detail_${index}`,
    value: "unrelated rover detail",
  }));
  const answer = { key: "rover_color", value: "blue" };

  const result = selectMemoryContextFacts(
    [...contextOnly, answer],
    "What color is it?",
    "Describe my test rover",
  );

  assert.equal(result.length, 10);
  assert.deepEqual(result[0], answer);
  assert.deepEqual(result.slice(1), contextOnly.slice(0, 9));
});

test("does not double-count current words or let inherited words outweigh them", () => {
  const current = "What color is it?";
  const previous = "Describe my test rover";
  assert.equal(scoreMemoryFact({ key: "color", value: "blue" }, current, previous), 1);
  assert.equal(scoreMemoryFact({ key: "rover_color", value: "blue" }, current, previous), 1.5);
  assert.equal(scoreMemoryFact({ key: "test_rover", value: "example" }, current, previous), 2 / 3);

  const manyWords = Array.from({ length: 40 }, (_, index) => `word${index}`).join(" ");
  const inheritedScore = scoreMemoryFact(
    { key: manyWords.replaceAll(" ", "_"), value: "example" },
    current,
    manyWords,
  );
  assert.ok(inheritedScore > 0 && inheritedScore < 1);
});

test("returns no context for empty or wholly unusable facts", () => {
  assert.equal(buildMemoryContext([], "rover"), undefined);
  assert.equal(buildMemoryContext([{ key: "code_editor", value: "example" }], "rover"), undefined);
  assert.equal(buildMemoryContext([{ key: "test_rover", value: "x".repeat(2100) }], "rover"), undefined);
});

test("does not mutate facts while ranking, normalizing, and packing", () => {
  const input = [
    Object.freeze({ key: "favourite_colour", value: "Blue" }),
    Object.freeze({ key: "favorite_color_notes", value: "x".repeat(2100) }),
    Object.freeze({ key: "favorite", value: "example" }),
  ];
  const before = structuredClone(input);
  const result = selectMemoryContextFacts(input, "Describe my favorite color");

  assert.deepEqual(result.map((fact) => fact.key), ["favourite_colour", "favorite"]);
  assert.deepEqual(input, before);
});
