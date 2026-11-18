# Upstream Rebase & Maintenance Guide for NIRMAN IDE Fork

NIRMAN IDE is an agentic coding studio forked from Microsoft's open-source **Code-OSS** (MIT License). This document outlines the modular architecture and the step-by-step procedure for rebasing on upstream Code-OSS releases while keeping all custom modifications cleanly segregated.

---

## 1. Modular Architecture & Clean Separation

To prevent merge conflicts with upstream Code-OSS:

1. **Self-Contained NIRMAN Modules (`src/modules/*`):**
   - All agentic workflows, model setup wizards, and Open VSX integrations reside strictly under `apps/ide-fork/src/modules/`.
   - None of the core Code-OSS workbench files are modified inline.
2. **Product Configuration (`product.json`):**
   - Identity, icons, and branding are injected exclusively via `product.json`.
   - The extension gallery is switched from Microsoft Marketplace to **Open VSX**:
     ```json
     "extensionsGallery": {
       "serviceUrl": "https://open-vsx.org/vscode/gallery",
       "itemUrl": "https://open-vsx.org/vscode/item",
       "cacheUrl": "https://open-vsx.org/vscode/cache",
       "controlUrl": "https://open-vsx.org/vscode/control"
     }
     ```
3. **Telemetry & Proprietary Services Removed:**
   - Microsoft telemetry endpoints, Watson crash reports, and experiments are disabled (`"enableTelemetry": false`, `"telemetry": "off"`).
4. **Built-in Agent Extension:**
   - The NIRMAN extension (`@nirman/vscode-ext`) is bundled as a built-in extension, surfacing the **Agent Manager** as a first-class view in the primary sidebar.

---

## 2. Upstream Rebase Procedure

### Step 1: Add Upstream Code-OSS Remote
```bash
git remote add upstream https://github.com/microsoft/vscode.git
git fetch upstream --tags
```

### Step 2: Check Out Target Upstream Release
```bash
# Check out the target upstream Code-OSS stable tag
git checkout -b rebase/upstream-v1.96.0 tags/1.96.0
```

### Step 3: Rebase NIRMAN Modules
```bash
# Rebase our branch onto the upstream tag
git rebase tags/1.96.0
```

### Step 4: Verify Product & Extension Gallery Configuration
Ensure `product.json` retains:
1. `nameShort: "NIRMAN"`
2. `dataFolderName: ".nirman"`
3. `extensionsGallery` pointing to Open VSX
4. `enableTelemetry: false`

### Step 5: Test & Produce Distribution
```bash
pnpm install
pnpm build
pnpm test
pnpm --filter @nirman/ide-fork package:win32
```
