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
- **Text-Based Interaction:** Communicate with JARVIS through an interactive terminal interface.
- **Text-to-Speech:** Generate spoken responses using macOS speech synthesis.
- **Speech Recording:** Capture microphone input using SoX.
- **Speech Recognition:** Transcribe recorded audio using Whisper.
- **Conversation History:** Maintain context across messages within a session.
- **Assistant Personality:** Custom system instructions define JARVIS's conversational behavior.
- **Error Handling:** Handle model execution failures and other runtime errors.

### In Development

- **Voice Activity Detection (VAD):** Detect speech and silence to improve recording efficiency.
- **Intent Classification:** Identify actionable commands from natural language.
- **macOS Integration:** Interact with applications and retrieve system information.
- **Voice-Driven Commands:** Execute supported desktop operations through spoken instructions.

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
| macOS `say`  | Text-to-speech synthesis            |
| WebRTC VAD   | Voice activity detection            |
| Git & GitHub | Version control                     |

## Getting Started

### Prerequisites

- macOS
- Node.js and npm
- Ollama
- SoX
- Whisper.cpp
- A working microphone

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

Pull the local language model:

```bash
ollama pull qwen3:1.7b
```

**4. Install audio dependencies**

Using Homebrew:

```bash
brew install sox whisper-cpp
```

Download a compatible Whisper model and configure its path according to your local setup.

**5. Configure the application**

Ensure any required executable paths, model locations, and environment variables match your system.

**6. Run JARVIS**

Use the development or start script defined in `package.json`.

## Architecture

JARVIS is being developed around several core responsibilities:

### Conversational AI

Processes natural-language input, manages session history, and generates responses using a locally hosted language model.

### Speech Recognition

Captures microphone input, detects voice activity, and converts speech into text.

### Speech Synthesis

Transforms generated responses into audible speech using macOS text-to-speech capabilities.

### Intent Classification

Distinguishes conversational messages from commands that require interaction with the operating system.

### System Integration

Provides controlled access to supported macOS applications and system information.

## Development Roadmap

- [x] Establish local LLM communication.
- [x] Implement terminal-based conversations.
- [x] Maintain conversation history.
- [x] Implement text-to-speech.
- [x] Capture microphone audio.
- [x] Integrate speech transcription.
- [ ] Finalize voice activity detection.
- [ ] Implement reliable command classification.
- [ ] Support macOS application control.
- [ ] Retrieve system information.
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
