# NIRMAN Agentic Studio (NIRMAN IDE)

> **AI-native, privacy-first software development studio powered by local LLMs with full NVIDIA GPU offload, built on Code-OSS.**

---

## Overview

**NIRMAN Agentic Studio** is an autonomous software development environment designed to run completely on your local machine. It combines a standalone, rebranded **Code-OSS** (MIT) IDE with an autonomous multi-agent core and a local inference backend (`llama-server`) running **Qwen2.5-Coder-7B-Instruct** with full GPU acceleration on NVIDIA RTX GPUs.

### Key Capabilities

* **100% Local & Private:** No API keys, no telemetry, no cloud dependencies. Your code, prompts, and git history never leave your machine.
* **Full GPU Offload:** Automatically offloads all 29 transformer layers to NVIDIA VRAM using CUDA 13/12 backends (~51 tokens/second on an RTX 5050 Laptop GPU).
* **Standalone Desktop Application:** Rebranded Code-OSS IDE with custom identity, vendor-neutral **Open VSX** marketplace, and built-in NIRMAN Agent activity bar.
* **Structured Agent Loop:**
  * **Planning Phase:** Interactive requirements clarification with ambiguity scoring, emitting structured `plan.md` and `SPEC.md`.
  * **Approval Gate:** Human-in-the-loop review to approve, edit, revise, or reject plans before execution begins.
  * **Execution Phase:** Focused per-task context, deterministic verification commands, git-based unified diffs (`diff.patch`), and smart error repair loops.
* **Multi-Agent Orchestration:** Agent Manager dashboard (`Ctrl+Alt+M`) to launch, monitor, pause, resume, and cancel concurrent agents across isolated git worktrees.
* **Clean Lifecycle & VRAM Release:** Automatic crash recovery and graceful teardown that terminates background processes and restores GPU VRAM to baseline on exit.

---

## Architecture

NIRMAN is organized as a strict TypeScript monorepo managed with `pnpm`:

```text
NIRMAN/
├── apps/
│   ├── cli/            # Terminal CLI front end (`nirman run "<prompt>"`)
│   ├── ide-fork/       # Standalone Code-OSS fork configuration & Open VSX client
│   └── vscode-ext/     # NIRMAN IDE UI (Chat, Plan, Tasks, Diff Review, Agent Manager)
├── packages/
│   ├── model/          # OpenAI-compatible streaming client with fallback tool calling
│   ├── sandbox/        # Host and Docker isolated sandboxes with strict path safety
│   ├── tools/          # Sandboxed filesystem & terminal execution tools
│   ├── core/           # Agent loop, AST symbol extraction, repo index & hybrid retrieval
│   ├── artifacts/      # File-based run artifacts (.agent/runs/<run-id>/*)
│   ├── security/       # Policy enforcement, secret encryption & SHA-256 audit log
│   ├── browser/        # Playwright headless browser driver for web app verification
│   ├── deploy/         # Deployment adapters (Docker, PaaS) with preview approvals
│   └── server/         # WebSocket / JSON-RPC 2.0 local daemon
├── scripts/            # Install, launch, stop, measure-startup, and test suite
└── docs/               # Architecture, progress, and clean-profile testing docs
```

---

## System Requirements

* **Operating System:** Windows 10 / Windows 11 (64-bit)
* **GPU:** NVIDIA GeForce RTX 30/40/50 Series (minimum 6 GB VRAM; 8 GB recommended for 32k context)
* **NVIDIA Driver:** Game Ready or Studio Driver version 550.0+ (CUDA 12.8+ / 13.0+ compatible)
* **Node.js:** v20.0.0 or higher
* **Package Manager:** `pnpm` (v9+)
* **Disk Space:** ~15 GB free space (model weights + Code-OSS IDE distribution)

> [!NOTE]
> NIRMAN must run from a standard local directory (such as `C:\Dev\Nirman` and `C:\Tools\nirman`). Running from or storing projects in cloud-synced folders (like OneDrive or Dropbox) is blocked to prevent database locking and binary corruption.

---

## Quick Start (1-Click Install)

### 1. Clone the Repository

```powershell
git clone https://github.com/avikengineer007/NIRMAN_IDE.git C:\Dev\Nirman
cd C:\Dev\Nirman
```

### 2. Run Preflight Prerequisites Check

```powershell
powershell -ExecutionPolicy Bypass -File scripts\preflight.ps1
```

This inspects your NVIDIA GPU, driver version, Node.js version, disk space, and path hygiene, printing a clear pass/fail summary.

### 3. Run the Automated Installer

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

The installer will:
1. Verify system prerequisites and environment paths.
2. Build the TypeScript packages and bundle `@nirman/vscode-ext`.
3. Set up `C:\Tools\nirman\` with `llama-server`, the CUDA 13/12 backend DLLs, and the standalone IDE.
4. Verify or download the quantized `Qwen2.5-Coder-7B-Instruct` model (`q4_k_m.gguf`).
5. Create default projects workspace directory at `C:\Projects\`.
6. Place a branded **NIRMAN Agentic Studio** shortcut on your Windows Desktop.

---

## How to Use NIRMAN IDE

### Launching the Studio

Double-click the **NIRMAN Agentic Studio** shortcut on your Desktop, or run:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Tools\nirman\start.ps1
```

The launcher executes the following startup sequence:
1. **Application Lock:** Acquires a lock to prevent conflicting duplicate instances.
2. **GPU Model Server:** Spawns `llama-server` on `127.0.0.1:8080`, offloads all 29 layers to your NVIDIA GPU, and verifies readiness via `/health`.
3. **Agent Daemon:** Starts the background agent server on `127.0.0.1:4096` with a secure per-session token.
4. **Studio Window:** Opens the standalone Code-OSS IDE initialized to `C:\Projects\`.

### Working with the Agent

1. **Open the Agent Activity Bar:** Click the NIRMAN logo on the left Activity Bar (or press `Ctrl+Alt+M`).
2. **Describe Your Task:** Enter what you want to build in the **Chat & Planner** panel.
3. **Review the Plan:** The agent drafts a step-by-step implementation plan. Inspect the tasks and requirements, then click **Approve Plan** (or leave feedback for revision).
4. **Watch Execution:** Tasks are executed inside an isolated sandbox. Files appear in your workspace in real-time, accompanied by git diffs in the **Tasks & Execution** view.
5. **Verify:** When all tasks pass deterministic verification commands, the agent presents a final walkthrough.

### Exiting and Releasing GPU Memory

Simply close the NIRMAN IDE window. The launcher will automatically:
* Terminate the agent daemon and `llama-server`.
* Release all VRAM back to your GPU baseline.
* Remove the session lock file.

To manually stop all NIRMAN processes at any time:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Tools\nirman\stop.ps1
```

---

## CLI-Only Mode

If you prefer operating from the terminal without opening the graphical studio:

```powershell
cd C:\Dev\Nirman
pnpm --filter @nirman/cli start run "Create a REST API with Express in C:\Projects\my-api"
```

---

## Verification & Automated Test Suite

All components are rigorously tested with automated unit, integration, and model-driven tests:

```powershell
# Run all unit tests across the monorepo
pnpm test

# Run the launcher, GPU verification, crash recovery, and E2E model test suite
npx vitest run scripts/
```

### Verified Hardening Guarantees

* **GPU Evidence Enforcement:** The launcher parses `llama-server` stdout for `using device CUDA0` and `offloaded 29/29 layers to GPU`. Silent fallback to CPU is blocked unless `-AllowCpu` is explicitly provided.
* **Double Launch Prevention:** Launch attempts while an instance is running are rejected with exit code `2` and bring the existing window to the foreground.
* **Crash Recovery:** If processes are orphaned by an unexpected shutdown, the launcher cleans them up safely on next boot without touching unrelated system processes.
* **Path Hygiene:** Enforces zero hardcoded user profiles and fail-fast validation against cloud-synced folders.

---

## License

* **NIRMAN Core & Studio:** Licensed under the [MIT License](LICENSE).
* **Code-OSS:** Microsoft Code-OSS source licensed under the [MIT License](docs/THIRD_PARTY_LICENSES.md).
* **llama.cpp:** Licensed under the [MIT License](docs/THIRD_PARTY_LICENSES.md).
* **Qwen2.5-Coder Model:** Weights licensed under the [Apache 2.0 License](https://github.com/QwenLM/Qwen2.5-Coder).
