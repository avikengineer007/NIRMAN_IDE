# Clean-Profile Test (Windows)

**Purpose:** prove install → launch → sample task → close → VRAM release works on a machine that has never seen NIRMAN.

**Status of this test: NOT RUN.** It has never been executed on a clean profile. The author's runs were on a developer account that already had Node, Docker, Ollama, the model cache and `C:\Projects`. Fill in the checklist below and attach the listed logs; do not mark anything PASS from the dev machine.

## Where to run it

Use one of:
- **VM** (best): fresh Windows 11 with GPU passthrough. Note: most VMs have no NVIDIA GPU; the GPU steps then legitimately FAIL. The GPU part of this test requires bare metal.
- **New local Windows user on the real PC** (second best): *Settings → Accounts → Other users → Add account*, then sign in as that user. This is a clean *user profile* but shares machine-wide software (Node, Docker, driver) and the model cache is **not** shared, which is what we want to test.

Do **not** run from a folder inside OneDrive (see `scripts/preflight.ps1` WARN).

## Before you start

1. Close or stop everything that uses the GPU (browsers with video, wallpaper apps, **Ollama**: `Stop-Process -Name ollama* -Force`).
2. Copy the repo (or a release zip containing `scripts\`, `apps\ide-fork\dist\`, `packages\server\dist\`) to a non-OneDrive folder, e.g. `C:\Temp\Nirman`.
3. Open **PowerShell** (not as admin unless noted) in that folder.
4. Record the baseline: `nvidia-smi --query-gpu=name,driver_version,memory.used,memory.total --format=csv` and paste into the checklist.

## Steps

| # | Command | Expected |
|---|---------|----------|
| 1 | `powershell -ExecutionPolicy Bypass -File scripts\preflight.ps1` | Table printed; **0 FAIL**. Any FAIL: stop, fix, re-run. |
| 2 | `powershell -ExecutionPolicy Bypass -File scripts\install.ps1` | Ends with "Installed Successfully". Creates `C:\Tools\nirman\`, `C:\Projects`, desktop shortcut. Model checksum line says verified (or, if the model must be downloaded, the download completes and the checksum matches `60E05F21...2463`). |
| 3 | Check the **Desktop** (use the real Desktop of this user) for `NIRMAN Agentic Studio.lnk` | Shortcut exists with the icon. |
| 4 | **Double-click the shortcut** | Console shows: lock acquired → llama-server spawned → `/health` ready → `GPU evidence: CUDA device in use, offloaded N/N layers to GPU` → agent server ready → IDE opened. |
| 5 | In the IDE (currently a stub, see Known limitations), run the sample task | Sample task output appears in `C:\Projects`. |
| 6 | While the IDE is open, in a second PowerShell: `nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits` | Noticeably higher than baseline (expected several GB). Record it. |
| 7 | **Close the IDE normally** | Console prints `VRAM raw numbers (MiB): before=… during=… after=… llama_pid_alive=False` and `VRAM release verified`. |
| 8 | `Get-Process llama-server -ErrorAction SilentlyContinue` | No output (process gone). |
| 9 | `nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits` | Within ~300 MiB of the step-4 baseline. |
| 10 | Double-click the shortcut a second time, then close again | Starts and stops cleanly (no stale-lock error). |

> Note: `nvidia-smi --query-compute-apps` shows `[N/A]` for per-process memory under WDDM. VRAM release is judged by *process gone + `memory.used` back near baseline*, not per-PID numbers.

## Checklist (fill in)

```
Tester: ________   Date: ________   Machine/VM: ________
Windows version: ________   GPU/driver: ________   Baseline memory.used: ____ MiB

[ ] 1  preflight: 0 FAIL        (WARNs noted: ________)
[ ] 2  install completed        model checksum verified: [ ] yes [ ] no
[ ] 3  desktop shortcut + icon present
[ ] 4  launch via shortcut: all startup stages logged
       /health ready in ____ s   offloaded ____/____ layers
[ ] 5  sample task produced expected output
[ ] 6  memory.used while running: ____ MiB
[ ] 7  IDE closed normally; teardown reported success
[ ] 8  llama-server process gone
[ ] 9  memory.used after: ____ MiB  (baseline ____ , within 300 MiB: [ ] yes [ ] no)
[ ] 10 second launch/close works

Overall: [ ] PASS  [ ] FAIL    First failing step #: ____
```

## Logs to attach on failure

From `C:\Tools\nirman\logs\`:
- `startup.log`
- `session.log`
- `llama-server.out.log` and `llama-server.err.log`
- `agent-server.out.log` and `agent-server.err.log`
- `pids.json` (if present)

Plus:
- Output of `scripts\preflight.ps1` (copy from console)
- `nvidia-smi` full output taken at the failure point
- `C:\Tools\nirman\nirman.lock` (if present)
- The exact console text of the failing step

## Known limitations (so a PASS is not over-read)

- The IDE is a **stub** (Step 13 NOT DONE); step 5's "sample task" currently writes a fixed file and is **not** model-driven.
- Crash recovery, double-launch protection and OneDrive fail-fast (Step 16 items 1–4) are not yet implemented, so do not test them here yet.
- Cold-start (right after reboot) timing has not been measured.

## Uninstall after the test

Delete `C:\Tools\nirman\`, the desktop shortcut and `C:\Projects` (if created by the test). A proper `scripts\uninstall.ps1` is planned (Step 16 item 8) but does not exist yet.
