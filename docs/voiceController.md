# JARVIS Voice Controller

**Source:** `src/voiceController.ts`

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

---

## 1. Initialization and State

### Microphone Process

```ts
const child = startMicrophone();
```

Starts the microphone as a **child process**, which continuously sends raw audio to Node.js through its standard output (`stdout`).

The microphone runs independently from the voice controller's asynchronous operations.

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

Stores messages used by JARVIS's conversational AI.

Each message contains:

- `role`: Who the message belongs to.
- `content`: The message text.

The history initially contains the system prompt. The controller passes it to `processMessage()` for conversational requests, but not to `executeLocalCommand()`.

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

When a session resets or when playback is interrupted via barge-in (`state === "SPEAKING"`), `sessionId` increments:
- An asynchronous wake-word transcription compares its captured `checkSessionId` against `sessionId` to avoid applying outdated detections.
- An in-flight command execution checks `commandSessionId === sessionId` before running error-handling speech or session cleanup, ensuring a superseded session never overwrites an active interruption.

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
| `idleSpeechDetected` | Indicates speech occurred while IDLE              |

When VAD detects voice during `LISTENING`, the silence counter resets to zero.

When VAD detects silence, the counter increases.

**Remember:** 50 frames does not necessarily mean 50 milliseconds. The duration depends on the number of samples in each frame.

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

Speech barge-in allows the user to say the wake word ("Jarvis") while JARVIS is actively speaking (`SPEAKING` state). This immediately interrupts the speech playback and transitions directly into recording a new command (`LISTENING` state).

### Interruption Trigger

```ts
if (
  containsWakeWord(transcription) &&
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
2. **`stopKokoroPlayback()`**: Sends `SIGTERM` to the active `afplay` child process in Kokoro TTS, cutting off speech playback immediately.
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

---

## 9. Key Concepts to Remember

**Audio chunks vs. audio frames**

Chunks are arbitrary pieces of microphone audio. Frames are fixed-sized groups of samples prepared for VAD.

**VAD vs. Whisper**

VAD determines whether speech is present. Whisper converts recorded speech into text.

**Wake vs. pending vs. command**

The wake buffer helps recognize "Jarvis"; the pending buffer preserves audio during transcription; the command buffer holds the complete audio for the user's request.

**Speech barge-in**

Microphone audio and VAD monitoring remain active while JARVIS speaks (`canDetectWakeWord()`). If the wake word is spoken during playback, JARVIS halts speech output immediately via `stopKokoroPlayback()`, increments `sessionId` to obsolete the prior command flow, and begins recording the new command right away.

**Asynchronous execution**

`await` pauses the current asynchronous function, not the entire Node.js event loop. Microphone data events can continue while Whisper transcribes.

**State vs. session**

`state` describes what JARVIS is currently doing. `sessionId` helps distinguish the current interaction from outdated asynchronous results.

**Timeouts**

The first-command timeout starts when JARVIS enters `LISTENING` and resets the session to `IDLE` after 4 seconds if no speech is detected. Once command speech begins, `listeningStart` is updated to measure the 10-second maximum listening duration from speech onset.
