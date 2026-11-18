import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserDriver } from './browser-driver.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

describe('BrowserDriver with Playwright', () => {
  let driver: BrowserDriver;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nirman-browser-driver-test-'));
    driver = new BrowserDriver({ headless: true });
  });

  afterAll(async () => {
    await driver.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('launches browser, sets HTML content, and interacts with elements', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Test App</title></head>
        <body>
          <h1>Welcome to Test App</h1>
          <input id="name-input" type="text" placeholder="Enter name" />
          <button id="greet-btn">Greet</button>
          <div id="greeting-output"></div>
          <script>
            document.getElementById('greet-btn').addEventListener('click', () => {
              const val = document.getElementById('name-input').value;
              document.getElementById('greeting-output').textContent = 'Hello, ' + val + '!';
            });
          </script>
        </body>
      </html>
    `;

    await driver.setContent(html);

    // Verify initial render
    const heading = await driver.getTextContent('h1');
    expect(heading).toBe('Welcome to Test App');

    // Type into input
    await driver.type('#name-input', 'Nirman Agent');

    // Click button
    await driver.click('#greet-btn');

    // Verify DOM update
    const greeting = await driver.getTextContent('#greeting-output');
    expect(greeting).toBe('Hello, Nirman Agent!');
  });

  it('extracts compact, structured DOM summary for LLM context', async () => {
    const dom = await driver.getDomSummary(1000);

    expect(dom.title).toBe('Test App');
    expect(dom.headings).toHaveLength(1);
    expect(dom.headings[0]?.text).toBe('Welcome to Test App');
    expect(dom.interactiveElements.length).toBeGreaterThanOrEqual(2);

    // Verify input and button are identified
    const hasInput = dom.interactiveElements.some((el) => el.id === 'name-input');
    const hasBtn = dom.interactiveElements.some((el) => el.id === 'greet-btn');
    expect(hasInput).toBe(true);
    expect(hasBtn).toBe(true);

    expect(dom.textContent).toContain('Welcome to Test App');
    expect(dom.textContent).toContain('Hello, Nirman Agent!');
  });

  it('captures full-page screenshots to disk', async () => {
    const shotPath = path.join(tempDir, 'test-screenshot.png');
    const saved = await driver.takeScreenshot(shotPath);

    expect(saved).toBe(shotPath);
    const stat = await fs.stat(shotPath);
    expect(stat.size).toBeGreaterThan(1000); // Valid PNG file
  });

  it('captures console errors emitted by page scripts', async () => {
    driver.clearLogs();
    const errorHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <script>
            console.error("Critical test error: database connection failed");
          </script>
        </body>
      </html>
    `;

    await driver.setContent(errorHtml);
    const errors = driver.getConsoleErrors();

    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]?.text).toContain('Critical test error');
  });
});
