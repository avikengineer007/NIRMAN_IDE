# Step 16 Specification: Hardening and Cleanup of Step 15 Install and Launch

> **Rule:** Do NOT add new features. Work through the numbered items in order, write tests where noted, and update `docs/ARCHITECTURE.md` and `docs/PROGRESS.md` at the end.

---

## Honesty Rule & Final Summary Requirements

- In the final summary, list every item **1 to 12** as:
  - **DONE** (verified, stating explicitly *how* it was verified),
  - **PARTIAL** (stating what was verified and what was not), or
  - **NOT RUN** (stating why it was not run).
- For **every test**, state explicitly whether it was **scripted** (mock model / deterministic script) or **model-driven** (real local model).
- Do **not** claim a clean-profile test passed unless it actually ran on a clean Windows user profile or clean VM.
- Do **not** invent cold-start numbers, benchmark pass rates, or throughput numbers; report only what was actually measured.

---

## User Decisions & Pre-Conditions

1. **Repository Location & OneDrive (`C:\Dev\Nirman`):**
   - The repository moves out of OneDrive to `C:\Dev\Nirman` (Option a).
   - Keep Item 1 exactly as written: fail fast in `install.ps1` and `start.ps1` if the repo, install, or runtime path is inside OneDrive.
   - Change `scripts/preflight.ps1` so the OneDrive path check is a **FAIL** (not a `WARN`) to match Item 1.
   - **Pre-start confirmation:** Before starting Item 1, confirm that:
     1. The current working directory is under `C:\Dev\Nirman`.
     2. `scripts/preflight.ps1` shows no OneDrive finding (0 FAIL).
     3. The old OneDrive path no longer appears anywhere in the repo.
2. **Item 9 (Model-Driven End-to-End Test via CLI/Daemon):**
   - Driving the model-driven end-to-end test through the CLI and daemon is approved because the Step 13 IDE is a stub.
   - Label it explicitly: **`model-driven via CLI/daemon, IDE not involved`**.
   - It must go through the real **plan → approve → execute → verify** flow with the real local model.
   - A failure is a valid recorded result. Do **not** fake results or retry-until-pass.
3. **Item 10 (Clean-Profile Test):**
   - Accepted as **NOT RUN** on a clean profile.
   - Keep the chosen thresholds in `scripts/preflight.ps1` (`6144 MiB` free VRAM, `15 GB` free disk space), and label the `15 GB` disk figure in `preflight.ps1` output as an **estimate**.
4. **Item 11 Additions (Fake 0-Layer Offload Test & Log Verbosity):**
   - The launcher must fail loudly if the GPU is not used and must never run on CPU silently without `-AllowCpu`.
   - Add a test using a fake `llama-server` that prints `"offloaded 0/29 layers"` (or `"offloaded 0/29 layers to GPU"`) and confirm the launcher refuses to start.
   - Test whether lower `llama-server` log verbosity (e.g., default or `-lv 1` / `-lv 2` / `-lv 3` instead of `-lv 4`) still prints the CUDA device and offload lines; use lower verbosity for normal runs if those lines still print.

---

## Numbered Items (1 to 12)

### 1. PATH HYGIENE
- Fail fast in `scripts/install.ps1` and `scripts/start.ps1` if the repo, install, or runtime path is inside OneDrive (check for `"OneDrive"` in the resolved path), with a clear error message and non-zero exit code.
- Update `scripts/preflight.ps1` so that any path (`repo`, `InstallDir`, `ProjectsDir`) inside OneDrive is reported as **FAIL** (and label the 15 GB disk threshold as an estimate).
- Find and remove hardcoded user paths and names across the codebase (search for `"LENOVO"`, `"C:\Users\"`, and any absolute Desktop path).
- Resolve the Desktop with `[Environment]::GetFolderPath("Desktop")` and other user folders with environment variables (`$env:USERPROFILE`, `$env:LOCALAPPDATA`, etc.).
- **Test:** Add a test that greps the repo for these forbidden patterns (`LENOVO`, `C:\Users\`, hardcoded Desktop/OneDrive paths) and fails if any are found.

### 2. LOCK FILE
- Store in the lock file (`C:\Tools\nirman\nirman.lock`):
  - `PID`
  - Process start time
  - Process name
- A lock counts as **live** only if the PID exists **AND** its start time **AND** process name match. Otherwise treat it as **stale** and clean it up before acquiring the lock.
- **Tests (scripted):**
  1. Stale lock with a dead PID (cleaned up and launch proceeds).
  2. Stale lock whose PID has been reused by an unrelated running process with a different name/start time (cleaned up and launch proceeds).
  3. Live lock with matching PID, start time, and process name (detected as live).

### 3. DOUBLE LAUNCH
- If a second launch happens while the first is running or starting, it must **not** start anything (`llama-server`, agent server, or IDE).
- It should bring the existing IDE window to the front if possible, or show a short message and exit with a distinct non-zero exit code.
- **Test (scripted):** Start two launches less than 1 second apart. Verify that the second launch exits with the distinct non-zero code and that **exactly one** `llama-server` and **one** agent server exist afterwards.

### 4. CRASH RECOVERY
- At startup, detect orphaned `llama-server` and `agent-server` (`node`) processes from a previous session.
- **Safety boundary:** Only treat a process as ours if its executable path / command line is under `C:\Tools\nirman\`. Stop those, clear the lock, then continue normally. **Never** kill processes outside `C:\Tools\nirman\`.
- If the IDE is closed normally but teardown fails partway, the log must explicitly state which teardown step failed.
- **Tests (scripted + real `llama-server` / GPU):**
  1. Kill the IDE only → next launch recovers, cleans orphans, succeeds, and `nvidia-smi` shows no leftover VRAM from the old session.
  2. Kill the agent server only → next launch recovers, cleans orphans, succeeds, and `nvidia-smi` shows no leftover VRAM from the old session.
  3. Kill `llama-server` only → next launch recovers, cleans orphans, succeeds, and `nvidia-smi` shows no leftover VRAM from the old session.
  4. Kill the whole process tree → next launch recovers, succeeds, and `nvidia-smi` shows no leftover VRAM from the old session.
  5. Simulate a reboot / crash by deleting the lock file while leaving `llama-server` and agent-server processes running → next launch detects and stops the orphans under `C:\Tools\nirman\`, succeeds, and `nvidia-smi` shows no leftover VRAM from the old session.

### 5. COLD START TIMING
- Log timestamps in `start.ps1` for each stage:
  1. `lock acquired`
  2. `llama-server spawned`
  3. `/health ready`
  4. `agent server ready`
  5. `IDE opened`
- Write a single summary timing line to `C:\Tools\nirman\logs\startup.log` with the elapsed duration of each stage and total startup time.
- Make the `/health` timeout configurable with a default of **120 s** for cold start, and show a progress message in the console window while waiting.
- Add `scripts/measure-startup.ps1` that records these stage times and instructs the user to run it once right after a reboot for true cold-start numbers. Do not invent cold-start numbers; report only what was measured (and mark warm vs cold clearly).

### 6. ICON
- Build `assets/icons/nirman.ico` from `assets/branding/logo-master.png`:
  - Crop a square containing **only the N and its orbit ring** (no pedestals, outer rings, particles, or tagline), on the dark background.
  - Export PNG-compressed icon sizes **16, 24, 32, 48, 64, 128, and 256** in a single multi-resolution `.ico` file (`assets/icons/nirman.ico`).
  - Also export a **512 px PNG** and a **1024 px PNG** for the Code-OSS product assets.
  - At **16 px and 24 px**, use a simplified version (no glow, flat color) so the `N` stays crisp and readable at small sizes.
  - Save the generator script (e.g., `scripts/build-icons.ps1` or `scripts/build-icons.mjs`) so the icons can be deterministically rebuilt.
  - Render each size to a contact sheet at `assets/icons/preview.png` for visual inspection.
  - Replace the previously generated icon everywhere it is referenced (Desktop shortcut, `product.json`, `install.ps1`, `apps/ide-fork`).
  - *(Note: If `assets/branding/logo-master.png` is missing from the repo, stop and report or verify its path before proceeding with Item 6.)*

### 7. LICENSES
- Create `THIRD_PARTY_LICENSES.md` at the repo root covering:
  1. `llama.cpp` (`llama-server`)
  2. The model file (`Qwen2.5-Coder-7B-Instruct-GGUF`)
  3. `Code-OSS` (VS Code open-source base)
  4. Any bundled runtime (CUDA runtime DLLs, etc.) or npm dependency in the dependency tree with a notable license — run a license scan over the dependency tree and list anything **not** `MIT`, `Apache-2.0`, `BSD`, or `ISC` separately.
- For the model, read the license from the model's official page or repository and quote its exact license name and link. If any license cannot be verified, write `"UNVERIFIED: check manually"` instead of guessing.
- Update `scripts/install.ps1` to copy `THIRD_PARTY_LICENSES.md` into `C:\Tools\nirman\THIRD_PARTY_LICENSES.md` and print its installed location.

### 8. CODE AND LOG CLEANUP
- Run `depcheck` or `knip` across the workspace, review findings before deleting, and remove dead code and unused dependencies.
- Ensure `.gitignore` covers:
  - `.agent/runs`
  - `logs` / `*.log`
  - `node_modules`
  - `dist` / build output
  - `*.gguf` / model files
- Add log rotation under `C:\Tools\nirman\logs\`: cap each log file around **10 MB** and keep the last **5** rotated files.
- Write `scripts/uninstall.ps1`:
  - Removes the Desktop shortcut and `C:\Tools\nirman\`.
  - Asks separately before deleting the model files (`C:\Tools\nirman\models\`) and `C:\Projects` (default: **keep both**).

### 9. TEST LABELLING AND AN END-TO-END RUN
- Mark **every test** across the repository as either:
  - **scripted** (mock model / deterministic script), or
  - **model-driven** (real local model).
- Add a separate **model-driven end-to-end test** labelled **`model-driven via CLI/daemon, IDE not involved`**:
  - Drives a small task through the full agent flow (**plan → approve → execute → verify**) via the CLI/daemon against the real local model (`qwen2.5-coder-7b` on `llama-server`), rather than writing a pre-baked file.
  - Records pass/fail, number of steps, and elapsed time. (A model failure is a valid recorded outcome; do not fake or loop-until-pass.)
  - Saves and asserts that the run's artifacts (`plan.md`, `tasks.json`, `diff.patch`, `log.txt`) exist and are non-empty.
  - After teardown, asserts that the `llama-server` process is gone and that GPU memory returns to within tolerance of baseline (per Item 11).
  - Kept in a separate test file / suite so it can be skipped in CI when no GPU/local model is present.

### 10. CLEAN-PROFILE TEST
- `scripts/preflight.ps1`: checks prerequisites (Windows version, GPU & driver, free VRAM `>= 6144 MiB`, Ollama running check, Docker/WSL2, Node `>= 20`, disk space `>= 15 GB (estimate)`, and path outside OneDrive as a **FAIL**) and prints a PASS/FAIL/WARN table.
- `docs/CLEAN_PROFILE_TEST.md`: step-by-step instructions for running install, launch, sample task, close, and the VRAM check on a new Windows user account or VM, with a fill-in checklist and the exact log files to attach on failure.
- Mark Item 10 as **NOT RUN** in the final summary because it cannot be executed on a clean Windows profile from this session.

### 11. GPU VERIFICATION (Replaces Earlier VRAM Claim)
- Stop Ollama and any other process using the GPU before GPU tests, and log what else is using the GPU.
- At startup in `start.ps1`, parse `llama-server`'s output and require evidence of GPU use:
  - CUDA device detected (`using device CUDA0`)
  - All layers offloaded (`offloaded N/N layers to GPU`, e.g., `offloaded 29/29 layers to GPU`)
- If `llama-server` reports `0` layers offloaded or no CUDA device, the launcher must **fail loudly** with the log excerpt and likely causes (CUDA build older than 12.8 for RTX 50-series Blackwell, missing `ggml-cuda.dll` / `GGML_BACKEND_PATH`, or driver issue). Never fall back to CPU silently.
- Provide `-AllowCpu` as the explicit opt-in flag for CPU-only mode.
- **Test (scripted with fake `llama-server`):** Use a fake `llama-server` that outputs `"offloaded 0/29 layers to GPU"` (while responding 200 on `/health`) and confirm `start.ps1` refuses to start, logs the failure, cleans up the process and lock file, and exits non-zero.
- Check whether lower `llama-server` log verbosity (below `-lv 4`) still prints `using device CUDA0` and `offloaded N/N layers to GPU`; if so, use the lower verbosity in `start.ps1`.
- Measure VRAM with `nvidia-smi` (`--query-compute-apps=pid,used_memory --format=csv` and `--query-gpu=memory.used --format=csv`), recording `memory.used` before launch, during, and after teardown. Release is proven only if `llama-server`'s PID is gone and `memory.used` returns to within the stated tolerance (300 MiB) of baseline. Write raw numbers to the log.
- Record the exact working `llama-server` build, driver, flags, `GGML_BACKEND_PATH`, and measured tokens/sec with GPU offload on.

### 12. TRUTHFUL STATUS
- Update `docs/PROGRESS.md` and `docs/ARCHITECTURE.md`:
  - **Step 13 = NOT DONE** (IDE is a stub; `nirman.exe` is a 47-byte placeholder and `main.js` is a Node script).
  - **Step 14 = PARTIAL** (harness and 20 task specs exist, but only initial task(s) ran live on the local model and failed; remaining local results were simulated in `getSimulatedLocal7BResults` and hosted results used `MockModelClient` golden completions).
  - **Step 15 = PARTIAL** until items 4, 11, and 10 are verified (and note that Item 10 remains NOT RUN on a clean profile, and Step 13 IDE remains a stub).
  - Correct any unverified claims from earlier summaries.
