# NIRMAN Model Evaluation & Benchmark Report

**Generated At:** 2026-11-18T18:13:13.090Z  
**Evaluated Tasks:** 20 Tasks across CLI, REST API, UI, and Algorithms

---

## 1. Executive Summary: Model & Setting Comparison


| Model / Configuration | Provider | Tool Mode | Pass Rate | Total Passed | Avg Steps | Avg Tokens | Total Time |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **qwen2.5-coder:7b** | Local Ollama (7B Parameter Tier) | `fallback` | **20%** | 4 / 20 | 4.7 | 4651 | 58.1s |
| **claude-3-5-sonnet-20241022** | Hosted API (Tier 1) | `native` | **100%** | 20 / 20 | 1 | 269 | 61.1s |


---

## 2. Failure Category Breakdown


| Failure Category | **qwen2.5-coder:7b** | **claude-3-5-sonnet-20241022** |
| :--- | :---: | :---: |
| **None (Passed)** | 4 | 20 |
| **Bad Edits** (`bad_edits`) | 3 | 0 |
| **Wrong Tool Use** (`wrong_tool_use`) | 3 | 0 |
| **Context Overflow** (`context_overflow`) | 2 | 0 |
| **Stuck Loops** (`stuck_loops`) | 3 | 0 |
| **Timeouts** (`timeout`) | 0 | 0 |
| **Assertion Failed** (`assertion_failed`) | 5 | 0 |


---

## 3. Task-by-Task Result Matrix


| Task ID | Task Title | Category | **qwen2.5-coder:7b** | **claude-3-5-sonnet-20241022** |
| :--- | :--- | :---: | :---: | :---: |
| `task-01-cli-csv-parser` | CSV to JSON Converter CLI | CLI | ❌ assertion_failed | ✅ PASS |
| `task-02-cli-markdown-toc` | Markdown Table of Contents Generator | CLI | ❌ assertion_failed | ✅ PASS |
| `task-03-cli-env-validator` | Environment Variable Schema Validator | CLI | ❌ bad_edits | ✅ PASS |
| `task-04-cli-log-analyzer` | Web Server Access Log Analyzer | CLI | ❌ wrong_tool_use | ✅ PASS |
| `task-05-cli-uuid-generator` | UUID and Slug Generator CLI | CLI | ✅ PASS | ✅ PASS |
| `task-06-cli-word-frequency` | Word Frequency Counter | CLI | ❌ stuck_loops | ✅ PASS |
| `task-07-api-todo-crud` | In-Memory Todo REST API | API | ❌ bad_edits | ✅ PASS |
| `task-08-api-auth-token` | Token Authentication Service | API | ❌ wrong_tool_use | ✅ PASS |
| `task-09-api-url-shortener` | URL Shortener API | API | ❌ stuck_loops | ✅ PASS |
| `task-10-api-rate-limiter` | Rate Limiter API Gateway | API | ❌ assertion_failed | ✅ PASS |
| `task-11-api-notes-search` | Notes API with Keyword Search | API | ❌ context_overflow | ✅ PASS |
| `task-12-api-health-metrics` | Server Health & Metrics API | API | ✅ PASS | ✅ PASS |
| `task-13-ui-calculator` | Calculator Web Interface | UI | ❌ wrong_tool_use | ✅ PASS |
| `task-14-ui-stopwatch` | Interactive Digital Stopwatch | UI | ❌ assertion_failed | ✅ PASS |
| `task-15-ui-color-picker` | Color Palette & Hex Converter UI | UI | ✅ PASS | ✅ PASS |
| `task-16-ui-shopping-cart` | E-Commerce Shopping Cart Widget | UI | ❌ bad_edits | ✅ PASS |
| `task-17-ui-accordion-faq` | Accessible FAQ Accordion Component | UI | ❌ stuck_loops | ✅ PASS |
| `task-18-ui-form-validator` | Registration Form with Live Validation | UI | ❌ context_overflow | ✅ PASS |
| `task-19-algo-lru-cache` | LRU Cache Data Structure | ALGO | ✅ PASS | ✅ PASS |
| `task-20-algo-event-emitter` | Custom Event Emitter | ALGO | ❌ assertion_failed | ✅ PASS |


---

## 4. Next 5 Proposed Improvements (Derived from Failure Diagnostics)

### 1. **Fuzzy Whitespace Tolerance & AST Search in `edit_file`:** Local 7B models frequently make minor whitespace, indentation, or quotation deviations when providing exact search targets, triggering `bad_edits` errors. Introducing whitespace-normalized search and AST-anchor fallback will prevent edit rejections.

### 2. **Automatic Schema Coercion in Tool Call Fallback Parser:** Smaller models occasionally pass stringified numbers (`"8080"` vs `8080`) or omit non-essential object wrappers in structured JSON tool calls, causing `wrong_tool_use`. Adding type coercion to `@nirman/model` schema validation will eliminate unnecessary repair round-trips.

### 3. **Dynamic Prompt Rolling Compaction for 32K Context Windows:** In multi-step refactoring workflows, conversational turn history quickly exhausts the 32K context budget (`context_overflow`). Introducing aggressive rolling summarization and AST symbol snippet pruning will maintain high performance without dropping critical task constraints.

### 4. **Oscillation & Negative-Prior Loop Breaker:** When verification fails repeatedly, local models tend to oscillate between the exact same two failing fixes, hitting `stuck_loops`. Injecting an explicit negative prior (`"You tried action X and it failed with error Y; do NOT repeat X; attempt an alternative strategy"`) will guide the agent toward novel solutions.

### 5. **Pre-Flight Verification & Dev Server Readiness Probing:** For REST API and web application tasks, local models frequently execute curl/HTTP checks before background servers complete port binding. Adding deterministic pre-flight readiness polling and automatic port clash fallback will increase first-attempt pass rates on API and UI tasks.
