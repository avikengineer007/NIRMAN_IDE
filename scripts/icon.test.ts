import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * [SCRIPTED TEST]
 * Step 16 Item 6: Icon Asset Verification
 */
describe('[SCRIPTED] Step 16 Item 6: Icon Asset Verification', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const icoPath = path.join(repoRoot, 'assets', 'icons', 'nirman.ico');
  const previewPath = path.join(repoRoot, 'assets', 'icons', 'preview.png');
  const logo512 = path.join(repoRoot, 'assets', 'branding', 'logo-512.png');
  const logo1024 = path.join(repoRoot, 'assets', 'branding', 'logo-1024.png');
  const productJson = path.join(repoRoot, 'apps', 'ide-fork', 'product.json');
  const installPs1 = path.join(repoRoot, 'scripts', 'install.ps1');

  it('contains nirman.ico with all 7 required frames (16, 24, 32, 48, 64, 128, 256)', () => {
    expect(fs.existsSync(icoPath)).toBe(true);

    const pyCheck = [
      'import json',
      'from PIL import Image',
      `ico = Image.open(r'${icoPath.replace(/\\/g, '/')}')`,
      "sizes = sorted([s[0] for s in getattr(ico, 'info', {}).get('sizes', [])])",
      'print(json.dumps(sizes))',
    ].join('; ');
    const out = execSync(`python -c "${pyCheck}"`, { encoding: 'utf-8' }).trim();
    const parsedSizes = JSON.parse(out);

    expect(parsedSizes).toEqual([16, 24, 32, 48, 64, 128, 256]);
  });

  it('contains 512px and 1024px PNG masters in assets/branding/', () => {
    expect(fs.existsSync(logo512)).toBe(true);
    expect(fs.existsSync(logo1024)).toBe(true);

    const pyDims = [
      'from PIL import Image',
      `im512 = Image.open(r'${logo512.replace(/\\/g, '/')}')`,
      `im1024 = Image.open(r'${logo1024.replace(/\\/g, '/')}')`,
      "print(f'{im512.width}x{im512.height},{im1024.width}x{im1024.height}')",
    ].join('; ');
    const out = execSync(`python -c "${pyDims}"`, { encoding: 'utf-8' }).trim();
    expect(out).toBe('512x512,1024x1024');
  });

  it('contains 1x/2x contact sheet at assets/icons/preview.png', () => {
    expect(fs.existsSync(previewPath)).toBe(true);
    const stat = fs.statSync(previewPath);
    expect(stat.size).toBeGreaterThan(1000);
  });

  it('hooks icon into product.json, install.ps1, and installed app resources', () => {
    const pJson = JSON.parse(fs.readFileSync(productJson, 'utf-8'));
    expect(pJson.win32AppIcon).toContain('nirman.ico');

    const installContent = fs.readFileSync(installPs1, 'utf-8');
    expect(installContent).toContain('nirman.ico');
    expect(installContent).toContain('IconLocation');
  });
});
