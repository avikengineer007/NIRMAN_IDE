import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  ProductConfigurationManager,
  FirstRunSetupManager,
  OpenVsxGalleryClient,
  BuiltinExtensionManager,
  buildWindowsPackage,
} from './index.js';

describe('apps/ide-fork Unit Tests', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-fork-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('loads rebranded product.json with Open VSX and telemetry disabled', async () => {
    const productPath = path.join(tempDir, 'product.json');
    const mockProduct = {
      nameShort: 'NIRMAN',
      nameLong: 'NIRMAN Agentic Studio',
      applicationName: 'nirman',
      dataFolderName: '.nirman',
      version: '1.0.0',
      enableTelemetry: false,
      telemetry: 'off',
      extensionsGallery: {
        serviceUrl: 'https://open-vsx.org/vscode/gallery',
        itemUrl: 'https://open-vsx.org/vscode/item',
        cacheUrl: 'https://open-vsx.org/vscode/cache',
        controlUrl: 'https://open-vsx.org/vscode/control',
      },
    };
    await fs.writeFile(productPath, JSON.stringify(mockProduct, null, 2), 'utf-8');

    const manager = new ProductConfigurationManager(productPath);
    const config = await manager.load();

    expect(config.nameShort).toBe('NIRMAN');
    expect(config.nameLong).toBe('NIRMAN Agentic Studio');
    expect(config.dataFolderName).toBe('.nirman');
    expect(manager.isTelemetryEnabled()).toBe(false);
    expect(manager.isOpenVsxGallery()).toBe(true);
    expect(manager.getGalleryServiceUrl()).toBe('https://open-vsx.org/vscode/gallery');
  });

  it('executes first-run setup flow for model endpoint and caches config', async () => {
    const configDir = path.join(tempDir, '.nirman');
    let healthChecked = false;

    const setup = new FirstRunSetupManager({
      configDir,
      healthChecker: (_url) => {
        healthChecked = true;
        return Promise.resolve(true);
      },
    });

    expect(await setup.isConfigured()).toBe(false);

    // Run first-time setup
    const result1 = await setup.runSetup({
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'qwen2.5-coder:7b',
      contextWindowLimit: 32_768,
    });

    expect(result1.isNewSetup).toBe(true);
    expect(result1.config.model).toBe('qwen2.5-coder:7b');
    expect(healthChecked).toBe(true);
    expect(await setup.isConfigured()).toBe(true);

    // Second run should load existing config without overwriting
    const result2 = await setup.runSetup();
    expect(result2.isNewSetup).toBe(false);
    expect(result2.config.model).toBe('qwen2.5-coder:7b');
  });

  it('searches, installs, and lists extensions from Open VSX', async () => {
    const extensionsDir = path.join(tempDir, 'extensions');
    const client = new OpenVsxGalleryClient('https://open-vsx.org/vscode/gallery');

    // Search extensions
    const searchResults = await client.search('python');
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0]?.id).toBeDefined();

    // Install extension
    const installed = await client.installExtension('ms-python.python', extensionsDir, {
      displayName: 'Python Language Support',
      version: '2026.1.0',
    });

    expect(installed.id).toBe('ms-python.python');
    expect(installed.version).toBe('2026.1.0');

    // List installed
    const allInstalled = await client.listInstalled(extensionsDir);
    expect(allInstalled.length).toBe(1);
    expect(allInstalled[0]?.id).toBe('ms-python.python');
    expect(allInstalled[0]?.packageJson['name']).toBe('python');
  });

  it('bundles built-in extension with Agent Manager as first-class view', () => {
    const builtinManager = new BuiltinExtensionManager();
    const metadata = builtinManager.getMetadata();

    expect(metadata.isFirstClassView).toBe(true);
    expect(metadata.views).toContain('nirman.agentManagerView');
    expect(metadata.views).toContain('nirman.chatView');
  });

  it('produces Windows package build artifacts in dist/win32-x64', async () => {
    const buildOutputDir = path.join(tempDir, 'dist', 'win32-x64');

    const result = await buildWindowsPackage({
      outputDir: buildOutputDir,
    });

    expect(result.filesGenerated).toContain('nirman.exe');
    expect(result.filesGenerated).toContain('nirman.cmd');
    expect(result.filesGenerated).toContain('product.json');
    expect(result.filesGenerated).toContain('build-manifest.json');

    // Verify files on disk
    const statExe = await fs.stat(path.join(buildOutputDir, 'nirman.exe'));
    expect(statExe.isFile()).toBe(true);
    expect(statExe.size).toBeGreaterThan(0);

    const manifestRaw = await fs.readFile(result.manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
    expect(manifest['platform']).toBe('win32-x64');
    expect(manifest['target']).toBe('Windows');
    expect(manifest['extensionGallery']).toBe('Open VSX');
    expect(manifest['telemetry']).toBe('disabled');
  });
});
