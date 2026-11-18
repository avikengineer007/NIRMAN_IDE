param(
    [string]$Action,
    [string]$LockFile
)

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
        } else {
            $data = $raw | ConvertFrom-Json -ErrorAction Stop
            $pidNum = [int]$data.pid
            if ($data.startTime) { $lockStartTime = [DateTime]::Parse($data.startTime) }
            if ($data.processName) { $lockProcName = [string]$data.processName }
        }

        $proc = Get-Process -Id $pidNum -ErrorAction SilentlyContinue
        if (-not $proc) {
            return @{ Live = $false; Reason = "Process PID $pidNum does not exist" }
        }

        if ($lockProcName -and ($proc.ProcessName -ne $lockProcName)) {
            return @{ Live = $false; Reason = "PID $pidNum reused by unrelated process '$($proc.ProcessName)' (expected '$lockProcName')" }
        }

        if ($lockStartTime) {
            $timeDiffSec = [Math]::Abs(($proc.StartTime.ToUniversalTime() - $lockStartTime.ToUniversalTime()).TotalSeconds)
            if ($timeDiffSec -gt 5) {
                return @{ Live = $false; Reason = "PID $pidNum reused: start time mismatch ($($proc.StartTime.ToString('o')) vs $($lockStartTime.ToString('o')))" }
            }
        }

        return @{ Live = $true; Process = $proc; Pid = $pidNum }
    } catch {
        return @{ Live = $false; Reason = "Corrupt lock file: $_" }
    }
}

if ($Action -eq "create-live") {
    $p = Get-Process -Id $PID
    @{
        pid = $PID
        startTime = $p.StartTime.ToUniversalTime().ToString("o")
        processName = $p.ProcessName
    } | ConvertTo-Json | Set-Content -Path $LockFile -Force
    Write-Output "CREATED_LIVE"
} elseif ($Action -eq "test-lock") {
    $res = Test-LockLive $LockFile
    if ($res.Live) {
        Write-Output "LOCK_LIVE"
    } else {
        Write-Output "STALE: $($res.Reason)"
    }
}
