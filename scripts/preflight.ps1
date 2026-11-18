<#
.SYNOPSIS
    NIRMAN preflight: checks prerequisites and prints a pass/fail table. Changes nothing.
.DESCRIPTION
    Exit code 0 = no FAIL rows (WARN allowed). Exit code 1 = at least one FAIL.
    Thresholds are stated in the table so they can be audited:
      - Disk: 15 GB free on the install drive (model 4.7 GB + CUDA runtime ~2 GB + headroom; chosen, not measured).
      - Free VRAM: 6144 MiB (measured on RTX 5050: model + 32k context used ~5.9 GiB).
#>
param(
    [string]$InstallDir  = "C:\Tools\nirman",
    [string]$ProjectsDir = "C:\Projects",
    [int]$MinDiskGB   = 15,
    [int]$MinFreeVramMiB = 6144,
    [int]$MinNodeMajor = 20
)

$rows = New-Object System.Collections.Generic.List[object]
function Add-Row($Check, $Status, $Detail) { $rows.Add([pscustomobject]@{ Check = $Check; Status = $Status; Detail = $Detail }) }

# 1. Windows
$os = [Environment]::OSVersion.Version
if ($os.Major -ge 10) { Add-Row "Windows" "PASS" "version $os" } else { Add-Row "Windows" "FAIL" "version $os (Windows 10+ required)" }

# 2. GPU + driver
$smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
$gpuTotal = $null; $gpuFree = $null
if (-not $smi) {
    Add-Row "NVIDIA GPU/driver" "FAIL" "nvidia-smi not found (install an NVIDIA driver)"
    Add-Row "Free VRAM" "FAIL" "cannot query without nvidia-smi"
} else {
    $q = & nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used --format=csv,noheader,nounits 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $q) {
        Add-Row "NVIDIA GPU/driver" "FAIL" "nvidia-smi failed (exit $LASTEXITCODE)"
        Add-Row "Free VRAM" "FAIL" "cannot query"
    } else {
        $f = ($q | Select-Object -First 1) -split ',\s*'
        $gpuTotal = [int]$f[2]; $gpuFree = $gpuTotal - [int]$f[3]
        Add-Row "NVIDIA GPU/driver" "PASS" "$($f[0]), driver $($f[1])"
        if ($gpuFree -ge $MinFreeVramMiB) { Add-Row "Free VRAM" "PASS" "$gpuFree MiB free of $gpuTotal (need >= $MinFreeVramMiB)" }
        else { Add-Row "Free VRAM" "FAIL" "$gpuFree MiB free of $gpuTotal (need >= $MinFreeVramMiB; close GPU apps / stop Ollama)" }
    }
}

# 3. Other GPU users (informational)
if ($smi) {
    $apps = (& nvidia-smi --query-compute-apps=pid,process_name --format=csv,noheader 2>$null | Measure-Object).Count
    $ollama = Get-Process -Name "ollama*" -ErrorAction SilentlyContinue
    if ($ollama) { Add-Row "Ollama running" "WARN" "ollama is running and may hold VRAM; stop it before GPU tests" }
    else { Add-Row "Ollama running" "PASS" "not running" }
    Add-Row "GPU process count" "INFO" "$apps processes listed by nvidia-smi (desktop apps count)"
}

# 4. Docker / WSL2
$dockerOk = $false; $wslOk = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
    $dv = & docker --version 2>$null
    if ($LASTEXITCODE -eq 0) { $dockerOk = $true; Add-Row "Docker" "PASS" ($dv -join ' ') }
}
if (Get-Command wsl -ErrorAction SilentlyContinue) {
    $null = & wsl --status 2>$null
    if ($LASTEXITCODE -eq 0) { $wslOk = $true; Add-Row "WSL2" "PASS" "wsl --status OK" }
}
if (-not $dockerOk -and -not $wslOk) { Add-Row "Docker/WSL2" "FAIL" "neither Docker nor WSL2 detected" }
elseif (-not $dockerOk) { Add-Row "Docker" "WARN" "not found (WSL2 present)" }

# 5. Node
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Add-Row "Node.js" "FAIL" "not found (need $MinNodeMajor+)" }
else {
    $nv = (& node --version).Trim()
    $major = [int]($nv -replace '^v(\d+)\..*', '$1')
    if ($major -ge $MinNodeMajor) { Add-Row "Node.js" "PASS" "$nv" } else { Add-Row "Node.js" "FAIL" "$nv (need $MinNodeMajor+)" }
}

# 6. Disk space on install drive (estimate)
try {
    $root = [System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($InstallDir))
    $drive = New-Object System.IO.DriveInfo($root)
    $freeGB = [math]::Round($drive.AvailableFreeSpace / 1GB, 1)
    if ($freeGB -ge $MinDiskGB) { Add-Row "Disk space ($root, est.)" "PASS" "$freeGB GB free (need >= $MinDiskGB GB est.)" }
    else { Add-Row "Disk space ($root, est.)" "FAIL" "$freeGB GB free (need >= $MinDiskGB GB est.)" }
} catch { Add-Row "Disk space" "FAIL" "could not determine: $($_.Exception.Message)" }

# 7. Paths (OneDrive is forbidden: sync locks/corrupts files)
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$oneDriveFound = $false
foreach ($p in @($repo, $InstallDir, $ProjectsDir)) {
    if ($p -match 'OneDrive') {
        Add-Row "Path outside OneDrive" "FAIL" "$p is inside OneDrive (sync can lock/corrupt files)"
        $oneDriveFound = $true
    }
}
if (-not $oneDriveFound) {
    Add-Row "Path outside OneDrive" "PASS" "all paths outside OneDrive"
}
if (Test-Path $InstallDir) { Add-Row "Existing install" "INFO" "$InstallDir already exists (upgrade/re-install)" }
else { Add-Row "Existing install" "INFO" "none found at $InstallDir (fresh install)" }

# Output
$rows | Format-Table -AutoSize Check, Status, Detail | Out-String -Width 200 | Write-Host
$fails = @($rows | Where-Object Status -eq 'FAIL').Count
$warns = @($rows | Where-Object Status -eq 'WARN').Count
Write-Host "Summary: $fails FAIL, $warns WARN" -ForegroundColor $(if ($fails) { 'Red' } elseif ($warns) { 'Yellow' } else { 'Green' })
if ($fails) { exit 1 } else { exit 0 }
