<#
.SYNOPSIS
    NIRMAN Agentic Studio - Clean Uninstaller (Step 16 Item 8)
.DESCRIPTION
    Stops running NIRMAN processes, removes C:\Tools\nirman, removes Desktop shortcut,
    and prompts separately whether to delete models and projects (defaulting to keep both).
.PARAMETER InstallDir
    Target directory for NIRMAN installation (default: C:\Tools\nirman)
.PARAMETER ProjectsDir
    Default projects directory (default: C:\Projects)
.PARAMETER DeleteModels
    Explicit switch to delete downloaded model weights
.PARAMETER DeleteProjects
    Explicit switch to delete user project files
.PARAMETER Silent
    Non-interactive execution (defaults to keeping models and projects)
#>
param(
    [string]$InstallDir = "C:\Tools\nirman",
    [string]$ProjectsDir = "C:\Projects",
    [switch]$DeleteModels = $false,
    [switch]$DeleteProjects = $false,
    [switch]$Silent = $false
)

$ErrorActionPreference = "Continue"

Write-Host "==========================================================" -ForegroundColor Yellow
Write-Host "   NIRMAN Agentic Studio - Uninstaller                    " -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Yellow

# 1. Stop all active processes
$stopScript = Join-Path $InstallDir "stop.ps1"
if (Test-Path $stopScript) {
    Write-Host "[INFO] Stopping active NIRMAN services..." -ForegroundColor Cyan
    & powershell -ExecutionPolicy Bypass -File $stopScript
} else {
    Get-Process -Name "llama-server" -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -and $_.Path.StartsWith($InstallDir) } catch { $false }
    } | Stop-Process -Force -ErrorAction SilentlyContinue
}

# 2. Handle Model deletion choice
$modelsDir = Join-Path $InstallDir "models"
$shouldDeleteModels = $DeleteModels.IsPresent
if (-not $Silent -and -not $DeleteModels.IsPresent -and (Test-Path $modelsDir)) {
    $choice = Read-Host "`nDo you want to delete downloaded model weights (~4.7 GB)? [y/N] (Default: No)"
    if ($choice -match '^[yY]') { $shouldDeleteModels = $true }
}

# 3. Handle Projects deletion choice
$shouldDeleteProjects = $DeleteProjects.IsPresent
if (-not $Silent -and -not $DeleteProjects.IsPresent -and (Test-Path $ProjectsDir)) {
    $choice = Read-Host "Do you want to delete user projects directory ($ProjectsDir)? [y/N] (Default: No)"
    if ($choice -match '^[yY]') { $shouldDeleteProjects = $true }
}

# If keeping models, move or preserve them if InstallDir is being purged
if (Test-Path $InstallDir) {
    if (-not $shouldDeleteModels -and (Test-Path $modelsDir)) {
        Write-Host "[INFO] Preserving model directory: $modelsDir" -ForegroundColor Cyan
        Get-ChildItem -Path $InstallDir -Exclude "models" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host "[INFO] Removing installation directory: $InstallDir" -ForegroundColor Cyan
        Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# 4. Remove Desktop Shortcut
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcut = Join-Path $desktopPath "NIRMAN Agentic Studio.lnk"
if (Test-Path $shortcut) {
    Remove-Item -Path $shortcut -Force -ErrorAction SilentlyContinue
    Write-Host "[PASS] Removed Desktop shortcut: $shortcut" -ForegroundColor Green
}

# 5. Delete projects directory only if explicitly confirmed
if ($shouldDeleteProjects -and (Test-Path $ProjectsDir)) {
    Remove-Item -Path $ProjectsDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "[PASS] Deleted projects directory: $ProjectsDir" -ForegroundColor Green
} else {
    Write-Host "[INFO] User projects preserved at: $ProjectsDir" -ForegroundColor Cyan
}

Write-Host "`n[PASS] NIRMAN Agentic Studio has been successfully uninstalled." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Yellow
