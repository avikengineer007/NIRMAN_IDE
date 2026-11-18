# Third-Party Software Notices and Licenses

NIRMAN Agentic Studio bundles or interacts with several third-party open-source components. This document lists each component, its license, and upstream repository or model card.

## 1. Bundled Runtime Components

| Component | Upstream Project | License | Source / Reference URL |
| :--- | :--- | :--- | :--- |
| **Code-OSS** | Microsoft VS Code Core | MIT License | https://github.com/microsoft/vscode |
| **llama.cpp / llama-server** | Georgi Gerganov & Contributors | MIT License | https://github.com/ggerganov/llama.cpp |
| **Qwen2.5-Coder-7B-Instruct** | Alibaba Cloud Qwen Team | Apache 2.0 | https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct |

## 2. Direct Node.js / NPM Dependencies

The following direct dependencies are used across packages and apps in the NIRMAN workspace:

| Package | Purpose | Declared License | Project URL |
| :--- | :--- | :--- | :--- |
| **ws** | WebSocket server & client communication | MIT | https://github.com/websockets/ws |
| **sqlite3** | Embedded database storage | BSD-3-Clause | https://github.com/TryGhost/node-sqlite3 |
| **better-sqlite3** | Synchronous embedded database | MIT | https://github.com/WiseLibs/better-sqlite3 |
| **diff** | Patch generation and text diffing | BSD-3-Clause | https://github.com/kpdecker/jsdiff |
| **zod** | Schema validation | MIT | https://github.com/colinhacks/zod |
| **typescript** | Static typing | Apache-2.0 | https://github.com/microsoft/TypeScript |
| **vitest** | Test execution framework | MIT | https://github.com/vitest-dev/vitest |
| **eslint** | Code analysis and linting | MIT | https://github.com/eslint/eslint |
| **playwright-core** | Headless browser execution | Apache-2.0 | https://github.com/microsoft/playwright |

## 3. License Copies and Redistribution

Each bundled third-party binary or dependency retains its original copyright notice and license. Complete upstream source code is accessible at the reference URLs provided above.
