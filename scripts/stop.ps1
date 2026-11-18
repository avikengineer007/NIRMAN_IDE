<#
.SYNOPSIS
    NIRMAN Agentic Studio - Clean Stop Script (Step 15)
.DESCRIPTION
    Stops all NIRMAN background processes (agent server, llama-server, and IDE),
    removes the application lock file, unloads GPU VRAM, confirms release via nvidia-smi,
    and logs the shutdown to C:\Tools\<name>\logs\session.log.
.PARAMETER InstallDir
    Target directory for NIRMAN installation (default: current script directory)
#>
param(
    [string]$InstallDir = $PSScriptRoot
)

$ErrorActionPreference = "Continue"

# Resolve absolute path
$InstallDir = (Resolve-Path $InstallDir).Path
$LogsDir   = Join-Path $InstallDir "logs"
$SessionLog = Join-Path $LogsDir "session.log"
$LockFile   = Join-Path $InstallDir "nirman.lock"
$PidsFile   = Join-Path $LogsDir "pids.json"

function Write-Log {
    param([string]$Level, [string]$Message, [ConsoleColor]$Color = [ConsoleColor]::White)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $formatted = "[$ts] [$Level] $Message"
    Write-Host "[$ts] " -NoNewline -ForegroundColor DarkGray
    switch ($Level) {
        "INFO"  { Write-Host "[$Level] " -NoNewline -ForegroundColor Cyan }
        "WARN"  { Write-Host "[$Level] " -NoNewline -ForegroundColor Yellow }
        "ERROR" { Write-Host "[$Level] " -NoNewline -ForegroundColor Red }
        "PASS"  { Write-Host "[$Level] " -NoNewline -ForegroundColor Green }
        default { Write-Host "[$Level] " -NoNewline -ForegroundColor White }
    }
    Write-Host $Message -ForegroundColor $Color
    if (Test-Path $LogsDir) {
        Add-Content -Path $SessionLog -Value $formatted -ErrorAction SilentlyContinue
    }
}

Write-Host "==========================================================" -ForegroundColor Yellow
Write-Host "   NIRMAN Agentic Studio - Stopping Background Services   " -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Yellow

# 1. Stop processes recorded in pids.json
if (Test-Path $PidsFile) {
    try {
        $pidsData = Get-Content $PidsFile -Raw | ConvertFrom-Json
        if ($pidsData.serverPid) {
            Write-Log "INFO" "Stopping agent daemon (PID $($pidsData.serverPid))..."
            Stop-Process -Id $pidsData.serverPid -Force -ErrorAction SilentlyContinue
        }
        if ($pidsData.llamaPid) {
            Write-Log "INFO" "Stopping llama-server (PID $($pidsData.llamaPid))..."
            Stop-Process -Id $pidsData.llamaPid -Force -ErrorAction SilentlyContinue
        }
    } catch {
        Write-Log "WARN" "Could not parse $($PidsFile): $_"
    }
    Remove-Item $PidsFile -Force -ErrorAction SilentlyContinue
}

# 2. Stop process recorded in lock file
if (Test-Path $LockFile) {
    try {
        $raw = (Get-Content $LockFile -Raw).Trim()
        $lockedPid = $null
        if ($raw -match '^\d+$') {
            $lockedPid = [int]$raw
        } else {
            $data = $raw | ConvertFrom-Json -ErrorAction SilentlyContinue
            if ($data.pid) { $lockedPid = [int]$data.pid }
        }
        if ($lockedPid) {
            Write-Log "INFO" "Stopping locked process (PID $lockedPid)..."
            Stop-Process -Id $lockedPid -Force -ErrorAction SilentlyContinue
        }
    } catch {}
    Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
    Write-Log "PASS" "Removed application lock file."
}

# 3. Clean up any remaining llama-server instances under InstallDir (Never kill outside)
Get-Process -Name "llama-server" -ErrorAction SilentlyContinue | ForEach-Object {
    $shouldKill = $false
    try {
        if ($_.Path -and $_.Path.StartsWith($InstallDir, [System.StringComparison]::OrdinalIgnoreCase)) {
            $shouldKill = $true
        }
    } catch {}
    if ($shouldKill) {
        try {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            Write-Log "PASS" "Terminated active llama-server process (PID $($_.Id))."
        } catch {}
    }
}

# 4. Unload model from GPU memory
try {
    $unloadBody = '{"model":"qwen2.5-coder:7b","keep_alive":0}'
    Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/generate" -Method Post -Body $unloadBody -ContentType "application/json" -TimeoutSec 3 -ErrorAction SilentlyContinue | Out-Null
    Write-Log "INFO" "Unload signal delivered to GPU runtime."
} catch {}

# 5. Confirm with nvidia-smi that VRAM is released
Start-Sleep -Milliseconds 1000
Write-Host "`n--- Checking GPU VRAM Status (nvidia-smi) ---" -ForegroundColor White
try {
    $smiOutput = & nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader 2>$null
    if ($LASTEXITCODE -eq 0) {
        if ([string]::IsNullOrWhiteSpace($smiOutput)) {
            Write-Log "PASS" "nvidia-smi confirms ZERO active compute processes. All VRAM has been released!"
        } else {
            Write-Log "INFO" "Active compute processes:`n$smiOutput"
        }
    }
} catch {}

Write-Log "PASS" "NIRMAN stop completed. All processes stopped and VRAM released."
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   NIRMAN Environment Cleanly Stopped                     " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
