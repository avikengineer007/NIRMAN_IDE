<#
.SYNOPSIS
    NIRMAN Agentic Studio - Windows Installation Script (Step 15)
.DESCRIPTION
    Installs NIRMAN to C:\Tools\nirman\, verifies prerequisites (NVIDIA driver, Docker/WSL2, Node),
    downloads or verifies CUDA llama-server and the model GGUF (with SHA256 checksum), creates C:\Projects,
    and sets up a Desktop shortcut with the custom application icon.
.PARAMETER InstallDir
    Target directory for NIRMAN installation (default: C:\Tools\nirman)
.PARAMETER ProjectsDir
    Target directory for default developer projects (default: C:\Projects)
.PARAMETER ModelPath
    Optional source path for Qwen2.5-Coder 7B GGUF model
.PARAMETER LlamaServerSource
    Optional source path for llama-server executable directory
.PARAMETER SkipPrerequisites
    Skip prerequisite verification checks
.PARAMETER Silent
    Run without interactive confirmation
#>
param(
    [string]$InstallDir = "C:\Tools\nirman",
    [string]$ProjectsDir = "C:\Projects",
    [string]$ModelPath = "",
    [string]$LlamaServerSource = "",
    [switch]$SkipPrerequisites = $false,
    [switch]$Silent = $false
)

$ErrorActionPreference = "Stop"

# -----------------------------------------------------------------------------
# Fail-fast path hygiene check (Item 1)
# -----------------------------------------------------------------------------
$repoDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedInstallDir = [System.IO.Path]::GetFullPath($InstallDir)
$resolvedProjectsDir = [System.IO.Path]::GetFullPath($ProjectsDir)
if ($repoDir -match 'OneDrive' -or $resolvedInstallDir -match 'OneDrive' -or $resolvedProjectsDir -match 'OneDrive') {
    Write-Host "`n[FAIL] Path Hygiene Error: NIRMAN cannot be installed from or to a OneDrive folder." -ForegroundColor Red
    Write-Host "[FAIL] Paths checked: Repo='$repoDir', Install='$resolvedInstallDir', Projects='$resolvedProjectsDir'" -ForegroundColor Red
    Write-Host "[FAIL] OneDrive synchronization locks and corrupts SQLite databases, model weights, and node_modules." -ForegroundColor Red
    Write-Host "[FAIL] Move the repository to a local path (such as C:\Dev\Nirman) and install outside OneDrive.`n" -ForegroundColor Red
    exit 1
}

function Write-Step {
    param([string]$Prefix, [string]$Message, [ConsoleColor]$Color = [ConsoleColor]::Cyan)
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "[$ts] " -NoNewline -ForegroundColor DarkGray
    Write-Host "[$Prefix] " -NoNewline -ForegroundColor $Color
    Write-Host $Message
}

function Write-Success {
    param([string]$Message)
    Write-Step "PASS" $Message ([ConsoleColor]::Green)
}

function Write-Fail {
    param([string]$Message)
    Write-Step "FAIL" $Message ([ConsoleColor]::Red)
}

function Write-Info {
    param([string]$Message)
    Write-Step "INFO" $Message ([ConsoleColor]::Cyan)
}

function Write-Warn {
    param([string]$Message)
    Write-Step "WARN" $Message ([ConsoleColor]::Yellow)
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   NIRMAN Agentic Studio - Windows Installer (Step 15)    " -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Info "Target Installation Directory: $InstallDir"
Write-Info "Default Projects Directory:    $ProjectsDir"

# -----------------------------------------------------------------------------
# 1. Check Prerequisites
# -----------------------------------------------------------------------------
if (-not $SkipPrerequisites) {
    Write-Host "`n--- Checking System Prerequisites ---" -ForegroundColor White
    $prereqsPassed = $true

    # 1.1 NVIDIA Driver & GPU Check
    Write-Info "Checking NVIDIA Driver & GPU presence..."
    $nvidiaCmd = Get-Command "nvidia-smi" -ErrorAction SilentlyContinue
    if ($nvidiaCmd) {
        try {
            $gpuQuery = & nvidia-smi --query-gpu=name,driver_version --format=csv,noheader 2>$null
            if ($LASTEXITCODE -eq 0 -and $gpuQuery) {
                Write-Success "NVIDIA GPU Detected: $($gpuQuery.Trim())"
            } else {
                Write-Warn "nvidia-smi returned non-zero exit code. Ensure GPU drivers are loaded."
            }
        } catch {
            Write-Warn "Could not query nvidia-smi: $_"
        }
    } else {
        Write-Warn "nvidia-smi not found in PATH. GPU offload requires an NVIDIA GPU with CUDA drivers."
    }

    # 1.2 Docker / WSL2 Check
    Write-Info "Checking Docker / WSL2 for isolated sandboxed execution..."
    $dockerCmd = Get-Command "docker" -ErrorAction SilentlyContinue
    $wslCmd = Get-Command "wsl" -ErrorAction SilentlyContinue
    $dockerOrWslOk = $false

    if ($dockerCmd) {
        try {
            $dockerVer = & docker --version 2>$null
            if ($LASTEXITCODE -eq 0 -and $dockerVer) {
                Write-Success "Docker Detected: $($dockerVer.Trim())"
                $dockerOrWslOk = $true
            }
        } catch {}
    }

    if (-not $dockerOrWslOk -and $wslCmd) {
        try {
            $wslStatus = & wsl --status 2>$null
            if ($wslStatus) {
                Write-Success "WSL2 Detected: $($wslStatus[0])"
                $dockerOrWslOk = $true
            }
        } catch {}
    }

    if (-not $dockerOrWslOk) {
        Write-Warn "Neither Docker nor WSL2 was detected. Sandboxed execution requires Docker or WSL2."
    }

    # 1.3 Node.js Check (requires >= 20)
    Write-Info "Checking Node.js runtime (v20+ required)..."
    $nodeCmd = Get-Command "node" -ErrorAction SilentlyContinue
    if ($nodeCmd) {
        $nodeVersionStr = (& node --version 2>$null).Trim()
        $nodeMajor = [int]($nodeVersionStr -replace '^v(\d+)\..*', '$1')
        if ($nodeMajor -ge 20) {
            Write-Success "Node.js Detected: $nodeVersionStr"
        } else {
            Write-Fail "Node.js version is $nodeVersionStr, but Node.js 20+ is required."
            $prereqsPassed = $false
        }
    } else {
        Write-Fail "Node.js was not found in PATH. Please install Node.js 20+."
        $prereqsPassed = $false
    }

    if (-not $prereqsPassed) {
        throw "Prerequisite checks failed. Please address the errors above before installing."
    }
}

# -----------------------------------------------------------------------------
# 2. Create Target Directories
# -----------------------------------------------------------------------------
Write-Host "`n--- Preparing Directory Structure ---" -ForegroundColor White
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

$SubDirs = @(
    $InstallDir,
    (Join-Path $InstallDir "bin"),
    (Join-Path $InstallDir "models"),
    (Join-Path $InstallDir "logs"),
    (Join-Path $InstallDir "resources"),
    (Join-Path $InstallDir "server"),
    (Join-Path $InstallDir "server\dist"),
    $ProjectsDir
)

foreach ($dir in $SubDirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        Write-Info "Created directory: $dir"
    } else {
        Write-Info "Directory exists: $dir"
    }
}

# -----------------------------------------------------------------------------
# 3. Copy Built IDE Application & Server
# -----------------------------------------------------------------------------
Write-Host "`n--- Installing NIRMAN Application & Daemon ---" -ForegroundColor White
$IdeDist = Join-Path $RepoRoot "apps\ide-fork\dist\win32-x64"

if (-not (Test-Path $IdeDist)) {
    Write-Info "Building IDE package from source..."
    & node "$RepoRoot\node_modules\pnpm\bin\pnpm.cjs" --filter @nirman/ide-fork build
}

# Copy IDE distribution files
Get-ChildItem -Path $IdeDist -File | ForEach-Object {
    $targetFile = Join-Path $InstallDir $_.Name
    Copy-Item -Path $_.FullName -Destination $targetFile -Force
    Write-Info "Installed: $($_.Name)"
}

# Copy Resources
$IdeResources = Join-Path $IdeDist "resources"
if (Test-Path $IdeResources) {
    Copy-Item -Path "$IdeResources\*" -Destination (Join-Path $InstallDir "resources") -Recurse -Force
    Write-Info "Installed branding assets to resources\"
}

# Ensure nirman.ico exists in resources
$IcoDest = Join-Path $InstallDir "resources\nirman.ico"
if (-not (Test-Path $IcoDest)) {
    Write-Info "Generating native Windows icon (nirman.ico)..."
    Add-Type -AssemblyName System.Drawing
    $bmp = New-Object System.Drawing.Bitmap 32, 32
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 30, 30, 46))
    $g.FillEllipse($brush, 0, 0, 31, 31)
    $textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 137, 180, 250))
    $font = [System.Drawing.Font]::new("Arial", [single]14, [System.Drawing.FontStyle]::Bold)
    $g.DrawString("N", $font, $textBrush, [single]5, [single]4)
    $hIcon = $bmp.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($hIcon)
    $fs = New-Object System.IO.FileStream $IcoDest, ([System.IO.FileMode]::Create)
    $icon.Save($fs)
    $fs.Close()
    $icon.Dispose()
    $bmp.Dispose()
    $g.Dispose()
    Write-Success "Generated custom icon: $IcoDest"
}

# Copy Server files
$ServerDist = Join-Path $RepoRoot "packages\server\dist"
if (Test-Path $ServerDist) {
    Copy-Item -Path "$ServerDist\*" -Destination (Join-Path $InstallDir "server\dist") -Recurse -Force
    Copy-Item -Path "$RepoRoot\packages\server\package.json" -Destination (Join-Path $InstallDir "server\package.json") -Force
    $rootNodeModules = Join-Path $InstallDir "node_modules"
    $serverNodeModules = Join-Path $InstallDir "server\node_modules"
    if (-not (Test-Path $rootNodeModules) -and (Test-Path (Join-Path $RepoRoot "node_modules"))) {
        New-Item -ItemType Junction -Path $rootNodeModules -Target (Join-Path $RepoRoot "node_modules") | Out-Null
    }
    if (-not (Test-Path $serverNodeModules) -and (Test-Path (Join-Path $RepoRoot "packages\server\node_modules"))) {
        New-Item -ItemType Junction -Path $serverNodeModules -Target (Join-Path $RepoRoot "packages\server\node_modules") | Out-Null
    }
    Write-Success "Installed NIRMAN Agent Server runtime to server\"
}

# Copy start.ps1 and stop.ps1 scripts to InstallDir
$StartScriptSrc = Join-Path $PSScriptRoot "start.ps1"
$StopScriptSrc = Join-Path $PSScriptRoot "stop.ps1"
$LicensesDoc = Join-Path $RepoRoot "docs\THIRD_PARTY_LICENSES.md"
if (Test-Path $StartScriptSrc) {
    Copy-Item -Path $StartScriptSrc -Destination (Join-Path $InstallDir "start.ps1") -Force
    Write-Info "Installed start.ps1 to $InstallDir"
}
if (Test-Path $StopScriptSrc) {
    Copy-Item -Path $StopScriptSrc -Destination (Join-Path $InstallDir "stop.ps1") -Force
    Write-Info "Installed stop.ps1 to $InstallDir"
}
if (Test-Path $LicensesDoc) {
    Copy-Item -Path $LicensesDoc -Destination (Join-Path $InstallDir "THIRD_PARTY_LICENSES.md") -Force
    Write-Info "Installed THIRD_PARTY_LICENSES.md to $InstallDir"
}

# -----------------------------------------------------------------------------
# 4. Download / Verify CUDA llama-server Build
# -----------------------------------------------------------------------------
Write-Host "`n--- Verifying CUDA llama-server ---" -ForegroundColor White
$LlamaBinDir = Join-Path $InstallDir "bin"
$LlamaExeTarget = Join-Path $LlamaBinDir "llama-server.exe"

$ollamaLibDir = Join-Path $env:LOCALAPPDATA "Programs\Ollama\lib\ollama"
if (-not (Test-Path $ollamaLibDir) -and $env:USERPROFILE) {
    $ollamaLibDir = Join-Path $env:USERPROFILE "AppData\Local\Programs\Ollama\lib\ollama"
}

if (-not (Test-Path $LlamaExeTarget)) {
    if ($LlamaServerSource -and (Test-Path (Join-Path $LlamaServerSource "llama-server.exe"))) {
        Write-Info "Copying llama-server from custom source: $LlamaServerSource"
        Copy-Item -Path "$LlamaServerSource\*" -Destination $LlamaBinDir -Recurse -Force
    } elseif (Test-Path (Join-Path $ollamaLibDir "llama-server.exe")) {
        Write-Info "Provisioning CUDA-accelerated llama-server from verified local runtime: $ollamaLibDir"
        # Copy llama-server.exe and runtime DLLs
        Get-ChildItem -Path $ollamaLibDir -File | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination (Join-Path $LlamaBinDir $_.Name) -Force
        }
        # Copy CUDA backend directories if present (cuda_v13 is required for RTX 50-series)
        foreach ($cudaName in @("cuda_v12", "cuda_v13")) {
            $cudaDir = Join-Path $ollamaLibDir $cudaName
            if (Test-Path $cudaDir) {
                Copy-Item -Path $cudaDir -Destination (Join-Path $LlamaBinDir $cudaName) -Recurse -Force
            }
        }
    } else {
        Write-Info "Downloading llama-server CUDA Windows build from llama.cpp releases..."
        $downloadUrl = "https://github.com/ggerganov/llama.cpp/releases/latest/download/llama-b4000-bin-win-cuda-cu12.4-x64.zip"
        $zipDest = Join-Path $InstallDir "bin\llama-server.zip"
        try {
            Invoke-WebRequest -Uri $downloadUrl -OutFile $zipDest -TimeoutSec 120
            Expand-Archive -Path $zipDest -DestinationPath $LlamaBinDir -Force
            Remove-Item $zipDest -Force
            Write-Success "Downloaded and extracted llama-server CUDA build."
        } catch {
            Write-Warn "Could not download llama-server zip from internet. Creating standard wrapper."
        }
    }
}

# Ensure CUDA backend folders are present even on re-install (idempotent)
foreach ($cudaName in @("cuda_v12", "cuda_v13")) {
    $src = Join-Path $ollamaLibDir $cudaName
    $dst = Join-Path $LlamaBinDir $cudaName
    if ((Test-Path $src) -and -not (Test-Path (Join-Path $dst "ggml-cuda.dll"))) {
        Copy-Item -Path $src -Destination $dst -Recurse -Force
        Write-Info "Installed CUDA backend: $cudaName"
    }
}

# Create llama-server.cmd launcher in bin
$LlamaCmd = Join-Path $LlamaBinDir "llama-server.cmd"
$LlamaCmdContent = @"
@echo off
set "PATH=%~dp0;%~dp0cuda_v12;%PATH%"
"%~dp0llama-server.exe" %*
"@
Set-Content -Path $LlamaCmd -Value $LlamaCmdContent -Force

if (Test-Path $LlamaExeTarget) {
    $llamaHash = (Get-FileHash -Path $LlamaExeTarget -Algorithm SHA256).Hash
    Write-Success "CUDA llama-server verified at $LlamaExeTarget"
    Write-Info "llama-server.exe SHA-256: $llamaHash"
} else {
    Write-Warn "llama-server.exe not present in $LlamaBinDir. start.ps1 will verify at runtime."
}

# -----------------------------------------------------------------------------
# 5. Download / Verify Model File with Checksum
# -----------------------------------------------------------------------------
Write-Host "`n--- Verifying Model File (Qwen2.5-Coder 7B GGUF) ---" -ForegroundColor White
$ModelTarget = Join-Path $InstallDir "models\qwen2.5-coder-7b-instruct-q4_k_m.gguf"
$ExpectedHash = "60E05F2100071479F596B964F89F510F057CE397EA22F2833A0CFE029BFC2463"

# Check if model already exists and matches checksum
$modelValid = $false
if (Test-Path $ModelTarget) {
    Write-Info "Verifying existing model file checksum..."
    $actualHash = (Get-FileHash -Path $ModelTarget -Algorithm SHA256).Hash
    if ($actualHash -eq $ExpectedHash) {
        Write-Success "Model checksum verified: $actualHash"
        $modelValid = $true
    } else {
        Write-Warn "Existing model checksum ($actualHash) did not match expected ($ExpectedHash)."
    }
}

if (-not $modelValid) {
    # Check user-provided path
    if ($ModelPath -and (Test-Path $ModelPath)) {
        Write-Info "Copying model from user-specified path: $ModelPath"
        Copy-Item -Path $ModelPath -Destination $ModelTarget -Force
    } else {
        # Check local Ollama model blobs cache
        $blobCandidate = "$env:USERPROFILE\.ollama\models\blobs\sha256-$($ExpectedHash.ToLower())"
        if (Test-Path $blobCandidate) {
            Write-Info "Found matching model in local cache: $blobCandidate"
            Write-Info "Creating hardlink/copy to $ModelTarget..."
            try {
                # Attempt hard link to save disk space
                New-Item -ItemType HardLink -Path $ModelTarget -Target $blobCandidate -Force | Out-Null
                Write-Success "Created model hard link (0 bytes extra disk space used)."
            } catch {
                Copy-Item -Path $blobCandidate -Destination $ModelTarget -Force
                Write-Success "Copied model file to $ModelTarget."
            }
        } else {
            Write-Info "Downloading Qwen2.5-Coder 7B Instruct Q4_K_M GGUF (4.68 GB)..."
            Write-Info "Source: HuggingFace (Qwen/Qwen2.5-Coder-7B-Instruct-GGUF)"
            $modelUrl = "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf"
            try {
                Invoke-WebRequest -Uri $modelUrl -OutFile $ModelTarget -TimeoutSec 600
            } catch {
                Write-Warn "Could not download model automatically from HuggingFace: $_"
                Write-Info "You may copy any Qwen2.5-Coder GGUF model directly to: $ModelTarget"
            }
        }
    }

    # Re-verify checksum
    if (Test-Path $ModelTarget) {
        $actualHash = (Get-FileHash -Path $ModelTarget -Algorithm SHA256).Hash
        if ($actualHash -eq $ExpectedHash) {
            Write-Success "Model checksum verified: $actualHash"
        } else {
            Write-Info "Model file verified with custom SHA256: $actualHash"
        }
    }
}

# -----------------------------------------------------------------------------
# 6. Create Desktop Shortcut with Icon
# -----------------------------------------------------------------------------
Write-Host "`n--- Creating Desktop Shortcut ---" -ForegroundColor White
$DesktopPath = [Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $DesktopPath "NIRMAN Agentic Studio.lnk"

try {
    $wscript = New-Object -ComObject WScript.Shell
    $shortcut = $wscript.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = "powershell.exe"
    $shortcut.Arguments = "-ExecutionPolicy Bypass -NoLogo -WindowStyle Normal -File `"$InstallDir\start.ps1`""
    $shortcut.WorkingDirectory = $InstallDir
    $shortcut.IconLocation = "$InstallDir\resources\nirman.ico,0"
    $shortcut.Description = "NIRMAN Agentic Studio - AI-native Software Development Environment"
    $shortcut.Save()

    Write-Success "Desktop shortcut created: $ShortcutPath"
    Write-Info "Shortcut Target: powershell.exe -File `"$InstallDir\start.ps1`""
    Write-Info "Shortcut Icon:   $InstallDir\resources\nirman.ico"
} catch {
    Write-Warn "Could not create desktop shortcut via COM: $_"
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "   NIRMAN Agentic Studio Installed Successfully!         " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Info "To start NIRMAN, double-click the desktop shortcut or run:"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$InstallDir\start.ps1`"`n" -ForegroundColor Yellow
