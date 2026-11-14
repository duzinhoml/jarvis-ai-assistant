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
- **Text-to-Speech:** Generate spoken responses locally using Kokoro in a worker thread, with chunked playback through macOS `afplay` and `say` fallback for supported error paths.
- **Speech Interruption:** Detect the wake word during Kokoro speech to interrupt playback and begin a new request.
- **Speech Recording:** Capture microphone input using SoX.
- **Speech Recognition:** Transcribe recorded audio using Whisper.
- **Voice Activity Detection (VAD):** Detect speech and silence with WebRTC VAD and use listening timeouts to process requests.
- **Intent Classification:** Route natural-language requests to approved commands, with limited context from the previous command.
- **macOS Integration:** Open Safari, Chrome, Visual Studio Code, and Finder. Retrieve the current time, date, and battery status.
- **Music Commands:** Open a configured study playlist in Chrome and pause or resume Apple Music when explicitly named.
- **Conversation History:** Maintain context across messages within a session.
- **Assistant Personality:** Custom system instructions define JARVIS's conversational behavior.
- **Error Handling:** Handle model execution failures and other runtime errors.

### In Development

- **Wake-Word Reliability:** Improve activation accuracy and handling of requests that repeat the assistant’s name.
- **Voice Session Recovery:** Improve microphone failure cleanup, worker shutdown, and speech fallback behavior.
- **Command Reliability:** Refine intent classification and contextual follow-up handling.
- **Speech Latency:** Improve response times and interruption handling.

### Planned

- Persistent conversational memory.
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
| SoX          | Audio recording and processing      |
| Kokoro / ONNX | Local speech synthesis in a worker thread |
| macOS `afplay` / `say` | Audio playback and fallback speech |
| macOS utilities / AppleScript | Application, battery, and Music controls |
| WebRTC VAD   | Voice activity detection            |
| Git & GitHub | Version control                     |

## Getting Started

### Prerequisites

- macOS
- Node.js and npm
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

Download the Whisper English base model and place it at `models/ggml-base.en.bin`. Ensure `rec` and `whisper-cli` are available on your `PATH`.

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

Compile before the first run and after changes to the Kokoro worker: the application loads the worker from `dist/tts/kokoroWorker.js`.

Say “Jarvis” followed by a request, such as “Jarvis, open Safari” or “Jarvis, what time is it?” Say “Jarvis, stop” to interrupt Kokoro speech. Press **Ctrl+C** to request shutdown.

Apple Music controls require an explicit target, such as “Jarvis, pause Apple Music.” They do not control the YouTube study playlist or other players.

To check types without compiling, run `npx tsc --noEmit`. The `npm test` script is currently a placeholder; automated tests are not configured.

## Architecture

JARVIS is being developed around several core responsibilities:

### Conversational AI

Processes natural-language input, manages session history, and generates responses using a locally hosted language model.

### Speech Recognition

Captures microphone input using SoX, detects voice activity with WebRTC VAD, and transcribes wake-word snapshots and command recordings using Whisper.cpp.

### Speech Synthesis

Splits responses into chunks of up to 200 characters and generates audio sequentially through a Kokoro worker thread. Plays temporary WAV files using macOS `afplay` and removes them after use. The speech wrapper uses `say` for supported failure paths.

### Intent Classification

Uses a separate Ollama prompt to distinguish conversational messages from approved local commands. Limited previous-command context supports related follow-up requests.

### System Integration

Executes approved actions through macOS utilities and AppleScript, including application launch, battery status, and Apple Music playback controls.

## Development Roadmap

- [x] Establish local LLM communication.
- [x] Implement voice conversations with terminal feedback.
- [x] Maintain conversation history.
- [x] Implement text-to-speech.
- [x] Capture microphone audio.
- [x] Integrate speech transcription.
- [x] Integrate voice activity detection and wake-word activation.
- [x] Implement command classification with limited conversational context.
- [x] Support approved macOS application controls.
- [x] Retrieve time, date, and battery information.
- [x] Add study music and Apple Music playback commands.
- [x] Add worker-based Kokoro synthesis, text chunking, and speech interruption.
- [ ] Improve wake-word reliability, failure recovery, and shutdown handling.
- [ ] Improve conversational voice interaction.
- [ ] Implement persistent memory.
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

JARVIS is an ongoing personal project. Features, architecture, and dependencies may change as development progresses.

## Author

Developed by [duzinhoml](https://github.com/duzinhoml).

Computer Science student and aspiring software engineer with an interest in artificial intelligence, full-stack development, and embedded systems.

## Disclaimer

This is an independent, fan-inspired personal project and is not affiliated with, endorsed by, or sponsored by Marvel Studios or Disney.

---

**"Just a rather very intelligent system."**
