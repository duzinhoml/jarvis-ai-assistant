import { classifyIntent, type LocalCommand } from "./commands/index.js";

type ExpectedResult = LocalCommand | "NONE";

interface TestCase {
  input: string;
  expected: ExpectedResult;
}

const testCases: TestCase[] = [
  // Valid PAUSE_MUSIC commands
  {
    input: "Jarvis, pause Apple Music.",
    expected: "PAUSE_MUSIC",
  },
  {
    input: "Could you pause playback in the Music app?",
    expected: "PAUSE_MUSIC",
  },
  {
    input: "Stop the song for a moment in Apple Music.",
    expected: "PAUSE_MUSIC",
  },
  {
    input: "Please pause the Music application.",
    expected: "PAUSE_MUSIC",
  },

  // Valid RESUME_MUSIC commands
  {
    input: "Jarvis, resume Apple Music.",
    expected: "RESUME_MUSIC",
  },
  {
    input: "Could you resume playback in the Music app?",
    expected: "RESUME_MUSIC",
  },
  {
    input: "Continue playing in Apple Music.",
    expected: "RESUME_MUSIC",
  },
  {
    input: "Please unpause the Music application.",
    expected: "RESUME_MUSIC",
  },
  {
    input: "Resume playback in the macOS Music app.",
    expected: "RESUME_MUSIC",
  },

  // Ambiguous playback requests
  {
    input: "Pause the music.",
    expected: "NONE",
  },
  {
    input: "Resume the music.",
    expected: "NONE",
  },
  {
    input: "Can you resume the music?",
    expected: "NONE",
  },
  {
    input: "Play some music.",
    expected: "NONE",
  },
  {
    input: "Continue playback.",
    expected: "NONE",
  },

  // Negated requests
  {
    input: "Don't pause Apple Music.",
    expected: "NONE",
  },
  {
    input: "Don't resume Apple Music.",
    expected: "NONE",
  },
  {
    input: "Keep Apple Music paused.",
    expected: "NONE",
  },
  {
    input: "Please don't unpause the Music app.",
    expected: "NONE",
  },

  // Hypothetical and informational requests
  {
    input: "What happens if I pause Apple Music?",
    expected: "NONE",
  },
  {
    input: "How do I resume music on my Mac?",
    expected: "NONE",
  },
  {
    input: "Explain how Apple Music playback works.",
    expected: "NONE",
  },

  // Unsupported media players
  {
    input: "Pause my YouTube video.",
    expected: "NONE",
  },
  {
    input: "Pause Spotify.",
    expected: "NONE",
  },
  {
    input: "Pause the video in Chrome.",
    expected: "NONE",
  },
  {
    input: "Resume Spotify.",
    expected: "NONE",
  },
  {
    input: "Continue playing my YouTube video.",
    expected: "NONE",
  },
  {
    input: "Unpause the video in Chrome.",
    expected: "NONE",
  },

  // Existing commands should still work
  {
    input: "Open Safari.",
    expected: "OPEN_SAFARI",
  },
  {
    input: "What's my battery percentage?",
    expected: "GET_BATTERY",
  },
  {
    input: "What time is it?",
    expected: "GET_TIME",
  },
  {
    input: "What's today's date?",
    expected: "GET_DATE",
  },
  {
    input: "Open Finder.",
    expected: "OPEN_FINDER",
  },
  {
    input: "Open Visual Studio Code.",
    expected: "OPEN_VSCODE",
  },
  {
    input: "Open Google Chrome.",
    expected: "OPEN_CHROME",
  },
  {
    input: "Play my study music.",
    expected: "OPEN_STUDY_MUSIC",
  },
  {
    input: "Don't open Chrome.",
    expected: "NONE",
  },
];

const testClassifier = async (): Promise<void> => {
  let passed = 0;
  let failed = 0;
  let errors = 0;

  console.log("\nJ.A.R.V.I.S. — Intent Classification Tests\n");

  for (const [index, test] of testCases.entries()) {
    const result = await classifyIntent(test.input);

    const actual = result.status === "COMMAND" ? result.command : result.status;

    const success = actual === test.expected;

    if (success) {
      passed++;
    } else {
      failed++;
    }

    if (result.status === "ERROR") {
      errors++;
    }

    console.log(`${success ? "PASS" : "FAIL"} | Test ${index + 1}`);
    console.log(`Input:    ${test.input}`);
    console.log(`Expected: ${test.expected}`);
    console.log(`Actual:   ${actual}`);
    console.log("------------------------------");
  }

  console.log("\nTEST SUMMARY");
  console.log(`Total:  ${testCases.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Errors: ${errors}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
};

testClassifier().catch((error) => {
  console.error("Classifier test runner failed:", error);
  process.exitCode = 1;
});
