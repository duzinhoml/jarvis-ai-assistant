# JARVIS Voice Controller

**Source:** `src/voice/controller.ts`

## Overview

The voice controller manages JARVIS's voice interaction lifecycle, from receiving microphone audio to detecting the wake word, recording commands, and processing responses.

Its main responsibilities are:

- Receive continuous audio from the microphone.
- Detect speech using Voice Activity Detection (VAD).
- Recognize the "Jarvis" wake word using Whisper.
- Support barge-in by detecting the wake word and interrupting ongoing speech output.
- Preserve audio while asynchronous transcription is running.
- Record commands and determine when the user finishes speaking.
- Manage listening states, timeouts, and session resets.
- Coordinate native playback requests, completion events, and shutdown cleanup.
- Restore bounded conversation context and coordinate persistent-history saves and clearing.
- Execute explicit long-term memory commands through a separate validated fact store and update queue.
- Supply bounded relevant facts to conversational requests and coordinate OpenAI-first routing with local Ollama fallback.

---

## 1. Initialization and State

### Microphone Process

```ts
const VAD = await VADBuilder();
const vad = new VAD(VADMode.VERY_AGGRESSIVE, 16000);
const frameBuffer = new AudioFrameBuffer();

const microphoneSource =
  process.env.JARVIS_AUDIO_SOURCE === "sox" ? "sox" : "native";
const child = startMicrophone(microphoneSource);
```

VAD initializes before microphone startup so process handlers can be attached without an intervening asynchronous wait. Native capture is the default; `JARVIS_AUDIO_SOURCE=sox` selects the fallback. Both provide **16 kHz mono signed Int16 little-endian PCM** on stdout.

Starts the microphone as a **child process**, which continuously sends raw audio to Node.js through its standard output (`stdout`).

The microphone runs independently from the voice controller's asynchronous operations.

In native mode, `src/audio/microphone.ts` starts `swift native/audio/main.swift`. Swift captures 44.1 kHz Float32 audio through VoiceProcessingIO, moves samples through a preallocated ring buffer, and converts them outside the real-time callback. TypeScript continues to own VAD, wake-word detection, commands, and conversation state.

Wait for **“Voice processing enabled…”** before speaking. The initial “Initializing J.A.R.V.I.S...” message does not mean capture is ready. Run from the project root so relative source, model, and worker paths resolve correctly.

### Native Playback Configuration

```ts
configureNativePlayback(
  microphoneSource === "native"
    ? { play: playNativeAudio, stop: stopNativeAudio }
    : null,
);
```

Kokoro receives playback functions from the controller instead of managing the Swift child process directly. In native mode, Swift converts each generated WAV to 44.1 kHz mono Float32 and plays it through the same VoiceProcessingIO unit that captures the microphone. This provides a playback reference for echo processing. File loading and conversion remain outside the speaker callback.

Selecting SoX also selects the existing `afplay` playback path. It is a manual fallback, not an automatic restart or failover after native-process failure:

```sh
JARVIS_AUDIO_SOURCE=sox npx tsx src/main.ts
```

### Native Process Communication

| Stream | Contents |
| ------ | -------- |
| stdin | Newline-delimited JSON playback commands from TypeScript |
| stdout | Raw microphone PCM only |
| stderr | Diagnostic text and newline-delimited JSON playback events |

Commands use IDs to associate each response with its waiting playback request:

```json
{"type":"play","id":1,"path":"/absolute/path/to/speech.wav"}
{"type":"stop","id":1}
```

Swift responds with `playbackFinished`, `playbackStopped`, or `playbackError`. Each event contains the request ID; errors also include a `message`.

The controller uses `createInterface()` from `node:readline` because a pipe chunk may contain part of a line or several lines. Each line is parsed as JSON and checked with `isNativePlaybackEvent()`; ordinary diagnostics are displayed unchanged.

`playNativeAudio()` registers a Promise in `pendingNativePlayback` **before** sending PLAY. A finished or stopped event resolves that Promise; an error event rejects it. Both paths remove the request and clear its timers. Writing a command to stdin only confirms transmission, not playback completion. Kokoro waits for the playback Promise before deleting the temporary WAV or advancing to the next chunk.

### Conversation History

```ts
type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

const conversationHistory: Message[] = [
  { role: "system", content: systemPrompt },
];
```

Stores messages used by JARVIS's conversational AI. The startup code then appends the user and assistant messages from each turn selected by `selectRecentTurns(savedHistory.turns)`.

Each message contains:

- `role`: Who the message belongs to.
- `content`: The message text.

The history initially contains the current system prompt, followed by selected completed exchanges from earlier sessions. The controller passes it to `processMessage()` for conversational requests, but not to `executeLocalCommand()`.

### Persistent History and Model Context

`src/conversation/history.ts` defines a version-1 JSON document containing a `turns` array. Each turn contains string fields `userMessage`, `aiResponse`, and `completionTimestamp`; the timestamp must parse as a valid date. New turns use ISO timestamps. The system prompt is not persisted.

The controller loads `data/conversation-history.json` before VAD initialization and microphone startup. The loader returns empty version-1 history only for a missing file (`ENOENT`). Other read errors, malformed JSON, unsupported versions, and invalid turns propagate. The controller reports those failures, retains empty session history, and disables persistence for that session rather than overwriting the rejected file.

Two arrays serve different purposes:

| Value | Purpose |
| ----- | ------- |
| `savedHistory.turns` | Full archive of completed exchanges loaded or collected this session |
| `conversationHistory` | Current system prompt plus bounded recent messages supplied to the conversational provider |

`MAX_CONTEXT_TURNS` is **10**, and `MAX_CONTEXT_CHARACTERS` is **6,000**. Startup selection copies the newest ten turns and removes complete oldest turns until their combined user/assistant text fits the size budget. After each completed response, `processMessage()` applies the equivalent limits to the running message array while preserving the system message at index 0. A single oversized pair is omitted from future model context but remains available for persistence.

The size calculation uses JavaScript string `.length` (UTF-16 code units), not model tokens. The system prompt, message metadata, and current user request are outside the historical-text budget. The full archive is not truncated by model-context selection.

### Recording Completed Exchanges

`kokoroSpeech()` and `speak()` return a completion boolean. Expected interruption or unavailable speech returns `false`; unexpected failures still propagate, and successful `say` fallback returns `true`.

`processMessage()` waits for speech and checks the controller's session-validity callback before appending the user/assistant pair. It returns a `ConversationTurn` for a completed, current-session exchange, or `null` for a rejected, interrupted, or obsolete response. The controller appends non-null turns to `savedHistory.turns` and awaits `queueHistorySave()`.

Local-command responses, memory-command responses, and history-clear confirmations are not persisted as conversational turns. Conversation history does not automatically extract permanent facts or perform semantic retrieval over older exchanges.

### Save Queue and Session-Only Mode

`queueHistorySave()` copies the current turns array into a snapshot, then chains its save onto `historySaveQueue`. It checks `canPersistHistory` both when scheduling and when the queued operation starts. A save failure logs a warning, disables persistence, and is handled inside the callback so the queue does not remain rejected. Already queued operations then skip disk access.

The storage helper creates the parent directory, writes JSON to a unique temporary file in that directory, and renames the completed file over the destination. If writing or renaming fails, it attempts to remove the temporary file and rethrows the original save error. This is atomic replacement, not a power-loss durability guarantee or a lock between independent JARVIS processes.

Persistence defaults to enabled. Setting `JARVIS_HISTORY_ENABLED=false` skips loading and disables saving, including disk writes requested by the clear helper. The session still remembers completed exchanges in memory within the context limits. Start that mode from the project root:

```sh
JARVIS_HISTORY_ENABLED=false npx tsx src/main.ts
```

### Clearing History

`CLEAR_HISTORY` is an allowlisted command handled by the controller, which owns the history arrays and save queue. The classifier prompt requires an explicit affirmative request targeting conversation/chat history; negated, hypothetical, vague, and unrelated requests are instructed to return `NONE`.

The two helpers have different responsibilities:

- `resetConversationHistory()` empties in-memory saved turns, removes model messages after the system prompt, and sets `lastCommand` to `null`. It does not immediately write a file; a later save would reflect that reset.
- `clearConversationHistory()` waits for older queued saves, performs the memory reset, and awaits a save of empty history. It returns whether persistence remains available, allowing the spoken response to distinguish confirmed saved clearing from session-only clearing.

The command branch preserves `lastCommand` as `null` after clearing. In disabled or failed-persistence mode, saved history remains untouched by this operation. Independently created backup files are not cleared.

### Explicit Long-Term Fact Store

Milestone 11 adds a separate store in `data/memory.json`. It is independent of `savedHistory`, `conversationHistory`, and `JARVIS_HISTORY_ENABLED`. Clearing conversation history preserves facts; forgetting a fact does not erase any mentions in conversation history or backup files. The memory path is under the existing Git-ignored `data/` directory.

The file format is:

```json
{
  "version": 1,
  "facts": [
    { "key": "favorite color", "value": "blue" }
  ]
}
```

This is an example, not a statement about the user's actual preferences. Fact keys and values must be nonempty strings after trimming. Keys are compared after trimming and lowercasing. `isMemoryFile()` rejects duplicate normalized keys; `upsertMemoryFact()` replaces a matching fact or appends a new one without mutating the original array. Values retain their capitalization. Normalization alone does not equate synonyms or British/American spelling variants.

`loadMemoryFile()` reads before VAD/microphone initialization. Missing files produce empty version-1 memory. Other read failures, malformed JSON, unsupported versions, or invalid facts propagate to the controller, which warns and sets `canPersistMemory` to `false`. A rejected file is not overwritten by later remember/forget requests. The active store starts empty if loading fails, so recall/list cannot inspect facts in the rejected file.

### Memory Update Queue

`MemoryUpdate` describes a callback from a facts array to its replacement array. `queueMemoryUpdate()` invokes that callback inside a serialized Promise chain, so it sees the latest committed facts rather than an earlier snapshot. The supplied operations return new arrays instead of modifying active facts in place.

`persistMemoryUpdate()` creates a version-1 candidate and awaits `saveMemoryFile()` before assigning it to `savedMemory`. Saving validates first, creates the destination directory as needed, writes a unique temporary file beside the destination, and renames it into place. Cleanup attempts preserve the original write/rename error.

The queue reports a boolean result. Invalid update input is caught as `false` while leaving later valid updates possible. A disk-save failure preserves active facts, disables persistence for the session, and also returns `false`. A successful result means saving finished and active memory was updated; same-directory replacement is still not a power-loss durability guarantee or a cross-process lock.

### Memory Commands and Classification

`MemoryCommand` is a discriminated union:

| Action | Required data | Controller behavior |
| ------ | ------------- | ------------------- |
| `remember` | `fact` containing a key and value | Queue an insert/update and acknowledge only after save success |
| `recall` | Nonempty `key` | Wait for updates, then return a matching active value or a not-found response |
| `forget` | Nonempty `key` | Check existence and remove the target inside the update callback; report failure, removal, or no match |
| `list` | None | Wait for updates, then report all active facts or empty memory |

The classifier accepts local identifiers, `NONE`, or memory-command JSON from an OpenAI Responses API request, with Ollama fallback for supported temporary failures. JSON is parsed as `unknown`, validated with `isMemoryCommand()`, and returned as `{ status: "MEMORY", command }`. Output is plain text checked at runtime, not API-enforced structured output. Known memory keys are included as data to help the model map wording to existing fact names. Memory values are not supplied to that classifier.

Code-level routing supplements the prompt:

- Complete review phrases route immediately to `list`: “What do you remember about me?”, “What have you saved about me?”, “List my saved facts”, and “Show my saved facts”. Matching trims/lowercases input and removes trailing sentence punctuation.
- A model-selected `remember` action requires a prefix of `remember`, `save`, `store`, or `update`, optionally preceded by `please`. Ordinary statements do not pass this check.
- A model-selected `forget` action requires `forget` or `please forget` at the beginning of the input.
- When the model returns `NONE`, `extractMemoryRecallKey()` supports “What is my…” and “What's my…” questions by extracting the literal normalized suffix as a recall key. The handler decides whether the value exists, even when memory is empty. Recognized local identifiers keep their existing route.

These are limited phrase/structure checks. Model-based extraction and key matching remain fallible, and unsupported polite wording may be rejected. The literal recall fallback does not perform semantic retrieval or synonym resolution. Payload validation verifies shape, not that a model's chosen key/value perfectly represents every utterance.

The controller waits for pending memory updates before classifying with the current keys. Its `MEMORY` branch calls `executeMemoryCommand()`, checks session validity before speaking the result, and clears previous-local-command context. A requested update may already have been saved when its spoken confirmation is interrupted; the session guard suppresses obsolete speech rather than undoing committed memory.

`executeMemoryCommand()` returns text without directly invoking TTS. Recall and list are read-only. The controller speaks the text, and memory exchanges bypass conversational-history saving. Milestone 12 separately adds selected facts to general `processMessage()` requests as described below.

### Request-Specific Memory Context

For a conversational (`NONE`) result, the controller passes a copied facts array as the fifth argument to `processMessage()`. `buildMemoryContext()` in `src/memory/context.ts` selects facts using the current user input without modifying the active store.

The selector:

1. Lowercases and splits request text and fact keys into ASCII word tokens. Ordinary keys qualify when at least one non-ignored key token appears in the request. Fact values are not used for matching.
2. Handles normalized `learning_preference` separately: it qualifies only when the request contains `explain` or `teach`.
3. Takes the first **10 relevant facts in stored order**, rather than the most recent facts.
4. Removes facts from the end until `JSON.stringify(selectedFacts).length` is at most **2,000**. The count includes JSON escaping and punctuation, but excludes the wrapper and other messages. An oversized first selected fact can result in no selected facts.

An empty selection produces no memory message. Otherwise, the request message order is: current system prompt and recent conversation, a user-role message wrapping the selected JSON as untrusted reference data, and the actual current user request. The wrapper explicitly forbids carrying out instructions within keys or values. Fact values are not promoted into system instructions.

Only the real user input and completed assistant response enter `conversationHistory`; the memory wrapper is request-only. New requests build fresh snapshots, so committed updates and forgetting affect subsequent selection. This does not remove earlier fact mentions from completed conversation history. History-disabled restarts isolate current memory during tests.

The system prompt directs the model to use current saved facts over stale conversational references and to honor current requests over stored preferences. Learning preferences should guide teaching without leaking into unrelated creative tasks. These are model instructions, not deterministic output enforcement. Keyword matching can miss synonyms, implicit teaching requests, and follow-ups without matching words; it can also select facts based on a broad shared word. There is no vector search or automatic fact extraction.

### OpenAI Primary and Ollama Fallback

`src/main.ts` loads configuration using Node's `loadEnvFile` before starting the controller. Configure `OPENAI_API_KEY` privately and run from the project root. Credential values must not appear in source, diagnostics, or version control.

Both classification and conversation use `gpt-6.1-terra` through the OpenAI Responses API with `store: false`. Classification sends its prompt, current input, known fact keys, and limited previous-command context. Conversation sends the bounded message sequence described above. Speech transcription, Kokoro synthesis, native audio, and history/fact files remain local; selected text context is sent to OpenAI. `store: false` is not an offline or blanket zero-retention guarantee.

Each client has a **30,000 ms timeout** and **`maxRetries: 0`**. The provider-selection catch permits fallback only for SDK connection errors (including timeouts), HTTP **429**, or HTTP **5xx**. Other errors produce fixed diagnostics. Responses must report `status === "completed"` before their text is used; incomplete responses do not trigger fallback. Conversational whitespace-only output is rejected before speech or history.

Local fallback uses `qwen3:1.7b` at `http://localhost:11434`: classification POSTs to `/api/generate`, while conversation POSTs to `/api/chat` with the same request messages and temperature zero. Both use `AbortSignal.timeout(30000)`. Conversation checks the HTTP result and `data?.message?.content` before using text. Classification retains its allowlist, memory validators, and explicit-intent guards regardless of provider. A failed classifier returns `ERROR`; the controller does not execute an action from failed classification.

Fallback warnings distinguish the two stages:

- Classification: `OpenAI classification is temporarily unavailable. Using local Ollama fallback.`
- Conversation: `OpenAI is temporarily unavailable. Using local Ollama fallback.`

Ollama can be stopped during successful primary requests. It must be available for fallback. A classification fallback does not imply conversation fallback, and there is no offline-only provider switch. Authentication or client-configuration failures are not hidden by local fallback.

The controller checks its session after classification. Conversation skips starting fallback if its session is already obsolete and uses the existing pre-speech/post-speech guards. These checks discard stale results; they do not generally abort in-flight provider requests. Classification and conversation, and each stage's primary/fallback attempts, have separate timeouts rather than one end-to-end deadline. The local model's learning-preference adherence remains weaker than the tested primary model.

### Listening States

```ts
let state: ListeningState = "IDLE";
```

| State        | Responsibility                                                               |
| ------------ | ---------------------------------------------------------------------------- |
| `IDLE`       | Wait for the wake word                                                       |
| `LISTENING`  | Record the user's command                                                    |
| `PROCESSING` | Transcribe, classify, and execute the request                                |
| `SPEAKING`   | Deliver JARVIS's response (wake-word detection remains active for barge-in)  |

Typical interaction:

`IDLE → LISTENING → PROCESSING → SPEAKING → IDLE`

**Barge-in interaction:**

`SPEAKING → (Wake Word Detected) → LISTENING`

The controller uses these states to determine how incoming microphone audio should be handled. Audio processing remains active during `SPEAKING` so users can interrupt JARVIS mid-sentence.

---

## 2. Audio Buffers and Byte Limits

### The Three Audio Buffers

```ts
const buffers = createAudioBuffers();
```

| Buffer    | Purpose                                                          |
| --------- | ---------------------------------------------------------------- |
| `wake`    | Holds recent audio for wake-word recognition                     |
| `pending` | Preserves audio received while Whisper transcribes the wake word |
| `command` | Collects audio used for final command transcription              |

**Important:** During wake-word transcription, the same incoming audio can be stored in both `wake` and `pending`.

### Buffer Size Calculations

JARVIS records audio using:

- Sample rate: 16,000 samples/second
- Sample size: 16 bits (2 bytes)
- Channels: 1 (mono)

Therefore:

`16,000 × 2 = 32,000 bytes/second`

**Wake buffer:**

```ts
const MAX_BUFFER_BYTES = 16000 * 2 * 3;
```

Maximum target: **96,000 bytes ≈ 3 seconds**

**Pending buffer:**

```ts
const MAX_PENDING_BYTES = 16000 * 2 * 5;
```

Maximum target: **160,000 bytes ≈ 5 seconds**

The controller uses `push()` to add incoming chunks and `shift()` to discard the oldest chunks when a rolling buffer exceeds its limit.

### Byte Counters

```ts
let totalBytes = 0;
let pendingBytes = 0;
let commandBytes = 0;
```

- `totalBytes`: Tracks the wake buffer's size.
- `pendingBytes`: Tracks the pending buffer's size.
- `commandBytes`: Tracks collected command audio.

These counters represent bytes, not the number of audio chunks.

---

## 3. Timeouts and Session Tracking

### Listening Timeouts

```ts
const MAX_LISTENING_MS = 10000;
const FIRST_COMMAND_TIMEOUT_MS = 4000;
```

| Timeout               | Duration   | Purpose                                            |
| --------------------- | ---------- | -------------------------------------------------- |
| Maximum listening     | 10 seconds | Prevents excessively long command recording        |
| First-command timeout | 4 seconds  | Returns to IDLE when no command speech is detected |

```ts
let listeningStart: number | null = null;
```

**Important:** `listeningStart` is initially set when JARVIS enters `LISTENING`. However, if the wake-word snapshot did not already contain the user's command (`!vadVoiceDetected`), `listeningStart` is re-assigned to `Date.now()` the moment command speech is first detected by VAD.

Consequently:

- The **first-command timeout** (4 seconds) measures elapsed time from entering `LISTENING` while waiting for the user to begin speaking.
- The **maximum listening timeout** (10 seconds) measures elapsed time from when command speech begins (or from `LISTENING` entry if the wake snapshot already contained command audio), ensuring the user has the full 10-second duration to speak their request.

### Processing Flags

```ts
let silenceHandled = false;
let isTranscribing = false;
```

- `silenceHandled`: Prevents repeated command-processing triggers after a silence threshold.
- `isTranscribing`: Prevents overlapping wake-word transcription attempts.

### Speech Cooldown

```ts
const SPEECH_COOLDOWN_MS = 1000;
let cooldownUntil = 0;
```

After a listening session resets, the controller temporarily ignores microphone audio for approximately one second.

This helps prevent JARVIS from detecting the end of its own spoken response.

### Session Identification

```ts
let sessionId = 0;
```

`sessionId` identifies the current listening session.

When a session resets, playback is interrupted via barge-in (`state === "SPEAKING"`), or the controller shuts down, `sessionId` increments:

- An asynchronous wake-word transcription compares its captured `checkSessionId` against `sessionId` to avoid applying outdated detections.
- An in-flight command execution checks `commandSessionId === sessionId` before running error-handling speech or session cleanup, ensuring a superseded session never overwrites an active interruption.

### Native Playback Timeout

Native playback has a separate **120,000 ms** timeout. When it expires, the request stays registered while the controller sends STOP for that ID. Swift's completion/stop response then settles the request as a timeout error, allowing the speech wrapper's existing failure handling to run.

If STOP is not acknowledged within **2,000 ms**, or sending that timeout STOP fails, the controller sends `SIGKILL` to the helper. Process-close cleanup rejects pending requests and shuts down the controller. Restart JARVIS after that failure; native capture is not automatically recreated.

`playNativeAudio()` rejects requests when shutting down or when the child/command pipe is unavailable. `stopNativeAudio()` skips writes to an unavailable process, avoiding a redundant STOP after the helper has already exited.

### Session Reset (`resetListeningSession`)

```ts
const resetListeningSession = (): void => {
  sessionId++;
  resetAudioBuffers(buffers);
  commandBytes = 0;
  totalBytes = 0;
  pendingBytes = 0;
  silenceHandled = false;
  listeningStart = null;
  state = "IDLE";
  cooldownUntil = Date.now() + SPEECH_COOLDOWN_MS;
  vadSilentFrames = 0;
  vadVoiceDetected = false;
  idleSpeechDetected = false;
};
```

Centralizes cleanup across timeouts and completed command executions. It increments `sessionId`, empties rolling audio buffers, resets byte counters and VAD flags, transitions the state back to `IDLE`, and activates the speech cooldown.

---

## 4. Voice Activity Detection (VAD)

### Initialization

```ts
const VAD = await VADBuilder();
const vad = new VAD(VADMode.VERY_AGGRESSIVE, 16000);
const frameBuffer = new AudioFrameBuffer();
```

**VAD detects whether audio contains speech or silence without converting speech into text.**

- `VADBuilder()`: Initializes the VAD implementation.
- `VERY_AGGRESSIVE`: Uses a strict speech-detection mode.
- `16000`: Configures VAD for 16 kHz audio.
- `AudioFrameBuffer`: Organizes microphone chunks into fixed-sized frames.

The current `src/audio/frameBuffer.ts` produces **30 ms frames**: 480 samples, or 960 bytes, at 16 kHz Int16 mono. VAD initialization happens before microphone startup; the code above describes that same initialization, not a second instance.

### VAD Tracking Variables

```ts
let vadSilentFrames = 0;
let vadVoiceDetected = false;
const VAD_SILENCE_FRAMES = 50;
let idleSpeechDetected = false;
```

| Variable             | Purpose                                           |
| -------------------- | ------------------------------------------------- |
| `vadSilentFrames`    | Counts consecutive silent frames                  |
| `vadVoiceDetected`   | Indicates command speech was detected or inferred |
| `VAD_SILENCE_FRAMES` | Sets the silence threshold to 50 frames           |
| `idleSpeechDetected` | Indicates speech occurred while IDLE or SPEAKING   |

When VAD detects voice during `LISTENING`, the silence counter resets to zero.

When VAD detects silence, the counter increases.

With the current 30 ms frames, 50 consecutive silent frames represent approximately **1.5 seconds** of audio, not 50 milliseconds.

---

## 5. Microphone Data Event

### Receiving Audio Chunks

```ts
child.stdout.on("data", (chunk: Buffer) => {
  // Process incoming audio.
});
```

This event handler executes whenever the microphone child process provides another chunk of audio.

A `Buffer` contains raw bytes representing audio samples.

**Audio chunks are not words or sentences.** They are simply pieces of the continuous audio stream, and their sizes can vary.

### When Audio Is Ignored

```ts
if (
  isShuttingDown ||
  Date.now() < cooldownUntil ||
  state === "PROCESSING"
) {
  return;
}
```

The handler returns early when:

- JARVIS is shutting down.
- The speech cooldown is active.
- JARVIS is in `PROCESSING`.

**Note:** Audio is **not** ignored during `SPEAKING`. Audio streaming and wake-word detection continue during speech playback to allow the user to interrupt JARVIS (barge-in).

### Wake-Word Detection State (`canDetectWakeWord`)

```ts
const canDetectWakeWord = (): boolean => {
  return state === "IDLE" || state === "SPEAKING";
};
```

Encapsulates the states where JARVIS listens for the wake word: while waiting idle or while speaking a response.

### Buffering During Wake-Word Transcription

```ts
if (isTranscribing && canDetectWakeWord()) {
  buffers.pending.push(chunk);
  pendingBytes += chunk.length;
}
```

While Whisper checks for the wake word, the microphone continues recording.

The `pending` buffer stores newly arriving audio so commands spoken during transcription aren't lost (both while `IDLE` or `SPEAKING`).

### Maintaining the Wake Buffer

```ts
if (canDetectWakeWord()) {
  buffers.wake.push(chunk);
  totalBytes += chunk.length;
}
```

The wake buffer continually stores recent microphone audio whenever JARVIS is ready to detect the wake word (`IDLE` or `SPEAKING`).

When it exceeds its byte limit, the oldest chunks are removed.

**Key distinction:** The wake and pending conditions are independent `if` statements, so both can execute for the same audio chunk.

### Recording Command Audio

```ts
if (state === "LISTENING") {
  buffers.command.push(chunk);
  commandBytes += chunk.length;
}
```

Once JARVIS enters `LISTENING`, incoming audio is added to the command buffer.

The final command buffer can contain:

1. The original wake-word audio snapshot.
2. Audio preserved while Whisper was transcribing.
3. Audio recorded after entering `LISTENING`.

---

## 6. Audio Frames and VAD Processing

### Converting Chunks Into Frames

```ts
const frames = frameBuffer.addChunk(chunk);
```

Microphone chunks can have arbitrary sizes, but VAD expects valid fixed-sized frames.

`AudioFrameBuffer` collects and reorganizes incoming bytes into complete frames.

### Converting PCM Bytes Into Samples

```ts
const samples = Int16Array.from({ length: frame.length / 2 }, (_, i) =>
  frame.readInt16LE(i * 2),
);
```

Each PCM sample occupies two bytes.

`readInt16LE()` reads each pair as a signed 16-bit integer using little-endian byte order.

For example, a 960-byte frame contains 480 audio samples.

### Detecting Speech or Silence

```ts
const result = vad.processFrame(samples);
```

VAD analyzes the audio frame and returns a detection result.

**While IDLE or SPEAKING (`canDetectWakeWord()`):**

If VAD detects voice, `idleSpeechDetected` becomes `true`, allowing a subsequent wake-word check to invoke Whisper (enabling wake-word recognition both in standby and during active speech).

**While LISTENING:**

- `VOICE`:
  - If `!vadVoiceDetected`, reset `listeningStart = Date.now()` so the listening timer measures from speech onset.
  - Reset `vadSilentFrames = 0`.
  - Set `vadVoiceDetected = true`.
- `SILENCE`: Increment `vadSilentFrames`.

This allows the controller to determine when the user has likely finished speaking.

---

## 7. Silence Detection and Timeouts

### Silence Threshold

```ts
const vadSilenceElapsed =
  state === "LISTENING" &&
  vadVoiceDetected &&
  vadSilentFrames >= VAD_SILENCE_FRAMES;
```

Command processing can be triggered by silence only when:

1. JARVIS is listening.
2. Command speech has been detected or inferred.
3. At least 50 consecutive silent frames have been counted.

The speech requirement prevents silence alone from triggering command processing.

### Maximum Listening Duration

```ts
const maxListeningElapsed =
  listeningStart !== null && Date.now() - listeningStart >= MAX_LISTENING_MS;
```

Checks whether 10 seconds have elapsed since command speech started (or since entering `LISTENING` if the command was part of the wake snapshot).

This provides a safety fallback to stop recording when the silence threshold isn't reached (e.g., continuous background noise or talking).

### First-Command Timeout

```ts
const firstCommandTimeoutElapsed =
  state === "LISTENING" &&
  !vadVoiceDetected &&
  listeningStart !== null &&
  Date.now() - listeningStart >= FIRST_COMMAND_TIMEOUT_MS;
```

If no command speech is detected within four seconds of entering `LISTENING`, the controller calls `resetListeningSession()` and resets to `IDLE`.

Once `vadVoiceDetected` becomes `true`, this timeout no longer applies.

### Triggering Command Processing

```ts
if (
  !silenceHandled &&
  (vadSilenceElapsed || maxListeningElapsed) &&
  state === "LISTENING"
) {
  silenceHandled = true;
  state = "PROCESSING";

  processCommand().catch((error) =>
    console.error("Command processing failed:", error),
  );
}
```

JARVIS processes a command when either:

- Enough consecutive silence has been detected, or
- The maximum listening duration has elapsed.

Before starting `processCommand()`, it marks the silence event as handled and switches to `PROCESSING`.

This prevents subsequent microphone events from repeatedly starting the same command.

---

## 8. Speech Barge-In and Playback Interruption

### Overview

Speech barge-in allows the user to say the wake word ("Jarvis") while JARVIS is actively speaking (`SPEAKING` state). Once the wake word is confirmed, the controller requests playback interruption and transitions directly into recording a new command (`LISTENING` state). Detection is not instantaneous: wake-word checks run approximately every second and require Whisper transcription.

### Interruption Trigger

```ts
if (
  containsWakeWord(transcription, state === "SPEAKING") &&
  canDetectWakeWord() &&
  !isShuttingDown &&
  checkSessionId === sessionId
) {
  if (state === "SPEAKING") {
    sessionId++;
    stopKokoroPlayback();
    buffers.command.length = 0;
    commandBytes = 0;
  }

  buffers.command.push(pcmBuffer);
  buffers.command.push(...buffers.pending);
  commandBytes = Buffer.concat(buffers.command).length;
  buffers.wake.length = 0;
  totalBytes = 0;

  state = "LISTENING";
  listeningStart = Date.now();
  // ...
```

When the wake word is confirmed while `state === "SPEAKING"`:

1. **`sessionId++`**: Invalidates the prior session so that in-flight asynchronous operations or error handlers from that command cycle are disregarded.
2. **`stopKokoroPlayback()`**: Increments Kokoro's separate `speechSession` counter so older speech cannot advance to another chunk. In native mode it sends STOP for pending playback IDs; in SoX mode it interrupts the active `afplay` process with `SIGTERM`.
3. **Buffer reset**: Discards prior command audio and seeds the new command buffer with the captured wake-word audio and any pending chunks.
4. **Immediate listening**: Switches `state = "LISTENING"` and records the user's new request without requiring an idle transition or cooldown.

### Guarding Command Processing (`commandSessionId`)

```ts
const processCommand = async (): Promise<void> => {
  const commandSessionId = sessionId;

  try {
    // ... execute command and speak response
  } catch (error) {
    if (!isShuttingDown && commandSessionId === sessionId) {
      // Speak error response
    }
  } finally {
    // Clean up temporary audio files
    if (!isShuttingDown && commandSessionId === sessionId) {
      resetListeningSession();
    }
  }
};
```

When barge-in interrupts a command:

- The interrupted command's `processCommand` execution might be waiting on playback completion or error unwinding.
- Checking `commandSessionId === sessionId` in `catch` and `finally` ensures an interrupted command cannot attempt to speak an error or reset the state machine to `IDLE` while the new command is actively being recorded in `LISTENING`.
- Kokoro also checks its own `speechSession` when native playback rejects. If that speech session was superseded or stopped, the old response ends quietly instead of triggering fallback speech.

Native STOP acknowledgement resolves the pending playback Promise as an expected interruption. The speaker callback outputs silence after observing the stop request; it does not parse JSON or log events. A worker reports the acknowledgement outside the callback.

The `say` fallback used by `src/tts/speech.ts` is a separate playback path. It does not provide the same native echo reference or interruption behavior.

---

## 9. Key Concepts to Remember

**Audio chunks vs. audio frames**

Chunks are arbitrary pieces of microphone audio. Frames are fixed-sized groups of samples prepared for VAD.

**VAD vs. Whisper**

VAD determines whether speech is present. Whisper converts recorded speech into text.

**Wake vs. pending vs. command**

The wake buffer helps recognize "Jarvis"; the pending buffer preserves audio during transcription; the command buffer holds the complete audio for the user's request.

**Speech barge-in**

Microphone audio and VAD monitoring remain active while JARVIS speaks (`canDetectWakeWord()`). When Whisper confirms the wake word during playback, JARVIS requests a stop via `stopKokoroPlayback()`, increments `sessionId` to obsolete the prior command flow, and begins collecting the new command without waiting for another idle cycle.

**Asynchronous execution**

`await` pauses the current asynchronous function, not the entire Node.js event loop. Microphone data events can continue while Whisper transcribes.

**State vs. session**

`state` describes what JARVIS is currently doing. `sessionId` helps distinguish the current interaction from outdated asynchronous results.

**Timeouts**

The first-command timeout starts when JARVIS enters `LISTENING` and resets the session to `IDLE` after 4 seconds if no speech is detected. Once command speech begins, `listeningStart` is updated to measure the 10-second maximum listening duration from speech onset.

Playback has its own two-minute timeout and two-second STOP acknowledgement limit; these do not change command-listening timeouts.

---

## 10. Shutdown and Process Failure

`shutdownVoiceController()` is shared by SIGINT, SIGTERM, child-process errors, and unexpected child closure. Its shutdown flag prevents duplicate cleanup.

It marks shutdown active, increments the controller session, clears wake-word polling, and stops the Kokoro speech session before rejecting pending native playback. That order prevents late playback errors from reviving an obsolete response. It clears native playback configuration, requests child termination if needed, destroys VAD, and requests Kokoro worker shutdown.

Kokoro's graceful worker shutdown has a ten-second timeout; if it expires, shutdown requests forced worker termination and waits for completion. Startup failure in `src/main.ts` also requests worker shutdown, covering a failure before controller cleanup handlers have been registered.

Unexpected microphone exits are reported as failures and set `process.exitCode = 1`. A native helper that handles an externally sent SIGTERM may exit with `code 0, signal null`; its exit is still unexpected if the controller did not initiate shutdown. The helper is not restarted automatically.

An stdin error rejects pending playback requests and logs the command-pipe failure. The child's error/close handlers handle controller shutdown. During normal shutdown, the helper intentionally discards pending microphone output rather than waiting indefinitely for a stalled reader.

## 11. Milestone 9 Validation Checkpoint

The native integration has been exercised through streamed audio playback and Whisper transcription, normal commands, repeated interruptions, silent-listening trials without reported self-activation, the manual SoX/`afplay` fallback, shutdown during speech, and unexpected helper-exit cleanup. A temporarily shortened playback timeout exercised acknowledged STOP recovery; the normal timeout was restored to **120,000 ms**.

Offline native tests cover microphone ring-buffer wraparound and overflow, streaming format conversion, speech-file conversion, command framing, rendering, completion, stop handling, and stale stop IDs. Run them from the project root:

```sh
swift native/audio/main.swift --test-streaming-buffer
swift native/audio/main.swift --test-converter
swift native/audio/main.swift --test-playback
```

These self-tests do not start microphone capture or speaker playback. TypeScript is checked separately with `npx tsc --noEmit`.

Missing STOP acknowledgement and forced termination were checked with simulated timers, not a live hung-helper trial. Echo suppression for production Kokoro playback has not been quantitatively measured. These results establish the tested integration behavior rather than a guarantee across all devices, volumes, or listening environments.

## 12. Milestone 10 Validation Checkpoint

Live tests verified history-file creation and recall after restart; omission of an interrupted answer followed by a local command; preservation of a rejected version-2 file; session-only recall without changing the saved file checksum; and clearing both session context and persisted turns. Tests that cleared or altered the real history file used a backup.

Isolated checks verified serialized saves and snapshot contents, clearing after a pending save, disabling writes after load/save failures, original-file preservation and temporary-file cleanup on rename failure, malformed JSON and schema rejection, and startup/runtime turn and text-size limits. Interrupted and obsolete responses did not modify model context. These checks used temporary fixtures or substituted I/O, without changing the user's saved history.

The final closeout checks also passed TypeScript checking, whitespace checks, native compilation, and all three native offline self-tests. The npm test script remains a placeholder; these isolated history checks are not yet a committed automated test suite.

## 13. Milestone 11 Validation Checkpoint

Live tests verified a remembered fact appearing in `memory.json`, recall and listing after restart, updating without duplicate keys, and targeted forgetting persisting across restart. After a missing-fact question initially fell through to conversational AI, prompt and routing changes were tested and the live missing-fact/time-command regression passed.

Another live test used `JARVIS_HISTORY_ENABLED=false`: a remembered fact survived clearing session conversation history and remained recallable. A backup-protected version-2 memory-file test confirmed that startup warned, refused updates, and preserved the rejected file. The valid version-1 file was restored afterward.

Classification-only Ollama tests exposed inconsistent broad-list routing, hypothetical forgetting, missing-fact routing, and an unwanted remember classification for an ordinary statement. Deterministic list routing, explicit mutation-prefix guards, and the `NONE` recall fallback were added. Simulated model-output checks exercised those paths without executing commands or modifying user files; the examples do not establish universal natural-language classification accuracy.

Isolated checks also covered blank facts, duplicate normalized keys, malformed commands/files, save/reload, normalized lookup/update/removal, update ordering, use of the latest committed facts, save-failure retention, disabled further writes, and temporary-file cleanup. TypeScript and whitespace checks passed at closeout. The memory module and classifier tests are not yet a committed automated test suite.

Automatic fact extraction, automatic use of saved facts in general conversation, and vector/semantic retrieval were outside Milestone 11's explicit-command implementation. Milestone 12 adds keyword-selected conversational context, as documented above.

## 14. Milestone 12 Validation Checkpoint

User-run tests exercised the OpenAI primary paths with Ollama stopped: time commands routed correctly, conversational questions received generated answers, and “How would I open Safari?” produced guidance without opening the application. Remember, recall, and forget also passed through the OpenAI classifier.

Conversational tests verified relevant fact selection without unrelated editor/platform details; an updated rover name persisted across restart; a forgotten name was absent after restart; and forgetting that fact preserved the separate learning preference. History-disabled sessions prevented older exchanges from supplying the tested names. The OpenAI model explained closures without revealing the practice solution, then provided a correct solution when explicitly requested. This resolved the repeated primary-path teaching failures observed with the local model; local fallback is not equivalent in quality.

A saved phrase instructing JARVIS to ignore previous instructions and adopt another name was supplied through conversational memory. In the tested OpenAI response, JARVIS described the instruction attempt and retained its identity. A prior explicit-recall response did not exercise conversational generation and was not counted as that test. The temporary fact was removed. This is a successful regression case, not proof of general prompt-injection resistance.

OpenAI-path speech interruption stopped the old explanation, answered the new time command, and returned to readiness. Separately injected `OpenAI.APIConnectionError` failures exercised classification fallback and conversational fallback, including the revised `/api/chat` request. The classification-only injection produced its specific warning while conversation remained on OpenAI. Temporary throws and the diagnostic system prompt were removed, and the original system prompt is active.

Focused isolated checks covered relevant/irrelevant facts, learning-request selection, normalized preference keys, selection limits, JSON-length boundaries, and preservation of source arrays. TypeScript and whitespace checks passed. The 30-second timeouts and incomplete-response guards were reviewed; live timeout-expiry and incomplete-response failures were not separately injected. Provider checks are not yet a committed automated regression suite. Native audio was unchanged during this milestone; earlier native validation remains a separate checkpoint.
