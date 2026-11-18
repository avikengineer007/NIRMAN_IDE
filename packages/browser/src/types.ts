export const PACKAGE_NAME = '@nirman/browser';

export interface ViewportSize {
  width: number;
  height: number;
}

export interface BrowserConfig {
  headless?: boolean | undefined;
  channel?: string | undefined; // 'msedge' | 'chrome' | 'chromium'
  executablePath?: string | undefined;
  timeoutMs?: number | undefined;
  viewport?: ViewportSize | undefined;
}

export interface ConsoleMessageRecord {
  type: 'error' | 'warning' | 'log' | 'info';
  text: string;
  location?: string | undefined;
}

export interface FailedRequestRecord {
  url: string;
  method: string;
  status?: number | undefined;
  failureText?: string | undefined;
}

export interface InteractiveElementInfo {
  tag: string;
  id?: string | undefined;
  name?: string | undefined;
  text?: string | undefined;
  type?: string | undefined;
  role?: string | undefined;
  selector: string;
  placeholder?: string | undefined;
}

export interface HeadingInfo {
  level: number;
  text: string;
}

export interface DomSummary {
  title: string;
  url: string;
  headings: HeadingInfo[];
  interactiveElements: InteractiveElementInfo[];
  textContent: string;
}

export interface BrowserChecklistAction {
  type: 'open' | 'click' | 'type' | 'assert_text' | 'assert_element' | 'screenshot';
  selector?: string | undefined;
  text?: string | undefined;
  url?: string | undefined;
  screenshotName?: string | undefined;
}

export interface BrowserChecklistItem {
  id: string;
  description: string;
  actions: BrowserChecklistAction[];
  status?: ('pending' | 'passed' | 'failed') | undefined;
  error?: string | undefined;
  screenshotPath?: string | undefined;
  durationMs?: number | undefined;
}

export interface BrowserVerificationReport {
  runId: string;
  timestamp: string;
  totalItems: number;
  passedItems: number;
  failedItems: number;
  items: BrowserChecklistItem[];
  consoleErrors: ConsoleMessageRecord[];
  failedRequests: FailedRequestRecord[];
  screenshots: string[];
}

export interface DevServerOptions {
  command: string;
  cwd: string;
  url: string;
  timeoutMs?: number | undefined;
  env?: Record<string, string> | undefined;
}
