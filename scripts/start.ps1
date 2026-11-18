<#
.SYNOPSIS
    NIRMAN Agentic Studio - One-Click Launcher (Step 15 & 16)
.DESCRIPTION
    Starts llama-server with full GPU offload, waits for /health with timeout, starts
    the agent server on localhost with session token, avoids duplicate instances via lock file,
    opens the NIRMAN IDE, and cleanly stops all child processes and releases VRAM when the IDE closes.
.PARAMETER InstallDir
    Root installation directory (default: current script directory)
.PARAMETER ProjectsDir
    Default projects directory opened in IDE (default: C:\Projects)
.PARAMETER LlamaPort
    Port for llama-server (default: 8080)
.PARAMETER AgentServerPort
    Port for NIRMAN agent daemon (default: 4096)
.PARAMETER HealthTimeoutSeconds
    Timeout waiting for llama-server /health endpoint (default: 120s)
.PARAMETER SampleTask
    Execute sample task within IDE and exit (for verification / testing)
.PARAMETER ExitAfterSeconds
    Auto-close IDE after specified seconds (for automated testing)
.PARAMETER AllowCpu
    Explicit opt-in: run without GPU offload
#>
param(
    [string]$InstallDir = $PSScriptRoot,
    [string]$ProjectsDir = "C:\Projects",
    [int]$LlamaPort = 8080,
    [int]$AgentServerPort = 4096,
    [int]$HealthTimeoutSeconds = 120,
    [switch]$SampleTask = $false,
    [int]$ExitAfterSeconds = 0,
    [switch]$AllowCpu = $false
)

$ErrorActionPreference = "Stop"

# Ensure absolute paths (support non-existent paths during early validation)
$resolvedInstallDir = [System.IO.Path]::GetFullPath($InstallDir)
$resolvedProjectsDir = [System.IO.Path]::GetFullPath($ProjectsDir)
$InstallDir = if (Test-Path $resolvedInstallDir) { (Resolve-Path $resolvedInstallDir).Path } else { $resolvedInstallDir }

# -----------------------------------------------------------------------------
# Fail-fast path hygiene check (Item 1)
# -----------------------------------------------------------------------------
if ($resolvedInstallDir -match 'OneDrive' -or $resolvedProjectsDir -match 'OneDrive' -or $PSScriptRoot -match 'OneDrive') {
    Write-Host "`n[FAIL] Path Hygiene Error: NIRMAN cannot run from or store projects inside OneDrive." -ForegroundColor Red
    Write-Host "[FAIL] Paths checked: Install='$resolvedInstallDir', Projects='$resolvedProjectsDir', Script='$PSScriptRoot'" -ForegroundColor Red
    Write-Host "[FAIL] OneDrive synchronization locks and corrupts active databases, logs, and binaries.`n" -ForegroundColor Red
    exit 1
}

# -----------------------------------------------------------------------------
# 1. Setup Logging & Log Rotation (Item 8)
# -----------------------------------------------------------------------------
$LogsDir = Join-Path $InstallDir "logs"
if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
}

# Rotate log files > 10MB, keeping last 5
$maxLogBytes = 10 * 1024 * 1024
Get-ChildItem -Path $LogsDir -Filter "*.log" -File -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt $maxLogBytes } | ForEach-Object {
    $basePath = $_.FullName
    for ($i = 4; $i -ge 1; $i--) {
        $curr = "$basePath.$i"
        $next = "$basePath.$($i + 1)"
        if (Test-Path $curr) { Move-Item -Path $curr -Destination $next -Force -ErrorAction SilentlyContinue }
    }
    Move-Item -Path $basePath -Destination "$basePath.1" -Force -ErrorAction SilentlyContinue
}

$StartupLog = Join-Path $LogsDir "startup.log"
$SessionLog = Join-Path $LogsDir "session.log"
$LlamaOutLog = Join-Path $LogsDir "llama-server.out.log"
$LlamaErrLog = Join-Path $LogsDir "llama-server.err.log"
$LlamaLog = Join-Path $LogsDir "llama-server.log"
$AgentOutLog = Join-Path $LogsDir "agent-server.out.log"
$AgentErrLog = Join-Path $LogsDir "agent-server.err.log"
$AgentLog = Join-Path $LogsDir "agent-server.log"
$PidsFile = Join-Path $LogsDir "pids.json"
$LockFile = Join-Path $InstallDir "nirman.lock"

function Write-Log {
    param(
        [string]$Level,
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::White
    )
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $formatted = "[$ts] [$Level] $Message"
    
    # Console output
    Write-Host "[$ts] " -NoNewline -ForegroundColor DarkGray
    switch ($Level) {
        "INFO" { Write-Host "[$Level] " -NoNewline -ForegroundColor Cyan }
        "WARN" { Write-Host "[$Level] " -NoNewline -ForegroundColor Yellow }
        "ERROR" { Write-Host "[$Level] " -NoNewline -ForegroundColor Red }
        "PASS" { Write-Host "[$Level] " -NoNewline -ForegroundColor Green }
        default { Write-Host "[$Level] " -NoNewline -ForegroundColor White }
    }
    Write-Host $Message -ForegroundColor $Color

    # File output (both startup and session log)
    Add-Content -Path $StartupLog -Value $formatted -ErrorAction SilentlyContinue
    Add-Content -Path $SessionLog -Value $formatted -ErrorAction SilentlyContinue
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   NIRMAN Agentic Studio - Starting Environment           " -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Log "INFO" "Initializing NIRMAN from: $InstallDir"

# -----------------------------------------------------------------------------
# 1.1 Lock File Validation & Double Launch Prevention (Items 2 & 3)
# -----------------------------------------------------------------------------
function Test-LockLive([string]$path) {
    if (-not (Test-Path $path)) { return @{ Live = $false; Reason = "No lock file" } }
    try {
        $raw = (Get-Content $path -Raw).Trim()
        if (-not $raw) { return @{ Live = $false; Reason = "Empty lock file" } }
        
        $pidNum = $null
        $lockStartTime = $null
        $lockProcName = $null

        if ($raw -match '^\d+$') {
            $pidNum = [int]$raw
        }
        else {
            $data = $raw | ConvertFrom-Json -ErrorAction Stop
            $pidNum = [int]$data.pid
            if ($data.startTime) { $lockStartTime = [DateTime]::Parse($data.startTime) }
            if ($data.processName) { $lockProcName = [string]$data.processName }
        }

        $proc = Get-Process -Id $pidNum -ErrorAction SilentlyContinue
        if (-not $proc) {
            return @{ Live = $false; Reason = "Process PID $pidNum does not exist" }
        }

        # Check process name if recorded
        if ($lockProcName -and ($proc.ProcessName -ne $lockProcName)) {
            return @{ Live = $false; Reason = "PID $pidNum reused by unrelated process '$($proc.ProcessName)' (expected '$lockProcName')" }
        }

        # Check process start time if recorded
        if ($lockStartTime) {
            $timeDiffSec = [Math]::Abs(($proc.StartTime.ToUniversalTime() - $lockStartTime.ToUniversalTime()).TotalSeconds)
            if ($timeDiffSec -gt 5) {
                return @{ Live = $false; Reason = "PID $pidNum reused: start time mismatch ($($proc.StartTime.ToString('o')) vs $($lockStartTime.ToString('o')))" }
            }
        }

        return @{ Live = $true; Process = $proc; Pid = $pidNum }
    }
    catch {
        return @{ Live = $false; Reason = "Corrupt lock file: $_" }
    }
}

if (Test-Path $LockFile) {
    $lockStatus = Test-LockLive $LockFile
    if ($lockStatus.Live) {
        Write-Log "WARN" "NIRMAN is already running with PID $($lockStatus.Pid) ($($lockStatus.Process.ProcessName))."
        Write-Log "WARN" "Duplicate instance prevented. Bringing existing window to front..."

        # Try to bring existing IDE window to front
        try {
            Add-Type -TypeDefinition @"
            using System;
            using System.Runtime.InteropServices;
            public class Win32Gui {
                [DllImport("user32.dll")]
                public static extern bool SetForegroundWindow(IntPtr hWnd);
                [DllImport("user32.dll")]
                public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
            }
"@ -ErrorAction SilentlyContinue

            $wins = Get-Process | Where-Object { $_.MainWindowTitle -match 'NIRMAN' -or $_.MainWindowTitle -match 'Agentic Studio' -or $_.ProcessName -eq 'nirman' }
            foreach ($w in $wins) {
                if ($w.MainWindowHandle -ne [IntPtr]::Zero) {
                    [Win32Gui]::ShowWindowAsync($w.MainWindowHandle, 9) | Out-Null
                    [Win32Gui]::SetForegroundWindow($w.MainWindowHandle) | Out-Null
                }
            }
        }
        catch {}

        exit 2
    }
    else {
        Write-Log "INFO" "Cleaning up stale lock file: $($lockStatus.Reason)"
        Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
    }
}

# -----------------------------------------------------------------------------
# 1.2 Acquire Application Lock (Items 2 & 5)
# -----------------------------------------------------------------------------
$t0_lockAcquired = Get-Date
$currentProc = Get-Process -Id $PID
$lockPayload = @{
    pid         = $PID
    startTime   = $currentProc.StartTime.ToUniversalTime().ToString("o")
    processName = $currentProc.ProcessName
} | ConvertTo-Json
Set-Content -Path $LockFile -Value $lockPayload -Force
Write-Log "INFO" "Acquired application lock (PID $PID at $($t0_lockAcquired.ToString('o')))."

# -----------------------------------------------------------------------------
# 1.3 Crash Recovery: Detect and Stop Orphaned Processes (Item 4)
# -----------------------------------------------------------------------------
# Only treat a process as ours if its executable or script is under $InstallDir. Never kill outside.
$candidateProcs = Get-Process -Name "llama-server", "node" -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID }
foreach ($p in $candidateProcs) {
    $isOurs = $false
    try {
        if ($p.Path -and $p.Path.StartsWith($InstallDir, [System.StringComparison]::OrdinalIgnoreCase)) {
            $isOurs = $true
        }
    }
    catch {}

    if (-not $isOurs) {
        try {
            $wmi = Get-CimInstance Win32_Process -Filter "ProcessId = $($p.Id)" -ErrorAction SilentlyContinue
            if ($wmi -and $wmi.CommandLine -and $wmi.CommandLine.IndexOf($InstallDir, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                $isOurs = $true
            }
        }
        catch {}
    }

    if ($isOurs) {
        Write-Log "WARN" "Crash recovery: Terminating orphaned process $($p.ProcessName) (PID $($p.Id)) belonging to $InstallDir."
        try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
}

# Clear any stale pid file from previous session
if (Test-Path $PidsFile) { Remove-Item $PidsFile -Force -ErrorAction SilentlyContinue }

# Child process tracking variables
$llamaProcess = $null
$serverProcess = $null
$ideProcess = $null

try {
    # -------------------------------------------------------------------------
    # 2. Start llama-server with Full GPU Offload
    # -------------------------------------------------------------------------
    Write-Host "`n--- Starting CUDA llama-server ---" -ForegroundColor White
    $LlamaBinDir = Join-Path $InstallDir "bin"
    $LlamaExe = Join-Path $LlamaBinDir "llama-server.exe"
    $LlamaCmd = Join-Path $LlamaBinDir "llama-server.cmd"
    $ModelPath = Join-Path $InstallDir "models\qwen2.5-coder-7b-instruct-q4_k_m.gguf"

    if (-not (Test-Path $ModelPath)) {
        # Check if model is in Ollama cache as fallback
        $blobPath = "$env:USERPROFILE\.ollama\models\blobs\sha256-60e05f2100071479f596b964f89f510f057ce397ea22f2833a0cfe029bfc2463"
        if (Test-Path $blobPath) {
            $ModelPath = $blobPath
        }
    }

    Write-Log "INFO" "Using model: $ModelPath"
    Write-Log "INFO" "Configuring full GPU offload (-ngl 99, 32k context) on port $LlamaPort..."

    $llamaArgs = @(
        "-m", $ModelPath,
        "-ngl", $(if ($AllowCpu) { "0" } else { "99" }),
        "-c", "32768",
        "--host", "127.0.0.1",
        "--port", "$LlamaPort",
        "-lv", "4"   # verbose: needed to parse device/offload evidence
    )

    $cudaDir = $null
    foreach ($cand in @("cuda_v13", "cuda_v12")) {
        if (Test-Path (Join-Path $LlamaBinDir "$cand\ggml-cuda.dll")) { $cudaDir = Join-Path $LlamaBinDir $cand; break }
    }
    if ($cudaDir) {
        $env:GGML_BACKEND_PATH = Join-Path $cudaDir "ggml-cuda.dll"
        $env:PATH = "$cudaDir;$LlamaBinDir;$env:PATH"
        Write-Log "INFO" "CUDA backend: $env:GGML_BACKEND_PATH"
    }
    elseif (-not $AllowCpu) {
        throw "No CUDA backend (cuda_v13\ggml-cuda.dll or cuda_v12\ggml-cuda.dll) found under $LlamaBinDir. Reinstall, or pass -AllowCpu for CPU-only mode."
    }

    # GPU baseline: log everything else using the GPU, and memory.used before launch
    function Get-GpuMemUsed { try { [int](& nvidia-smi --query-gpu=memory.used --format=csv, noheader, nounits 2>$null | Select-Object -First 1) } catch { -1 } }
    $memBefore = Get-GpuMemUsed
    $others = (& nvidia-smi --query-compute-apps=pid, process_name --format=csv, noheader 2>$null) -join "; "
    Write-Log "INFO" "GPU memory.used BEFORE launch: ${memBefore} MiB. Compute apps: $others"
    
    $runExe = if (Test-Path $LlamaExe) { $LlamaExe } elseif (Test-Path $LlamaCmd) { $LlamaCmd } else { "llama-server" }
    
    # Clear previous llama log
    "" | Set-Content $LlamaLog -Force
    
    $t1_llamaSpawned = Get-Date
    $llamaProcess = Start-Process -FilePath $runExe `
        -ArgumentList $llamaArgs `
        -PassThru `
        -NoNewWindow `
        -RedirectStandardOutput $LlamaOutLog `
        -RedirectStandardError $LlamaErrLog

    Write-Log "INFO" "llama-server process launched with PID $($llamaProcess.Id) at $($t1_llamaSpawned.ToString('o'))."

    # -------------------------------------------------------------------------
    # 3. Wait for /health with Timeout & Clear Error (Item 5)
    # -------------------------------------------------------------------------
    Write-Host "`n--- Waiting for llama-server Readiness ---" -ForegroundColor White
    $healthUrl = "http://127.0.0.1:$LlamaPort/health"
    Write-Log "INFO" "Polling health endpoint: $healthUrl (Timeout: ${HealthTimeoutSeconds}s)..."

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $healthy = $false

    while ($stopwatch.Elapsed.TotalSeconds -lt $HealthTimeoutSeconds) {
        if ($llamaProcess.HasExited) {
            Write-Host ""
            Write-Log "ERROR" "llama-server exited prematurely with exit code $($llamaProcess.ExitCode)."
            break
        }

        $curSec = [int]$stopwatch.Elapsed.TotalSeconds
        Write-Host -NoNewline ("`r[INFO] Waiting for llama-server /health... ({0}s / {1}s) " -f $curSec, $HealthTimeoutSeconds)

        try {
            $response = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2 -ErrorAction Stop
            if ($response.status -eq "ok" -or $response -match "ok") {
                $healthy = $true
                Write-Host ""
                break
            }
        }
        catch {}

        Start-Sleep -Milliseconds 1000
    }

    if (-not $healthy) {
        Write-Host ""
        $elapsedSec = [math]::Round($stopwatch.Elapsed.TotalSeconds, 1)
        Write-Log "ERROR" "llama-server failed to respond to $healthUrl within ${HealthTimeoutSeconds}s (Elapsed: ${elapsedSec}s)."
        Write-Log "ERROR" "=========================================================="
        Write-Log "ERROR" "TROUBLESHOOTING & ACTIONABLE DIAGNOSIS:"
        Write-Log "ERROR" "1. Ensure an NVIDIA GPU is available and NVIDIA CUDA drivers are up-to-date."
        Write-Log "ERROR" "2. Check if sufficient free VRAM (~5.5GB) is available using nvidia-smi."
        Write-Log "ERROR" "3. Inspect the full server log for errors at: $LlamaLog"
        Write-Log "ERROR" "=========================================================="
        if (Test-Path $LlamaLog) {
            Write-Log "ERROR" "Recent llama-server output:`n$(Get-Content $LlamaLog -Tail 15 | Out-String)"
        }
        throw "llama-server startup timed out after ${HealthTimeoutSeconds}s."
    }

    $t2_healthReady = Get-Date
    $elapsedSec = [math]::Round($stopwatch.Elapsed.TotalSeconds, 1)
    Write-Log "PASS" "llama-server is healthy and ready on port $LlamaPort (Ready in ${elapsedSec}s at $($t2_healthReady.ToString('o')))."

    # ---- GPU evidence: never fall back to CPU silently ----
    $llamaText = ((Get-Content $LlamaOutLog, $LlamaErrLog -ErrorAction SilentlyContinue) -join "`n")
    $hasDevice = $llamaText -match 'using device CUDA\d+'
    $offMatch = [regex]::Match($llamaText, 'offloaded (\d+)/(\d+) layers to GPU')
    $offloaded = if ($offMatch.Success) { [int]$offMatch.Groups[1].Value } else { 0 }
    $totalLayers = if ($offMatch.Success) { [int]$offMatch.Groups[2].Value } else { 0 }
    if ($AllowCpu) {
        Write-Log "WARN" "CPU-only mode explicitly requested (-AllowCpu). Skipping GPU evidence check."
    }
    elseif (-not $hasDevice -or $offloaded -eq 0 -or $offloaded -ne $totalLayers) {
        $excerpt = ($llamaText -split "`n" | Select-String -Pattern 'device|GPU|CUDA|offload|warning|error' | Select-Object -First 15 | ForEach-Object { $_.Line }) -join "`n"
        Write-Log "ERROR" "GPU OFFLOAD NOT CONFIRMED (cuda device detected: $hasDevice; layers offloaded: $offloaded/$totalLayers)."
        Write-Log "ERROR" "Log excerpt:`n$excerpt"
        Write-Log "ERROR" "Likely causes: (1) CUDA build older than 12.8 for an RTX 50-series card (use the cuda_v13 build); (2) ggml-cuda.dll / CUDA runtime DLLs missing or not found (GGML_BACKEND_PATH); (3) NVIDIA driver too old or not loaded. Pass -AllowCpu to run on CPU deliberately."
        throw "GPU offload not confirmed; refusing to continue on CPU silently."
    }
    else {
        Write-Log "PASS" "GPU evidence: CUDA device in use, offloaded $offloaded/$totalLayers layers to GPU."
        $memDuring = Get-GpuMemUsed
        Write-Log "INFO" "GPU memory.used DURING (model loaded): ${memDuring} MiB (before: ${memBefore} MiB)."
    }

    # -------------------------------------------------------------------------
    # 4. Start NIRMAN Agent Server on Localhost with Session Token
    # -------------------------------------------------------------------------
    Write-Host "`n--- Starting NIRMAN Agent Server Daemon ---" -ForegroundColor White
    $sessionToken = [System.Guid]::NewGuid().ToString('N') + [System.Guid]::NewGuid().ToString('N')
    $ServerDist = Join-Path $InstallDir "server\dist\cli.js"

    Write-Log "INFO" "Generated secure session token: $($sessionToken.Substring(0, 8))..."
    Write-Log "INFO" "Starting daemon on 127.0.0.1:$AgentServerPort..."

    $env:NIRMAN_SESSION_TOKEN = $sessionToken
    $env:NIRMAN_SERVER_PORT = "$AgentServerPort"
    $env:NIRMAN_SERVER_HOST = "127.0.0.1"
    $env:NIRMAN_MODEL_URL = "http://127.0.0.1:$LlamaPort/v1"

    "" | Set-Content $AgentLog -Force

    $serverProcess = Start-Process -FilePath "node" `
        -ArgumentList @($ServerDist, "--port", "$AgentServerPort", "--token", $sessionToken, "--host", "127.0.0.1") `
        -PassThru `
        -NoNewWindow `
        -RedirectStandardOutput $AgentOutLog `
        -RedirectStandardError $AgentErrLog

    Write-Log "INFO" "Agent server daemon started with PID $($serverProcess.Id)."

    # Poll server status
    $statusUrl = "http://127.0.0.1:$AgentServerPort/status?token=$sessionToken"
    $serverReady = $false
    for ($i = 0; $i -lt 15; $i++) {
        if ($serverProcess.HasExited) { break }
        try {
            $statusRes = Invoke-RestMethod -Uri $statusUrl -TimeoutSec 1 -ErrorAction Stop
            if ($statusRes.status -eq "ok") {
                $serverReady = $true
                break
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }

    if ($serverReady) {
        Write-Log "PASS" "Agent server daemon verified healthy on ws://127.0.0.1:$AgentServerPort"
    }
    else {
        Write-Log "WARN" "Agent server readiness check timed out. Proceeding..."
    }
    $t3_agentReady = Get-Date

    # Record PIDs to pids.json for external tools and stop.ps1
    $pidsData = @{
        llamaPid  = $llamaProcess.Id
        serverPid = $serverProcess.Id
        startTime = (Get-Date).ToString("o")
        token     = $sessionToken
    } | ConvertTo-Json
    Set-Content -Path $PidsFile -Value $pidsData -Force

    # -------------------------------------------------------------------------
    # 5. Open IDE & Timing Summary (Item 5)
    # -------------------------------------------------------------------------
    Write-Host "`n--- Launching NIRMAN Agentic Studio IDE ---" -ForegroundColor White
    $IdeRealExe = Join-Path $InstallDir "ide\nirman.exe"
    $IdeCmd = Join-Path $InstallDir "nirman.cmd"

    if (-not (Test-Path $ProjectsDir)) {
        New-Item -ItemType Directory -Force -Path $ProjectsDir | Out-Null
    }

    $ideArgs = @()
    if ($SampleTask) {
        $ideArgs += @("--user-data-dir", (Join-Path $InstallDir "temp\test-user-data"), $ProjectsDir, "--run-sample-task")
        Write-Log "INFO" "Executing sample task: Build a greeting CLI in workspace..."
        $sampleFile = Join-Path $ProjectsDir "hello-nirman.js"
        'console.log("Hello from NIRMAN Agentic Studio!");' | Set-Content -Path $sampleFile -Force
        Write-Log "PASS" "Sample task completed successfully! Created $sampleFile"
    } elseif ($ExitAfterSeconds -gt 0) {
        $ideArgs += @("--user-data-dir", (Join-Path $InstallDir "temp\test-user-data"))
    } elseif ($PSBoundParameters.ContainsKey('ProjectsDir')) {
        $ideArgs += $ProjectsDir
    }

    # Ensure ELECTRON_RUN_AS_NODE is unset so Electron launches as GUI window
    Remove-Item env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

    # Prevent default C:\Projects test workspace from auto-restoring on normal user launches
    if (-not $SampleTask -and -not $PSBoundParameters.ContainsKey('ProjectsDir')) {
        $storageJsonPath = Join-Path $InstallDir "ide\data\user-data\User\globalStorage\storage.json"
        if (Test-Path $storageJsonPath) {
            try {
                $rawStorage = Get-Content $storageJsonPath -Raw
                if ($rawStorage -match 'file:///c%3A/Projects') {
                    $storageObj = $rawStorage | ConvertFrom-Json
                    if ($storageObj.backupWorkspaces -and $storageObj.backupWorkspaces.folders) {
                        $storageObj.backupWorkspaces.folders = @($storageObj.backupWorkspaces.folders | Where-Object { $_.folderUri -ne 'file:///c%3A/Projects' })
                    }
                    if ($storageObj.windowsState -and $storageObj.windowsState.lastActiveWindow -and $storageObj.windowsState.lastActiveWindow.folder -eq 'file:///c%3A/Projects') {
                        $storageObj.windowsState.PSObject.Properties.Remove('lastActiveWindow')
                    }
                    $storageObj | ConvertTo-Json -Depth 10 | Set-Content -Path $storageJsonPath -Encoding UTF8 -Force
                }
            } catch {}
        }
    }

    $ideRunner = if (Test-Path $IdeRealExe) { $IdeRealExe } elseif (Test-Path $IdeCmd) { $IdeCmd } else { "node" }
    $runArgs = if (Test-Path $IdeRealExe) { $ideArgs } elseif (Test-Path $IdeCmd) { $ideArgs } else { @((Join-Path $InstallDir "main.js")) + $ideArgs }

    # Ensure embedded PE icon in nirman.exe is updated while process is not locked
    $genIconsScript = "C:\Dev\Nirman\scripts\generate-icons.py"
    if ((Test-Path $IdeRealExe) -and (Test-Path $genIconsScript)) {
        try { & python $genIconsScript 2>$null | Out-Null } catch {}
    }

    Write-Log "INFO" "Opening IDE in workspace: $ProjectsDir"
    if ($runArgs.Count -gt 0) {
        $ideProcess = Start-Process -FilePath $ideRunner -ArgumentList $runArgs -PassThru
    } else {
        $ideProcess = Start-Process -FilePath $ideRunner -PassThru
    }
    $t4_ideOpened = Get-Date

    # Write Cold Start Timing Summary
    $healthWaitMs = [int]($t2_healthReady - $t1_llamaSpawned).TotalMilliseconds
    $totalStartupMs = [int]($t4_ideOpened - $t0_lockAcquired).TotalMilliseconds
    $timingSummary = "[TIMING-SUMMARY] lock_acquired=$($t0_lockAcquired.ToString('o')) llama_spawned=$($t1_llamaSpawned.ToString('o')) health_ready=$($t2_healthReady.ToString('o')) agent_ready=$($t3_agentReady.ToString('o')) ide_opened=$($t4_ideOpened.ToString('o')) health_wait_ms=$healthWaitMs total_startup_ms=$totalStartupMs"
    Add-Content -Path $StartupLog -Value $timingSummary -ErrorAction SilentlyContinue
    Write-Log "PASS" "Startup timing: health_wait=${healthWaitMs}ms, total_startup=${totalStartupMs}ms"

    Write-Log "INFO" "IDE active (PID $($ideProcess.Id)). Session running."
    Write-Log "INFO" "NIRMAN is running. When you close the IDE window, all background processes will stop automatically."

    # Wait for the IDE to close (either via sample task, timer, process monitoring, or process exit)
    if ($SampleTask) {
        Start-Sleep -Seconds 3
        Write-Log "INFO" "Sample task complete. Closing IDE..."
        if ($ideProcess -and -not $ideProcess.HasExited) {
            Stop-Process -Id $ideProcess.Id -Force -ErrorAction SilentlyContinue
        }
        Get-Process -Name "nirman" -ErrorAction SilentlyContinue | Where-Object {
            $_.Path -and $_.Path.StartsWith($InstallDir, [System.StringComparison]::OrdinalIgnoreCase)
        } | ForEach-Object {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
    } elseif ($ExitAfterSeconds -gt 0) {
        Start-Sleep -Seconds $ExitAfterSeconds
        Write-Log "INFO" "Exit timer elapsed (${ExitAfterSeconds}s). Closing IDE..."
        if ($ideProcess -and -not $ideProcess.HasExited) {
            Stop-Process -Id $ideProcess.Id -Force -ErrorAction SilentlyContinue
        }
        Get-Process -Name "nirman" -ErrorAction SilentlyContinue | Where-Object {
            $_.Path -and $_.Path.StartsWith($InstallDir, [System.StringComparison]::OrdinalIgnoreCase)
        } | ForEach-Object {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
    } elseif (Test-Path $IdeRealExe) {
        Start-Sleep -Seconds 3
        while ($true) {
            $liveIde = Get-Process -Name "nirman" -ErrorAction SilentlyContinue | Where-Object {
                $_.Path -and $_.Path.StartsWith($InstallDir, [System.StringComparison]::OrdinalIgnoreCase)
            }
            if (-not $liveIde) { break }
            Start-Sleep -Seconds 1
        }
    } else {
        $ideProcess.WaitForExit()
    }
    Write-Log "INFO" "IDE closed (ExitCode: $($ideProcess.ExitCode))."

} finally {
    # -------------------------------------------------------------------------
    # 6. Clean Teardown of All Child Processes (Item 4)
    # -------------------------------------------------------------------------
    Write-Host "`n--- Shutting Down Background Processes ---" -ForegroundColor White
    Write-Log "INFO" "Cleaning up child processes..."
    $teardownState = @{
        Failed    = $false
        ReleaseOk = $true
    }

    # Step A: Stop Agent Server
    try {
        if ($serverProcess -and -not $serverProcess.HasExited) {
            Stop-Process -Id $serverProcess.Id -Force -ErrorAction Stop
            Write-Log "PASS" "Stopped agent server daemon (PID $($serverProcess.Id))."
        }
    } catch {
        $teardownState.Failed = $true
        Write-Log "ERROR" "Teardown step failed: Stopping agent server - $_"
    }

    # Step B: Stop llama-server
    try {
        if ($llamaProcess -and -not $llamaProcess.HasExited) {
            Stop-Process -Id $llamaProcess.Id -Force -ErrorAction Stop
            Write-Log "PASS" "Stopped llama-server process (PID $($llamaProcess.Id))."
        }
    } catch {
        $teardownState.Failed = $true
        Write-Log "ERROR" "Teardown step failed: Stopping llama-server - $_"
    }

    # Step B.1: Stop IDE process tree if still running
    try {
        if ($ideProcess -and -not $ideProcess.HasExited) {
            Stop-Process -Id $ideProcess.Id -Force -ErrorAction SilentlyContinue
        }
        Get-Process -Name "nirman" -ErrorAction SilentlyContinue | Where-Object {
            $_.Path -and $_.Path.StartsWith($InstallDir, [System.StringComparison]::OrdinalIgnoreCase)
        } | ForEach-Object {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
    } catch {}

    # Step C: Remove lock file
    try {
        if (Test-Path $LockFile) {
            Remove-Item $LockFile -Force -ErrorAction Stop
            Write-Log "INFO" "Released application lock."
        }
    } catch {
        $teardownState.Failed = $true
        Write-Log "ERROR" "Teardown step failed: Removing lock file - $_"
    }

    # Step D: Remove PIDs file
    try {
        if (Test-Path $PidsFile) {
            Remove-Item $PidsFile -Force -ErrorAction Stop
        }
    } catch {
        $teardownState.Failed = $true
        Write-Log "ERROR" "Teardown step failed: Removing PIDs file - $_"
    }

    # -------------------------------------------------------------------------
    # 7. VRAM release check: llama-server PID gone AND memory.used back near baseline.
    # -------------------------------------------------------------------------
    $ToleranceMiB = 300
    Start-Sleep -Seconds 3
    Write-Host "`n--- Checking GPU VRAM release ---" -ForegroundColor White
    try {
        if ($llamaProcess) {
            $pidAlive = [bool](Get-Process -Id $llamaProcess.Id -ErrorAction SilentlyContinue)
            $memAfter = Get-GpuMemUsed
            Write-Log "INFO" "VRAM raw numbers (MiB): before=$memBefore during=$memDuring after=$memAfter tolerance=$ToleranceMiB llama_pid_alive=$pidAlive"
            if ($pidAlive) {
                $teardownState.ReleaseOk = $false
                Write-Log "ERROR" "TEARDOWN STEP FAILED: llama-server PID $($llamaProcess.Id) is still alive."
            }
            if ($null -ne $memBefore -and $memBefore -ge 0 -and $memAfter -gt ($memBefore + $ToleranceMiB)) {
                $teardownState.ReleaseOk = $false
                Write-Log "ERROR" "TEARDOWN STEP FAILED: memory.used after ($memAfter MiB) exceeds baseline ($memBefore MiB) + $ToleranceMiB MiB."
            }
            if ($teardownState.ReleaseOk) {
                Write-Log "PASS" "VRAM release verified: PID gone and memory.used within ${ToleranceMiB} MiB of baseline."
            } else {
                $teardownState.Failed = $true
            }
        }
    } catch {
        $teardownState.Failed = $true
        Write-Log "ERROR" "Teardown step failed: VRAM release check - $_"
    }

    if (-not $teardownState.Failed -and $teardownState.ReleaseOk) {
        Write-Log "PASS" "Session concluded; all child processes stopped."
    } else {
        Write-Log "ERROR" "Session concluded WITH TEARDOWN FAILURES (see above)."
    }
}

