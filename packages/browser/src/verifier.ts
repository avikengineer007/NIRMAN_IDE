import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  BrowserChecklistItem,
  BrowserVerificationReport,
  BrowserConfig,
} from './types.js';
import { BrowserDriver } from './browser-driver.js';

export interface VerifyRunOptions {
  runId: string;
  screenshotsDir: string;
  reportPath?: string | undefined;
  url?: string | undefined;
  htmlContent?: string | undefined;
  browserConfig?: BrowserConfig | undefined;
}

export class BrowserVerifier {
  private driver: BrowserDriver;

  constructor(driver?: BrowserDriver, config?: BrowserConfig) {
    this.driver = driver ?? new BrowserDriver(config);
  }

  /**
   * Derives a verification checklist of user behaviors from a web plan or spec
   */
  public static deriveDefaultWebChecklist(url = 'http://localhost:3000'): BrowserChecklistItem[] {
    return [
      {
        id: 'check-1-initial-render',
        description: 'Verify page loads successfully with heading and interactive controls',
        actions: [
          { type: 'open', url },
          { type: 'assert_element', selector: 'h1, h2, #title, header' },
          { type: 'screenshot', screenshotName: '1-initial-render.png' },
        ],
      },
      {
        id: 'check-2-user-input',
        description: 'Verify user can input text and submit an action (add item / search / form)',
        actions: [
          {
            type: 'type',
            selector: 'input[type="text"], input:not([type]), textarea, #todo-input, #task-input',
            text: 'Automated Playwright Test Task',
          },
          {
            type: 'click',
            selector: 'button[type="submit"], form button, #add-btn, button:has-text("Add"), button:has-text("Submit")',
          },
          {
            type: 'assert_text',
            text: 'Automated Playwright Test Task',
          },
          { type: 'screenshot', screenshotName: '2-user-input-added.png' },
        ],
      },
      {
        id: 'check-3-interaction-state',
        description: 'Verify interacting with item updates state (toggle complete / delete / filter)',
        actions: [
          {
            type: 'click',
            selector: 'input[type="checkbox"], .toggle, button:has-text("Complete"), .todo-item, li',
          },
          { type: 'screenshot', screenshotName: '3-interaction-completed.png' },
        ],
      },
    ];
  }

  /**
   * Executes a verification checklist in the browser, captures screenshots, and writes artifacts
   */
  public async executeChecklist(
    checklist: BrowserChecklistItem[],
    options: VerifyRunOptions,
  ): Promise<BrowserVerificationReport> {
    await fs.mkdir(options.screenshotsDir, { recursive: true });

    let passedItems = 0;
    let failedItems = 0;
    const screenshots: string[] = [];
    const itemResults: BrowserChecklistItem[] = [];

    // Navigate or load page
    if (options.url) {
      await this.driver.openUrl(options.url);
    } else if (options.htmlContent) {
      await this.driver.setContent(options.htmlContent);
    }

    for (const item of checklist) {
      const itemStart = Date.now();
      let itemPassed = true;
      let itemError: string | undefined;
      let itemScreenshot: string | undefined;

      try {
        for (const action of item.actions) {
          switch (action.type) {
            case 'open':
              if (action.url) {
                await this.driver.openUrl(action.url);
              }
              break;

            case 'click':
              if (action.selector) {
                await this.driver.click(action.selector);
              }
              break;

            case 'type':
              if (action.selector && action.text) {
                await this.driver.type(action.selector, action.text);
              }
              break;

            case 'assert_element':
              if (action.selector) {
                const visible = await this.driver.isVisible(action.selector);
                if (!visible) {
                  throw new Error(`Expected element matching "${action.selector}" was not visible`);
                }
              }
              break;

            case 'assert_text':
              if (action.text) {
                const dom = await this.driver.getDomSummary();
                if (!dom.textContent.includes(action.text)) {
                  throw new Error(
                    `Expected text "${action.text}" was not found in page content`,
                  );
                }
              }
              break;

            case 'screenshot': {
              const filename = action.screenshotName ?? `${item.id}.png`;
              const targetPath = path.join(options.screenshotsDir, filename);
              const saved = await this.driver.takeScreenshot(targetPath);
              itemScreenshot = saved;
              screenshots.push(saved);
              break;
            }
          }
        }
      } catch (err) {
        itemPassed = false;
        itemError = err instanceof Error ? err.message : String(err);
      }

      const durationMs = Date.now() - itemStart;

      // Always take a screenshot on failure if not already taken
      if (!itemPassed && !itemScreenshot) {
        try {
          const failShot = path.join(options.screenshotsDir, `${item.id}-failed.png`);
          await this.driver.takeScreenshot(failShot);
          itemScreenshot = failShot;
          screenshots.push(failShot);
        } catch {
          // ignore screenshot failure
        }
      }

      if (itemPassed) {
        passedItems++;
      } else {
        failedItems++;
      }

      itemResults.push({
        id: item.id,
        description: item.description,
        actions: item.actions,
        status: itemPassed ? 'passed' : 'failed',
        error: itemError,
        screenshotPath: itemScreenshot,
        durationMs,
      });
    }

    const report: BrowserVerificationReport = {
      runId: options.runId,
      timestamp: new Date().toISOString(),
      totalItems: checklist.length,
      passedItems,
      failedItems,
      items: itemResults,
      consoleErrors: this.driver.getConsoleErrors(),
      failedRequests: this.driver.getFailedRequests(),
      screenshots,
    };

    // Save report artifact if requested
    if (options.reportPath) {
      await fs.mkdir(path.dirname(options.reportPath), { recursive: true });
      const mdReport = this.generateMarkdownReport(report);
      await fs.writeFile(options.reportPath, mdReport, 'utf-8');

      const jsonPath = options.reportPath.replace(/\.md$/, '.json');
      await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
    }

    return report;
  }

  /**
   * Generates a readable markdown report summarizing browser verification results
   */
  public generateMarkdownReport(report: BrowserVerificationReport): string {
    const lines: string[] = [];
    lines.push(`# Browser Verification Report (${report.runId})`);
    lines.push(`- **Timestamp:** ${report.timestamp}`);
    lines.push(
      `- **Result:** ${report.failedItems === 0 ? 'PASSED' : 'FAILED'} (${report.passedItems}/${report.totalItems} checks passed)`,
    );
    lines.push('');

    lines.push('## Verification Checklist');
    lines.push('| Status | Check ID | Description | Duration | Screenshot |');
    lines.push('|---|---|---|---|---|');

    for (const item of report.items) {
      const statusIcon = item.status === 'passed' ? 'PASSED' : 'FAILED';
      const shot = item.screenshotPath ? `\`${path.basename(item.screenshotPath)}\`` : '-';
      lines.push(
        `| ${statusIcon} | ${item.id} | ${item.description} | ${item.durationMs ?? 0}ms | ${shot} |`,
      );
    }
    lines.push('');

    if (report.failedItems > 0) {
      lines.push('## Failures & Errors');
      for (const item of report.items.filter((i) => i.status === 'failed')) {
        lines.push(`### ${item.id}: ${item.description}`);
        lines.push(`\`\`\`\n${item.error ?? 'Unknown error'}\n\`\`\``);
      }
      lines.push('');
    }

    if (report.consoleErrors.length > 0) {
      lines.push('## Captured Console Errors');
      for (const err of report.consoleErrors) {
        lines.push(`- [${err.type}] ${err.text} ${err.location ? `(${err.location})` : ''}`);
      }
      lines.push('');
    }

    if (report.failedRequests.length > 0) {
      lines.push('## Failed Network Requests');
      for (const req of report.failedRequests) {
        lines.push(`- ${req.method} ${req.url} -> ${req.failureText ?? req.status ?? 'Failed'}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  public async close(): Promise<void> {
    await this.driver.close();
  }
}
