import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  BrowserConfig,
  ConsoleMessageRecord,
  DomSummary,
  FailedRequestRecord,
} from './types.js';
import { extractDomSummary } from './dom-summary.js';

export class BrowserDriver {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private consoleErrors: ConsoleMessageRecord[] = [];
  private failedRequests: FailedRequestRecord[] = [];
  private config: BrowserConfig;

  constructor(config: BrowserConfig = {}) {
    this.config = {
      headless: config.headless ?? true,
      channel: config.channel ?? (process.platform === 'win32' ? 'msedge' : undefined),
      timeoutMs: config.timeoutMs ?? 30_000,
      viewport: config.viewport ?? { width: 1280, height: 720 },
      executablePath: config.executablePath,
    };
  }

  /**
   * Initializes and launches the Playwright browser instance
   */
  public async init(): Promise<Page> {
    if (this.page) {
      return this.page;
    }

    const launchOptions: Parameters<typeof chromium.launch>[0] = {};
    if (typeof this.config.headless === 'boolean') {
      launchOptions.headless = this.config.headless;
    }
    if (typeof this.config.timeoutMs === 'number') {
      launchOptions.timeout = this.config.timeoutMs;
    }
    if (this.config.channel) {
      launchOptions.channel = this.config.channel;
    }
    if (this.config.executablePath) {
      launchOptions.executablePath = this.config.executablePath;
    }

    try {
      this.browser = await chromium.launch(launchOptions);
    } catch {
      // If launch with channel fails (e.g. CI or Linux without Edge), try default chromium
      delete launchOptions.channel;
      this.browser = await chromium.launch(launchOptions);
    }

    const contextOptions: Parameters<Browser['newContext']>[0] = {};
    if (this.config.viewport) {
      contextOptions.viewport = this.config.viewport;
    }
    this.context = await this.browser.newContext(contextOptions);

    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.config.timeoutMs ?? 30_000);

    // Attach listeners for console errors and failed network requests
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const location = msg.location();
        this.consoleErrors.push({
          type: 'error',
          text: msg.text(),
          location: location.url ? `${location.url}:${location.lineNumber}` : undefined,
        });
      }
    });

    this.page.on('requestfailed', (req) => {
      this.failedRequests.push({
        url: req.url(),
        method: req.method(),
        failureText: req.failure()?.errorText ?? 'Request failed',
      });
    });

    this.page.on('response', (res) => {
      if (res.status() >= 400) {
        this.failedRequests.push({
          url: res.url(),
          method: res.request().method(),
          status: res.status(),
          failureText: `HTTP ${res.status()}: ${res.statusText()}`,
        });
      }
    });

    return this.page;
  }

  private async ensurePage(): Promise<Page> {
    if (!this.page) {
      return this.init();
    }
    return this.page;
  }

  /**
   * Navigates to the specified URL and waits for page load
   */
  public async openUrl(url: string): Promise<void> {
    const page = await this.ensurePage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  /**
   * Sets HTML content directly (useful for testing and standalone mock apps)
   */
  public async setContent(html: string): Promise<void> {
    const page = await this.ensurePage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
  }

  /**
   * Clicks an element by CSS selector or locator
   */
  public async click(selector: string, timeoutMs = 5000): Promise<void> {
    const page = await this.ensurePage();
    await page.locator(selector).first().click({ timeout: timeoutMs });
  }

  /**
   * Types text into an element by selector, optionally clearing first
   */
  public async type(
    selector: string,
    text: string,
    options: { clear?: boolean; timeoutMs?: number } = {},
  ): Promise<void> {
    const page = await this.ensurePage();
    const locator = page.locator(selector).first();
    const timeout = options.timeoutMs ?? 5000;

    if (options.clear) {
      await locator.fill('', { timeout });
    }
    await locator.fill(text, { timeout });
  }

  /**
   * Returns text content of an element
   */
  public async getTextContent(selector: string): Promise<string | null> {
    const page = await this.ensurePage();
    return page.locator(selector).first().textContent();
  }

  /**
   * Checks if an element is visible
   */
  public async isVisible(selector: string): Promise<boolean> {
    const page = await this.ensurePage();
    return page.locator(selector).first().isVisible();
  }

  /**
   * Extracts compact DOM summary for small context LLM prompts
   */
  public async getDomSummary(maxChars = 2000): Promise<DomSummary> {
    const page = await this.ensurePage();
    return extractDomSummary(page, maxChars);
  }

  /**
   * Takes a full-page or viewport screenshot and writes it to disk
   */
  public async takeScreenshot(outputPath: string): Promise<string> {
    const page = await this.ensurePage();
    const resolvedPath = path.resolve(outputPath);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

    await page.screenshot({
      path: resolvedPath,
      fullPage: false,
    });

    return resolvedPath;
  }

  public getConsoleErrors(): ConsoleMessageRecord[] {
    return [...this.consoleErrors];
  }

  public getFailedRequests(): FailedRequestRecord[] {
    return [...this.failedRequests];
  }

  public clearLogs(): void {
    this.consoleErrors = [];
    this.failedRequests = [];
  }

  /**
   * Closes page, context, and browser instance
   */
  public async close(): Promise<void> {
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // ignore
      }
      this.context = null;
      this.page = null;
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // ignore
      }
      this.browser = null;
    }
  }
}
