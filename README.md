# JARVIS AI Assistant

A voice-enabled, locally powered AI desktop assistant built with **TypeScript**, **Node.js**, and **Ollama** for macOS.

Inspired by Tony Stark's J.A.R.V.I.S. from the Iron Man films, this project aims to develop an intelligent, conversational assistant capable of understanding natural language, responding through speech, interacting with the operating system, and eventually integrating with physical hardware.

## Overview

JARVIS is a personal software engineering and artificial intelligence project focused on building a modular, extensible desktop assistant.

Rather than relying entirely on cloud-based AI services, JARVIS uses locally hosted language models and speech-processing tools to support private, customizable interactions.

The long-term goal is to develop an increasingly autonomous assistant with contextual memory, advanced computer interaction, hardware integration, and eventually a custom-trained AI model.

## Features

### Implemented

- **Local AI Conversations:** Generate responses using locally hosted language models through Ollama.
- **Voice Activation:** Begin requests with “Jarvis,” “Hey Jarvis,” or “Hi Jarvis,” detected through local Whisper transcription.
- **Terminal Feedback:** Display listening states, transcriptions, responses, and errors in the terminal.
- **Text-to-Speech:** Generate spoken responses locally using Kokoro in a worker thread, with chunked playback through native VoiceProcessingIO. SoX mode uses macOS `afplay`; supported speech failures fall back to `say`.
- **Speech Interruption:** Detect the wake word during Kokoro speech to interrupt playback and begin a new request.
- **Speech Recording:** Capture microphone input through native VoiceProcessingIO and stream 16 kHz mono Int16 PCM to TypeScript, with SoX available as a manual fallback.
- **Speech Recognition:** Transcribe recorded audio using Whisper.
- **Voice Activity Detection (VAD):** Detect speech and silence with WebRTC VAD and use listening timeouts to process requests.
- **Intent Classification:** Route natural-language requests to approved commands, with limited context from the previous command.
- **macOS Integration:** Open Safari, Chrome, Visual Studio Code, and Finder. Retrieve the current time, date, and battery status.
- **Music Commands:** Open a configured study playlist in Chrome and pause or resume Apple Music when explicitly named.
- **Conversation History:** Save completed conversational exchanges locally and restore recent context across restarts, with session-only mode and an explicit history-clearing command.
- **Assistant Personality:** Custom system instructions define JARVIS's conversational behavior.
- **Error Handling:** Handle model execution failures and other runtime errors.

### In Development

- **Wake-Word Reliability:** Improve activation accuracy and handling of requests that repeat the assistant’s name.
- **Voice Session Recovery:** Improve microphone failure cleanup, worker shutdown, and speech fallback behavior.
- **Command Reliability:** Refine intent classification and contextual follow-up handling.
- **Speech Latency:** Improve response times and interruption handling.
- **Echo Processing:** Quantitatively measure echo suppression across playback volumes and listening environments.

### Planned

- Long-term memory for selected facts and preferences beyond recent conversation history.
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
| Ollama       | Local LLM execution                 |
| Qwen         | Local conversational language model |
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
- Ollama
- SoX
- Whisper.cpp
- A working microphone with access granted to the terminal or IDE
- Internet access for initial model downloads

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

Ensure Ollama is running at `http://localhost:11434`, then pull the model used for conversations and intent classification:

```bash
ollama pull qwen3:1.7b
```

**4. Install audio dependencies**

Using Homebrew:

```bash
brew install sox whisper-cpp
```

Download the Whisper English base model and place it at `models/ggml-base.en.bin`. Ensure `swift`, `sox`, and `whisper-cli` are available on your `PATH`.

**5. Configure the application**

Ensure executable paths and model locations match your system. The default voice flow does not require API keys.

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

Say **“Jarvis, clear my conversation history”** to reset current context and attempt to persist empty history. The system prompt is preserved. In session-only mode, or if persistence was disabled after an error, this clears memory without changing saved history; the spoken response distinguishes that outcome from a confirmed full clear. Clearing history does not remove independently created backup copies.

The model receives at most the **10 most recent completed turns**, trimmed further to **6,000 JavaScript string-length units** of historical message text. Complete oldest pairs are removed first. These limits apply at startup and during the session; the saved archive retains all completed turns until explicitly cleared. The system prompt and current request are outside the historical-text budget, which is not a model-token limit.

If a history file is missing, JARVIS starts with empty history. If loading or saving fails, it reports the error and disables persistence for that session. A failed load is not automatically overwritten with empty history.

Apple Music controls require an explicit target, such as “Jarvis, pause Apple Music.” They do not control the YouTube study playlist or other players.

To check types without compiling, run `npx tsc --noEmit`. The `npm test` script is currently a placeholder. The native helper also provides offline self-tests that do not start microphone capture or speaker playback:

```bash
swift native/audio/main.swift --test-streaming-buffer
swift native/audio/main.swift --test-converter
swift native/audio/main.swift --test-playback
```

## Architecture

JARVIS is being developed around several core responsibilities:

### Conversational AI

Processes natural-language input, manages recent conversational context, and generates responses using a locally hosted language model. `src/conversation/history.ts` validates a versioned JSON archive and selects bounded context. The controller restores user/assistant pairs after the current system prompt. New pairs enter history only after speech completes and the originating session is still current.

History saves run through a serialized Promise queue using snapshots. Each save writes a unique temporary file beside the destination and renames it into place; failed writes or renames attempt temporary-file cleanup while preserving the original error. This prevents partial-file replacement during normal operation. It does not provide coordination between multiple concurrently running JARVIS instances or guaranteed durability through a power failure.

### Speech Recognition

The Swift helper in `native/audio/main.swift` captures 44.1 kHz mono Float32 microphone audio through VoiceProcessingIO. A preallocated ring buffer moves samples out of the real-time callback; a persistent converter produces 16 kHz mono signed Int16 little-endian PCM on stdout. Diagnostics and playback events use stderr. TypeScript retains WebRTC VAD, Whisper transcription, wake-word recognition, and session management. SoX provides the same PCM format when the fallback is selected.

### Speech Synthesis

Splits responses into chunks of up to 200 characters and generates audio sequentially through a Kokoro worker thread. TypeScript sends WAV paths and request IDs as newline-delimited JSON commands to the native helper's stdin. Swift loads and converts speech outside the real-time callback, then plays it through the same VoiceProcessingIO unit used for capture, providing a playback reference for echo processing. Completion and stop events settle waiting playback requests before temporary WAV files are removed.

SoX mode retains `afplay` playback. The speech wrapper uses `say` for supported failure paths; this fallback uses a separate playback path and does not have the same native interruption behavior. Native playback requests have a two-minute timeout, followed by a STOP request and a two-second acknowledgement limit. An unresponsive helper is terminated and the controller shuts down; restarting JARVIS is required.

### Intent Classification

Uses a separate Ollama prompt to distinguish conversational messages from approved local commands. Limited previous-command context supports related follow-up requests.

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
- [ ] Extend conversation history with long-term memory for selected facts and preferences.
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

JARVIS is designed primarily for local execution.

- Local language model inference is handled through Ollama.
- Whisper transcription and default Kokoro speech synthesis run locally after model downloads.
- The optional ElevenLabs integration sends text to an external service when enabled.
- Sensitive configuration files and credentials should not be committed.
- Microphone recordings and generated audio should remain excluded from version control unless explicitly intended as test assets.
- Operating-system commands should be validated before execution.
- Future automation capabilities should use explicit permissions and appropriate safety checks.

## Project Status

**Active Development**

Milestone 9 native audio validation includes intelligible streamed audio, Whisper transcription, repeated wake-word interruption, silent-listening trials without reported self-activation, fallback operation, shutdown during speech, unexpected helper-exit cleanup, and acknowledged playback-timeout recovery. Missing STOP acknowledgement and forced termination were checked with simulated timers; echo suppression has not yet been quantitatively measured for production Kokoro playback.

Milestone 10 history validation includes recall after restart, omission of interrupted exchanges and local commands, preservation of rejected history files, session-only operation without changing the saved file, and live session/persistent clearing. Isolated checks cover queued save ordering, snapshots, save-failure handling, atomic replacement cleanup, schema validation, and startup/runtime context limits. TypeScript and native audio self-tests pass. This is conversation-history persistence; automatic extraction or retrieval of long-term facts is not implemented.

JARVIS is an ongoing personal project. Features, architecture, and dependencies may change as development progresses.

## Author

Developed by [duzinhoml](https://github.com/duzinhoml).

Computer Science student and aspiring software engineer with an interest in artificial intelligence, full-stack development, and embedded systems.

## Disclaimer

This is an independent, fan-inspired personal project and is not affiliated with, endorsed by, or sponsored by Marvel Studios or Disney.

---

**"Just a rather very intelligent system."**
