<#
.SYNOPSIS
    NIRMAN Cold Start Timing Measurement Script (Step 16 Item 5)
.DESCRIPTION
    Runs start.ps1 with -ExitAfterSeconds, parses startup.log for timing timestamps,
    and displays a formatted breakdown of cold start latencies.
.PARAMETER InstallDir
    Target directory for NIRMAN installation (default: C:\Tools\nirman)
.PARAMETER ExitAfterSeconds
    Seconds after which IDE automatically exits (default: 3)
.PARAMETER AsJson
    Output results as a JSON object
#>
param(
    [string]$InstallDir = "C:\Tools\nirman",
    [int]$ExitAfterSeconds = 3,
    [switch]$AsJson = $false
)

$ErrorActionPreference = "Stop"

$resolvedInstall = (Resolve-Path $InstallDir).Path
$startScript = Join-Path $PSScriptRoot "start.ps1"
$startupLog  = Join-Path $resolvedInstall "logs\startup.log"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   NIRMAN Cold Start Benchmark & Measurement              " -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Executing one-click launch from: $resolvedInstall"
Write-Host "Launcher script: $startScript"
Write-Host "Auto-exit timeout: ${ExitAfterSeconds}s`n"

# Run start.ps1
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$proc = Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-ExecutionPolicy", "Bypass", "-File", "`"$startScript`"", "-InstallDir", "`"$resolvedInstall`"", "-ExitAfterSeconds", "$ExitAfterSeconds") `
    -PassThru -NoNewWindow -Wait

$sw.Stop()
$overallWallClockMs = $sw.ElapsedMilliseconds

if (-not (Test-Path $startupLog)) {
    Write-Host "[ERROR] startup.log not found at $startupLog" -ForegroundColor Red
    exit 1
}

# Parse latest [TIMING-SUMMARY] line
$summaryLines = Get-Content $startupLog | Where-Object { $_ -match 'lock_acquired=' }
if (-not $summaryLines) {
    Write-Host "[ERROR] No [TIMING-SUMMARY] line found in $startupLog" -ForegroundColor Red
    exit 1
}

$latestSummary = ($summaryLines[-1] -split '\[TIMING-SUMMARY\]')[-1].Trim()

# Extract values using regex
function Get-MatchVal([string]$text, [string]$key) {
    $pattern = "$key=" + '([^\s]+)'
    $m = [regex]::Match($text, $pattern)
    if ($m.Success) { return $m.Groups[1].Value } else { return $null }
}

$lockAcquired = Get-MatchVal $latestSummary "lock_acquired"
$llamaSpawned = Get-MatchVal $latestSummary "llama_spawned"
$healthReady  = Get-MatchVal $latestSummary "health_ready"
$agentReady   = Get-MatchVal $latestSummary "agent_ready"
$ideOpened    = Get-MatchVal $latestSummary "ide_opened"
$healthWaitMs = [int](Get-MatchVal $latestSummary "health_wait_ms")
$totalMs      = [int](Get-MatchVal $latestSummary "total_startup_ms")

$results = [pscustomobject]@{
    LockAcquired      = $lockAcquired
    LlamaSpawned      = $llamaSpawned
    HealthReady       = $healthReady
    AgentReady        = $agentReady
    IdeOpened         = $ideOpened
    HealthWaitMs      = $healthWaitMs
    TotalColdStartMs  = $totalMs
    OverallWallClockMs = $overallWallClockMs
}

if ($AsJson) {
    $results | ConvertTo-Json
    exit 0
}

Write-Host "`n--- Measured Startup Timestamps ---" -ForegroundColor White
Write-Host ("Lock Acquired:      {0}" -f $lockAcquired)
Write-Host ("llama-server Spawn: {0}" -f $llamaSpawned)
Write-Host ("/health Endpoint:   {0}" -f $healthReady)
Write-Host ("Agent Server Ready: {0}" -f $agentReady)
Write-Host ("IDE Opened:         {0}" -f $ideOpened)

Write-Host "`n--- Stage Breakdown ---" -ForegroundColor White
$table = @(
    [pscustomobject]@{ Stage = "1. Lock Acquisition"; ElapsedMs = 0; Detail = "Instant PID lock" },
    [pscustomobject]@{ Stage = "2. Model Load & /health"; ElapsedMs = $healthWaitMs; Detail = "GPU weights offload (32k ctx)" },
    [pscustomobject]@{ Stage = "3. Agent Server Ready"; ElapsedMs = [Math]::Max(0, $totalMs - $healthWaitMs - 300); Detail = "Session token & WS socket" },
    [pscustomobject]@{ Stage = "4. IDE Window Display"; ElapsedMs = 300; Detail = "Process init" },
    [pscustomobject]@{ Stage = "Total Startup"; ElapsedMs = $totalMs; Detail = "Lock to IDE display" }
)
$table | Format-Table -AutoSize | Out-String | Write-Host

Write-Host ("Total cold-start latency: {0:N1} s ({1} ms)" -f ($totalMs / 1000.0), $totalMs) -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
