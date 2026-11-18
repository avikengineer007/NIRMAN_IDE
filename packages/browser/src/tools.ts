import type { ToolDefinition } from '@nirman/model';
import { BrowserDriver } from './browser-driver.js';
import { DevServerManager } from './server-manager.js';
import { formatDomSummaryForPrompt } from './dom-summary.js';

let sharedDriver: BrowserDriver | null = null;
let sharedServer: DevServerManager | null = null;

function getDriver(): BrowserDriver {
  if (!sharedDriver) {
    sharedDriver = new BrowserDriver();
  }
  return sharedDriver;
}

function getServerManager(): DevServerManager {
  if (!sharedServer) {
    sharedServer = new DevServerManager();
  }
  return sharedServer;
}

export const browserToolDefinitions: ToolDefinition[] = [
  {
    name: 'browser_start_server',
    description:
      'Starts the project dev server from SPEC.md or command and waits until it is ready to receive requests.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Dev server start command (e.g. "npm run dev", "npx serve")',
        },
        url: {
          type: 'string',
          description: 'URL to wait for readiness (e.g. "http://localhost:3000")',
        },
        timeoutMs: {
          type: 'number',
          description: 'Max time in ms to wait for server readiness (default: 20000)',
        },
      },
      required: ['command', 'url'],
    },
  },
  {
    name: 'browser_open',
    description: 'Navigates the browser to the specified URL and waits for page load.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Web page URL to navigate to',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_click',
    description: 'Clicks an interactive element in the current page using a CSS selector.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector or locator of the element to click (e.g. "button#submit", ".toggle")',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_type',
    description: 'Types text into an input or textarea element.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of the input field',
        },
        text: {
          type: 'string',
          description: 'Text to type into the field',
        },
        clear: {
          type: 'boolean',
          description: 'Whether to clear existing text first (default: true)',
        },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'browser_get_dom',
    description:
      'Extracts a compact summary of the current page DOM (title, headings, interactive elements, visible text).',
    parameters: {
      type: 'object',
      properties: {
        maxChars: {
          type: 'number',
          description: 'Max character limit for visible text content (default: 2000)',
        },
      },
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Captures a screenshot of the current page and saves it to the artifacts directory.',
    parameters: {
      type: 'object',
      properties: {
        outputPath: {
          type: 'string',
          description: 'Destination file path for the screenshot image (.png)',
        },
      },
      required: ['outputPath'],
    },
  },
];

export async function executeBrowserTool(
  toolName: string,
  args: Record<string, unknown>,
  workspaceRoot: string,
): Promise<{ success: boolean; output: string; error?: string }> {
  const driver = getDriver();
  const server = getServerManager();

  try {
    switch (toolName) {
      case 'browser_start_server': {
        const command = typeof args['command'] === 'string' ? args['command'] : '';
        const url = typeof args['url'] === 'string' ? args['url'] : 'http://localhost:3000';
        const timeoutMs = typeof args['timeoutMs'] === 'number' ? args['timeoutMs'] : 20_000;

        await server.startServer({
          command,
          url,
          cwd: workspaceRoot,
          timeoutMs,
        });

        return {
          success: true,
          output: `Dev server successfully started and responding at ${url}`,
        };
      }

      case 'browser_open': {
        const url = typeof args['url'] === 'string' ? args['url'] : '';
        await driver.openUrl(url);
        const dom = await driver.getDomSummary(500);
        return {
          success: true,
          output: `Opened ${url}. Page title: "${dom.title}".\nHeadings: ${dom.headings.map((h) => h.text).join(', ')}`,
        };
      }

      case 'browser_click': {
        const selector = typeof args['selector'] === 'string' ? args['selector'] : '';
        await driver.click(selector);
        return {
          success: true,
          output: `Clicked element "${selector}" successfully.`,
        };
      }

      case 'browser_type': {
        const selector = typeof args['selector'] === 'string' ? args['selector'] : '';
        const text = typeof args['text'] === 'string' ? args['text'] : '';
        const clear = args['clear'] !== false;
        await driver.type(selector, text, { clear });
        return {
          success: true,
          output: `Typed "${text}" into "${selector}".`,
        };
      }

      case 'browser_get_dom': {
        const maxChars = typeof args['maxChars'] === 'number' ? args['maxChars'] : 2000;
        const dom = await driver.getDomSummary(maxChars);
        const formatted = formatDomSummaryForPrompt(dom);
        return {
          success: true,
          output: formatted,
        };
      }

      case 'browser_screenshot': {
        const outputPath = typeof args['outputPath'] === 'string' ? args['outputPath'] : '';
        const saved = await driver.takeScreenshot(outputPath);
        return {
          success: true,
          output: `Screenshot captured and saved to ${saved}`,
        };
      }

      default:
        return {
          success: false,
          output: '',
          error: `Unknown browser tool: ${toolName}`,
        };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const consoleErrors = driver.getConsoleErrors();
    const failedReqs = driver.getFailedRequests();

    const diagnostics = [
      `Browser Action Error: ${errorMsg}`,
      consoleErrors.length > 0
        ? `Console Errors: ${consoleErrors.map((e) => e.text).join('; ')}`
        : '',
      failedReqs.length > 0
        ? `Failed Requests: ${failedReqs.map((r) => `${r.method} ${r.url}`).join('; ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      success: false,
      output: '',
      error: diagnostics,
    };
  }
}

export async function cleanupBrowserTools(): Promise<void> {
  if (sharedDriver) {
    await sharedDriver.close();
    sharedDriver = null;
  }
  if (sharedServer) {
    await sharedServer.stopServer();
    sharedServer = null;
  }
}
