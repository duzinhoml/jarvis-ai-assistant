# JARVIS AI Assistant

A voice-enabled AI desktop assistant built with **TypeScript** and **Node.js** for macOS, using **OpenAI** for primary language-model requests and **Ollama** for local fallback.

Inspired by Tony Stark's J.A.R.V.I.S. from the Iron Man films, this project aims to develop an intelligent, conversational assistant capable of understanding natural language, responding through speech, interacting with the operating system, and eventually integrating with physical hardware.

## Overview

JARVIS is a personal software engineering and artificial intelligence project focused on building a modular, extensible desktop assistant.

JARVIS combines cloud-based language-model requests with local speech processing and local history/fact storage. OpenAI receives the context needed for classification and conversation; Ollama provides fallback inference for supported temporary failures.

The long-term goal is to develop an increasingly autonomous assistant with contextual memory, advanced computer interaction, hardware integration, and eventually a custom-trained AI model.

## Features

### Implemented

- **AI Conversations:** Generate responses with OpenAI `gpt-6.1-terra`, with local Ollama `qwen3:1.7b` fallback for connection failures, rate limits, and server errors.
- **Voice Activation:** Begin requests with “Jarvis,” “Hey Jarvis,” or “Hi Jarvis,” detected through local Whisper transcription.
- **Terminal Feedback:** Display listening states, transcriptions, responses, and errors in the terminal.
- **Text-to-Speech:** Generate spoken responses locally using Kokoro in a worker thread, with chunked playback through native VoiceProcessingIO. SoX mode uses macOS `afplay`; supported speech failures fall back to `say`.
- **Speech Interruption:** Detect the wake word during Kokoro speech to interrupt playback and begin a new request.
- **Speech Recording:** Capture microphone input through native VoiceProcessingIO and stream 16 kHz mono Int16 PCM to TypeScript, with SoX available as a manual fallback.
- **Speech Recognition:** Transcribe recorded audio using Whisper.
- **Voice Activity Detection (VAD):** Detect speech and silence with WebRTC VAD and use listening timeouts to process requests.
- **Intent Classification:** Use OpenAI with Ollama fallback to route natural-language requests to approved commands, retaining validation and limited previous-command context.
- **macOS Integration:** Open Safari, Chrome, Visual Studio Code, and Finder. Retrieve the current time, date, and battery status.
- **Music Commands:** Open a configured study playlist in Chrome and pause or resume Apple Music when explicitly named.
- **Conversation History:** Save completed conversational exchanges locally and restore recent context across restarts, with session-only mode and an explicit history-clearing command.
- **Explicit Long-Term Memory:** Remember, update, recall, list, and forget named facts in a separate local memory file, with validated commands and serialized updates.
- **Memory-Aware Conversations:** Supply a bounded selection of relevant saved facts per conversational request, including learning preferences for recognized teaching requests.
- **Assistant Personality:** Custom system instructions define JARVIS's conversational behavior.
- **Error Handling:** Handle model execution failures and other runtime errors.

### In Development

- **Wake-Word Reliability:** Improve activation accuracy and handling of requests that repeat the assistant’s name.
- **Voice Session Recovery:** Improve microphone failure cleanup, worker shutdown, and speech fallback behavior.
- **Command Reliability:** Refine intent classification and contextual follow-up handling.
- **Speech Latency:** Improve response times and interruption handling.
- **Echo Processing:** Quantitatively measure echo suppression across playback volumes and listening environments.

### Planned

- Broader semantic retrieval of saved facts beyond keyword matching.
- Context-aware interactions and improved reasoning.
- Expanded macOS automation.
- Hardware integration using Arduino.
- Visual interfaces and real-time system monitoring.
- Custom AI model training and fine-tuning.
- More natural, low-latency voice conversations.

## Tech Stack

| Technology   | Purpose                             |
| ------------ | ----------------------------------- |
| TypeScript   | Primary programming language        |
| Node.js      | Application runtime                 |
| OpenAI / GPT-6.1 Terra | Primary intent classification and conversation |
| Ollama / Qwen | Local fallback classification and conversation |
| Whisper.cpp  | Speech-to-text transcription        |
| Swift / VoiceProcessingIO | Native microphone capture, speech playback, and voice processing |
| SoX          | Fallback microphone capture and resampling |
| Kokoro / ONNX | Local speech synthesis in a worker thread |
| macOS `afplay` / `say` | Fallback audio playback and speech |
| macOS utilities / AppleScript | Application, battery, and Music controls |
| WebRTC VAD   | Voice activity detection            |
| Git & GitHub | Version control                     |

## Getting Started

### Prerequisites

- macOS
- Node.js and npm
- Swift toolchain with the `Synchronization` module (used by the native audio backend)
- OpenAI API access to `gpt-6.1-terra`
- Ollama and its downloaded model for local fallback
- SoX
- Whisper.cpp
- A working microphone with access granted to the terminal or IDE
- Internet access for OpenAI requests and initial model downloads

### Installation

**1. Clone the repository**

```bash
git clone https://github.com/duzinhoml/jarvis-ai-assistant.git
cd jarvis-ai-assistant
```

**2. Install dependencies**

```bash
npm install
```

**3. Install and configure Ollama**

Download Ollama from [ollama.com](https://ollama.com).

Ensure Ollama is running at `http://localhost:11434`, then pull the fallback model for conversations and intent classification:

```bash
ollama pull qwen3:1.7b
```

Ollama is not required for successful primary OpenAI requests. It must be running for local fallback; if both providers fail, JARVIS reports failure instead of executing an unclassified command.

**4. Install audio dependencies**

Using Homebrew:

```bash
brew install sox whisper-cpp
```

Download the Whisper English base model and place it at `models/ggml-base.en.bin`. Ensure `swift`, `sox`, and `whisper-cli` are available on your `PATH`.

**5. Configure the application**

Ensure executable paths and model locations match your system. Configure `OPENAI_API_KEY` privately for the primary language-model requests. Startup uses Node's `loadEnvFile` before launching the controller; run from the project root with the expected local configuration file available. Never put credential values in source code, logs, or commits.

Kokoro downloads its model on first use and uses the `bm_daniel` voice. The optional ElevenLabs integration is not enabled in the default speech flow.

Customize the assistant personality in `src/conversation/prompt.ts`, the study playlist in `src/commands/executor.ts`, and Kokoro settings in `src/tts/kokoroWorker.ts`.

**6. Run JARVIS**

From the project root, compile and start the application:

```bash
npx tsc
npx tsx src/main.ts
```

Native audio is selected by default. Wait for **“Voice processing enabled…”** before speaking; “Initializing J.A.R.V.I.S...” only indicates that startup has begun.

To use SoX capture with `afplay` playback instead:

```bash
JARVIS_AUDIO_SOURCE=sox npx tsx src/main.ts
```

This selects the fallback for that invocation; it is not an automatic failover. Keep running from the project root so the native source, models, and worker paths resolve correctly.

Compile before the first run and after changes to the Kokoro worker: the application loads the worker from `dist/tts/kokoroWorker.js`.

Say “Jarvis” followed by a request, such as “Jarvis, open Safari” or “Jarvis, what time is it?” Say “Jarvis, stop” to interrupt Kokoro speech. Press **Ctrl+C** to request shutdown.

Conversation history persists by default in `data/conversation-history.json`, which is excluded from Git. Only completed conversational exchanges are saved; interrupted responses and local-command exchanges are not. Saved turns contain the user message, assistant response, and an ISO completion timestamp. The current system prompt is applied at startup rather than stored in that file.

To start with empty conversational context and disable history-file reads and writes for one session:

```bash
JARVIS_HISTORY_ENABLED=false npx tsx src/main.ts
```

Only the exact value `false` disables persistence. Session-only mode still remembers exchanges until the process exits, subject to the context limits below.

Say **“Jarvis, clear my conversation history”** to reset current context and attempt to persist empty history. The system prompt is preserved. In session-only mode, or if persistence was disabled after an error, this clears conversational context without changing saved history; the spoken response distinguishes that outcome from a confirmed full clear. Clearing conversation history does not clear the separate long-term fact store or independently created backup copies.

The model receives at most the **10 most recent completed turns**, trimmed further to **6,000 JavaScript string-length units** of historical message text. Complete oldest pairs are removed first. These limits apply at startup and during the session; the saved archive retains all completed turns until explicitly cleared. The system prompt and current request are outside the historical-text budget, which is not a model-token limit.

If a history file is missing, JARVIS starts with empty history. If loading or saving fails, it reports the error and disables persistence for that session. A failed load is not automatically overwritten with empty history.

**Saved facts and preferences**

Explicitly remembered facts are stored separately in `data/memory.json`, also excluded from Git. Each fact has a string key and value. Keys are trimmed and lowercased; remembering the same normalized key updates its value instead of creating a duplicate.

| Action | Example spoken request |
| ------ | ---------------------- |
| Remember | “Jarvis, remember that my favorite color is blue.” |
| Update | “Jarvis, update my favorite color to green.” |
| Recall | “Jarvis, what is my favorite color?” |
| Review | “Jarvis, what do you remember about me?” |
| Forget one fact | “Jarvis, forget my favorite color.” |

Use one action per request. Remember/update requests currently require a prefix of `remember`, `save`, `store`, or `update`, optionally preceded by `please`. Forget requests require `forget` or `please forget`. These code checks filter model-selected write/delete actions; an ordinary statement such as “My favorite color is blue” does not pass the remember guard.

Four complete review phrases route directly to listing without a model request: “What do you remember about me?”, “What have you saved about me?”, “List my saved facts”, and “Show my saved facts”. Matching ignores capitalization and trailing sentence punctuation. If the model returns `NONE`, personal-fact questions beginning “What is my…” or “What's my…” have a literal-key recall fallback, including when memory is empty. Recognized local commands retain their existing route.

Fact storage is independent of `JARVIS_HISTORY_ENABLED=false`. That setting disables conversation-history reads/writes, not explicit memory. Forgetting a fact removes it from `memory.json`; it does not remove copies in conversation history or manual backups. To remove both forms of retained information, use the corresponding fact-forgetting and conversation-history-clearing actions.

A missing memory file starts an empty fact store. Invalid files disable memory updates for that session without overwriting the rejected file. Failed saves retain the previous active facts and disable further writes. Successful memory changes are acknowledged only after saving. Recall/list use the active fact store; startup warnings report when that store could not be loaded.

Saved facts also inform general conversations. `src/memory/context.ts` compares distinct lowercase ASCII word tokens in fact keys with the current request, ignoring common key words. Retrieval normalizes `colour` to `color` and `favourite` to `favorite` on both sides without changing stored keys. Fact values do not influence matching. The normalized `learning_preference` key scores 1 for current requests containing `explain`, `teach`, `help me understand`, or `walk me through`, with complete-word matching; otherwise it scores 0.

Supported follow-up prefixes are `what color is it`, `what about its`, `how about its`, and `tell me more about it`. After token normalization, these requests can use the first **500 characters of the latest completed conversational user message** as additional retrieval text. Other requests do not inherit that context. The actual user message sent to the model is unchanged, and learning-preference detection uses only the current request.

Ordinary fact scores are `currentMatches + contextOnlyMatches / (contextOnlyMatches + 1)`. Each distinct meaningful key word contributes once: current-question matches take priority over any number of inherited-only matches. Zero-score facts are excluded; positive scores sort highest first, with stored order breaking ties. Scores are recalculated per conversational request and are not saved.

Selection walks that ranking and accepts up to **10 facts** within **2,000 JavaScript string-length units** of serialized JSON. Facts that do not fit are skipped so smaller useful facts can still be selected, including beyond the first ten candidates. The full store is unchanged. JSON escaping and punctuation count toward the budget; the wrapper and system prompt do not. This is not a token limit or optimal packing algorithm.

Retrieval remains lexical: it does not resolve general synonyms or ambiguous pronouns, and it does not carry an inferred subject across multiple follow-up turns. Broad shared words may select unrelated facts. Embeddings, general semantic retrieval, and automatic fact extraction are future work.

The selected snapshot is wrapped as untrusted reference data in a request-only message before the user's actual request. It is not appended to conversation history. Current requests override stored preferences; updates and forgetting affect subsequent snapshots. Completed answers can still mention facts and remain in history until cleared. Prompt boundaries reduce instruction confusion but do not guarantee resistance to arbitrary embedded instructions. Semantic key matching and command-payload extraction remain model-dependent.

Apple Music controls require an explicit target, such as “Jarvis, pause Apple Music.” They do not control the YouTube study playlist or other players.

To check types without compiling, run `npx tsc --noEmit`. Run `npm test` for the 15 isolated memory-retrieval regression tests in `src/tests/memory-context.ts`; these use synthetic facts without reading saved memory, loading credentials, starting audio, or making model requests. The native helper also provides offline self-tests that do not start microphone capture or speaker playback:

```bash
swift native/audio/main.swift --test-streaming-buffer
swift native/audio/main.swift --test-converter
swift native/audio/main.swift --test-playback
```

## Architecture

JARVIS is being developed around several core responsibilities:

### Conversational AI

Processes natural-language input, manages recent conversational context, and generates responses through OpenAI's Responses API using `gpt-6.1-terra` and `store: false`. The request contains the current system prompt, bounded history, selected saved facts when relevant, and the current user message. `src/conversation/history.ts` validates the versioned archive. New pairs enter history only after speech completes and the originating session is still current.

Both OpenAI clients use a 30-second timeout with SDK retries disabled. Connection errors (including timeouts), HTTP 429, and HTTP 5xx permit Ollama fallback. Authentication/configuration errors, incomplete OpenAI responses, and empty conversational output do not trigger fallback. OpenAI responses must have status `completed`. Local fallback requests also have 30-second abort signals; classification uses `/api/generate`, and conversation uses `/api/chat`. Classification and conversation are separate stages, so their timeouts can accumulate. These are not a single end-to-end deadline.

An obsolete conversation skips starting fallback after an OpenAI failure; existing session guards suppress stale speech/history. In-flight provider requests are not generally cancelled on barge-in. Fallback warnings identify whether classification or response generation switched providers. The local model remains less reliable at following learning preferences than the primary model.

History saves run through a serialized Promise queue using snapshots. Each save writes a unique temporary file beside the destination and renames it into place; failed writes or renames attempt temporary-file cleanup while preserving the original error. This prevents partial-file replacement during normal operation. It does not provide coordination between multiple concurrently running JARVIS instances or guaranteed durability through a power failure.

### Speech Recognition

The Swift helper in `native/audio/main.swift` captures 44.1 kHz mono Float32 microphone audio through VoiceProcessingIO. A preallocated ring buffer moves samples out of the real-time callback; a persistent converter produces 16 kHz mono signed Int16 little-endian PCM on stdout. Diagnostics and playback events use stderr. TypeScript retains WebRTC VAD, Whisper transcription, wake-word recognition, and session management. SoX provides the same PCM format when the fallback is selected.

### Speech Synthesis

Splits responses into chunks of up to 200 characters and generates audio sequentially through a Kokoro worker thread. TypeScript sends WAV paths and request IDs as newline-delimited JSON commands to the native helper's stdin. Swift loads and converts speech outside the real-time callback, then plays it through the same VoiceProcessingIO unit used for capture, providing a playback reference for echo processing. Completion and stop events settle waiting playback requests before temporary WAV files are removed.

SoX mode retains `afplay` playback. The speech wrapper uses `say` for supported failure paths; this fallback uses a separate playback path and does not have the same native interruption behavior. Native playback requests have a two-minute timeout, followed by a STOP request and a two-second acknowledgement limit. An unresponsive helper is terminated and the controller shuts down; restarting JARVIS is required.

### Intent Classification

Uses a separate OpenAI request, with Ollama fallback, to distinguish conversational messages, approved local commands, and memory actions. Output is text: local commands remain allowlisted identifiers; memory objects are JSON parsed as `unknown` and checked with `isMemoryCommand()` before routing. This is runtime validation, not API-enforced structured output. Existing memory keys help the model reuse fact names; values are not supplied to classification. Limited previous-local-command context, explicit-list shortcuts, write/delete guards, and the missing-fact recall fallback remain in place. Failed classification returns `ERROR` without executing a command.

### Explicit Memory

`src/memory/` separates types, validation, key normalization, array operations, and file storage. Version-1 memory files contain a `facts` array. Validators reject blank keys/values and duplicate normalized keys. The controller loads facts before audio startup, serializes changes through `memoryUpdateQueue`, and calculates each update from the latest committed facts. `saveMemoryFile()` validates before filesystem changes, writes a unique same-directory temporary file, and renames it over the destination. Active memory changes only after the save succeeds.

Recall and listing wait for pending updates and do not save. Forgetting removes only the targeted normalized key. Memory command exchanges use their own controller branch and are not appended to the conversation-history archive. As with history storage, file replacement does not coordinate multiple independent JARVIS processes or guarantee durability through power loss.

### System Integration

Executes approved actions through macOS utilities and AppleScript, including application launch, battery status, and Apple Music playback controls.

## Development Roadmap

- [x] Establish local LLM communication.
- [x] Implement voice conversations with terminal feedback.
- [x] Maintain conversation history.
- [x] Persist completed exchanges across restarts, bound model context, and add session-only and history-clearing controls.
- [x] Implement text-to-speech.
- [x] Capture microphone audio.
- [x] Integrate speech transcription.
- [x] Integrate voice activity detection and wake-word activation.
- [x] Implement command classification with limited conversational context.
- [x] Support approved macOS application controls.
- [x] Retrieve time, date, and battery information.
- [x] Add study music and Apple Music playback commands.
- [x] Add worker-based Kokoro synthesis, text chunking, and speech interruption.
- [x] Integrate native VoiceProcessingIO capture and Kokoro playback, with PCM streaming and a manual SoX fallback.
- [ ] Improve wake-word reliability, failure recovery, and shutdown handling.
- [ ] Improve conversational voice interaction.
- [x] Add a separate explicit fact store with remember, update, recall, review, and targeted forgetting.
- [x] Use selected saved facts as bounded context in general conversation.
- [x] Rank memory by current-request relevance, pack the context budget, normalize spelling aliases, and support bounded follow-ups with regression tests.
- [x] Add OpenAI classification and conversation with validated routing and local Ollama fallback.
- [ ] Integrate Arduino-based hardware.
- [ ] Explore custom model fine-tuning and training.

## Project Vision

The ultimate vision is to create a JARVIS-inspired AI system that extends beyond a traditional chatbot.

Future iterations may combine:

- **Intelligence:** Conversational reasoning and contextual understanding.
- **Voice:** Natural, responsive spoken interactions.
- **Automation:** Practical control over desktop applications and workflows.
- **Memory:** Persistent knowledge and contextual awareness.
- **Hardware:** Communication with physical devices and custom displays.
- **Custom AI:** Experimentation with training and fine-tuning personally developed models.

The project is intended to evolve alongside my knowledge of software engineering, machine learning, and embedded systems.

## Security and Privacy

JARVIS uses a hybrid local/cloud architecture.

- Primary classification sends the classification prompt, current utterance, known memory keys, and relevant previous-command context to OpenAI. Conversation sends the current system prompt, bounded recent exchanges, selected relevant fact values, and the current utterance.
- `store: false` is set on Responses API requests; it does not make inference local or establish a blanket zero-retention guarantee.
- Local fallback inference is handled through Ollama. It is availability fallback, not a selectable offline-only mode; primary requests still try OpenAI first.
- Whisper transcription and default Kokoro speech synthesis run locally after model downloads.
- The optional ElevenLabs integration sends text to an external service when enabled.
- Sensitive configuration files and credentials should not be committed.
- Saved history and facts remain local JSON files under Git-ignored `data/`; Git exclusion does not encrypt them.
- Microphone recordings and generated audio should remain excluded from version control unless explicitly intended as test assets.
- Operating-system commands should be validated before execution.
- Future automation capabilities should use explicit permissions and appropriate safety checks.

## Project Status

**Active Development**

Milestone 9 native audio validation includes intelligible streamed audio, Whisper transcription, repeated wake-word interruption, silent-listening trials without reported self-activation, fallback operation, shutdown during speech, unexpected helper-exit cleanup, and acknowledged playback-timeout recovery. Missing STOP acknowledgement and forced termination were checked with simulated timers; echo suppression has not yet been quantitatively measured for production Kokoro playback.

Milestone 10 history validation includes recall after restart, omission of interrupted exchanges and local commands, preservation of rejected history files, session-only operation without changing the saved file, and live session/persistent clearing. Isolated checks cover queued save ordering, snapshots, save-failure handling, atomic replacement cleanup, schema validation, and startup/runtime context limits. TypeScript and native audio self-tests passed at closeout. That milestone established conversation-history persistence rather than a separate fact store.

Milestone 11 adds explicit fact storage. Live tests verified remembering, recall after restart, listing, update without duplication, persistent forgetting, missing-fact responses, independence from conversation-history clearing, and refusal to overwrite an unsupported memory-file version. Isolated checks cover validation, command guards, parsing, queued updates, persistence failure, and temporary-file cleanup. The small model produced inconsistent list and missing-fact classifications during development; the documented code-level shortcuts, guards, and recall fallback were added in response. Arbitrary wording and semantic key matching remain model-dependent. TypeScript and whitespace checks pass; isolated memory checks are not yet a committed automated test suite.

Milestone 12 adds bounded, request-specific memory context and OpenAI primary classification/conversation with local fallback. User-run tests verified relevant personalization, saved learning-preference use and an explicit solution override, updated and forgotten facts across restarts, preservation of other facts, and interruption. Both primary paths worked with Ollama stopped. Separate injected connection failures exercised classification and conversation fallback; the injections and diagnostic prompt were removed. A saved instruction-attempt phrase was discussed as data without changing identity in the tested case. TypeScript and whitespace checks passed. Local fallback still has weaker instruction following; keyword retrieval and prompt boundaries are not general semantic or security guarantees. Timeout and incomplete-response guards were reviewed, but live timeout-expiry and incomplete-response failure cases were not separately exercised.

Milestone 13 improves retrieval with current-request-first scoring, stable ties, skip-and-continue budget packing, spelling aliases, broader teaching cues, and limited previous-request context. Live trials verified a rover-color follow-up, a switch to teaching promises without rover references, and conversational continuity on a later promises follow-up. Isolated integration checks separately verified the request-only memory snapshot. A crowded-memory edge case initially excluded the answer behind ten old-subject matches; revised scoring fixes it and has a regression test. All 15 `npm test` cases, TypeScript, and whitespace checks pass. General semantic retrieval and multi-turn subject tracking remain future work.

JARVIS is an ongoing personal project. Features, architecture, and dependencies may change as development progresses.

## Author

Developed by [duzinhoml](https://github.com/duzinhoml).

Computer Science student and aspiring software engineer with an interest in artificial intelligence, full-stack development, and embedded systems.

## Disclaimer

This is an independent, fan-inspired personal project and is not affiliated with, endorsed by, or sponsored by Marvel Studios or Disney.

---

**"Just a rather very intelligent system."**
