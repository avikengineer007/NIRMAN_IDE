# NIRMAN Model Evaluation & Benchmark Report

**Generated At:** 2026-11-19T14:54:25.940Z  
**Evaluated Tasks:** 20 Tasks across CLI, REST API, UI, and Algorithms

---

## 1. Executive Summary: Model & Setting Comparison


| Model / Configuration | Provider | Tool Mode | Pass Rate | Total Passed | Avg Steps | Avg Tokens | Total Time |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **qwen2.5-coder-7b-instruct-q4_k_m** | Local llama-server (baseline pre-P0) | `fallback` | **0%** | 0 / 20 | 0 | 0 | 587.6s |


---

## 2. Failure Category Breakdown


| Failure Category | **qwen2.5-coder-7b-instruct-q4_k_m** |
| :--- | :---: |
| **None (Passed)** | 0 |
| **Bad Edits** (`bad_edits`) | 0 |
| **Wrong Tool Use** (`wrong_tool_use`) | 0 |
| **Context Overflow** (`context_overflow`) | 0 |
| **Stuck Loops** (`stuck_loops`) | 0 |
| **Timeouts** (`timeout`) | 0 |
| **Assertion Failed** (`assertion_failed`) | 20 |


---

## 3. Task-by-Task Result Matrix


| Task ID | Task Title | Category | **qwen2.5-coder-7b-instruct-q4_k_m** |
| :--- | :--- | :---: | :---: |
| `task-01-cli-csv-parser` | CSV to JSON Converter CLI | CLI | ❌ assertion_failed |
| `task-02-cli-markdown-toc` | Markdown Table of Contents Generator | CLI | ❌ assertion_failed |
| `task-03-cli-env-validator` | Environment Variable Schema Validator | CLI | ❌ assertion_failed |
| `task-04-cli-log-analyzer` | Web Server Access Log Analyzer | CLI | ❌ assertion_failed |
| `task-05-cli-uuid-generator` | UUID and Slug Generator CLI | CLI | ❌ assertion_failed |
| `task-06-cli-word-frequency` | Word Frequency Counter | CLI | ❌ assertion_failed |
| `task-07-api-todo-crud` | In-Memory Todo REST API | API | ❌ assertion_failed |
| `task-08-api-auth-token` | Token Authentication Service | API | ❌ assertion_failed |
| `task-09-api-url-shortener` | URL Shortener API | API | ❌ assertion_failed |
| `task-10-api-rate-limiter` | Rate Limiter API Gateway | API | ❌ assertion_failed |
| `task-11-api-notes-search` | Notes API with Keyword Search | API | ❌ assertion_failed |
| `task-12-api-health-metrics` | Server Health & Metrics API | API | ❌ assertion_failed |
| `task-13-ui-calculator` | Calculator Web Interface | UI | ❌ assertion_failed |
| `task-14-ui-stopwatch` | Interactive Digital Stopwatch | UI | ❌ assertion_failed |
| `task-15-ui-color-picker` | Color Palette & Hex Converter UI | UI | ❌ assertion_failed |
| `task-16-ui-shopping-cart` | E-Commerce Shopping Cart Widget | UI | ❌ assertion_failed |
| `task-17-ui-accordion-faq` | Accessible FAQ Accordion Component | UI | ❌ assertion_failed |
| `task-18-ui-form-validator` | Registration Form with Live Validation | UI | ❌ assertion_failed |
| `task-19-algo-lru-cache` | LRU Cache Data Structure | ALGO | ❌ assertion_failed |
| `task-20-algo-event-emitter` | Custom Event Emitter | ALGO | ❌ assertion_failed |


---

## 4. Next 5 Proposed Improvements (Derived from Failure Diagnostics)

### 1. Baseline pre-P0 measurement only.
