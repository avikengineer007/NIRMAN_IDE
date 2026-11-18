import type { WebviewToExtensionMessage, ExtensionToWebviewMessage } from './types.js';

export interface IStatusBarItem {
  text: string;
  tooltip?: string | undefined;
  command?: string | undefined;
  show(): void;
  hide(): void;
  dispose(): void;
}

export interface IWebview {
  html: string;
  postMessage(message: ExtensionToWebviewMessage): Promise<boolean>;
  onDidReceiveMessage(listener: (message: WebviewToExtensionMessage) => void): { dispose(): void };
}

export interface IWebviewView {
  webview: IWebview;
  visible: boolean;
  show?(preserveFocus?: boolean): void;
}

export interface IWebviewPanel {
  title: string;
  webview: IWebview;
  active: boolean;
  visible: boolean;
  reveal(viewColumn?: unknown, preserveFocus?: boolean): void;
  onDidDispose(listener: () => void): { dispose(): void };
  dispose(): void;
}

export interface IUri {
  fsPath: string;
  scheme: string;
  toString(): string;
}

export interface IVSCodeAPI {
  window: {
    createStatusBarItem(alignment?: number, priority?: number): IStatusBarItem;
    createWebviewPanel?(
      viewType: string,
      title: string,
      showOptions: unknown,
      options?: unknown,
    ): IWebviewPanel;
    showInformationMessage(message: string, ...items: string[]): Promise<string | undefined>;
    showWarningMessage(message: string, ...items: string[]): Promise<string | undefined>;
    showErrorMessage(message: string, ...items: string[]): Promise<string | undefined>;
  };
  commands: {
    executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
    registerCommand(command: string, callback: (...args: unknown[]) => unknown): { dispose(): void };
  };
  workspace: {
    workspaceFolders?: readonly { uri: IUri }[] | undefined;
    openTextDocument(uri: IUri | string): Promise<{ getText(): string }>;
  };
  Uri: {
    file(path: string): IUri;
    parse(uriStr: string): IUri;
  };
}

/**
 * In-memory Mock implementation of VS Code API for deterministic testing.
 */
export class MockVSCodeAPI implements IVSCodeAPI {
  public statusBarItems: IStatusBarItem[] = [];
  public executedCommands: Array<{ command: string; args: unknown[] }> = [];
  public registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
  public messagesShown: Array<{ type: 'info' | 'warn' | 'error'; message: string; items: string[] }> = [];
  public defaultPromptResponse?: string | undefined;
  public workspaceFolders: Array<{ uri: IUri }> = [];
  public webviewPanels: MockWebviewPanel[] = [];

  public window = {
    createStatusBarItem: (_alignment?: number, _priority?: number): IStatusBarItem => {
      const item: IStatusBarItem = {
        text: '',
        tooltip: undefined,
        command: undefined,
        show: () => {},
        hide: () => {},
        dispose: () => {},
      };
      this.statusBarItems.push(item);
      return item;
    },
    createWebviewPanel: (viewType: string, title: string): MockWebviewPanel => {
      const panel = new MockWebviewPanel(title);
      this.webviewPanels.push(panel);
      return panel;
    },
    showInformationMessage: (message: string, ...items: string[]): Promise<string | undefined> => {
      this.messagesShown.push({ type: 'info', message, items });
      return Promise.resolve(this.defaultPromptResponse ?? items[0]);
    },
    showWarningMessage: (message: string, ...items: string[]): Promise<string | undefined> => {
      this.messagesShown.push({ type: 'warn', message, items });
      return Promise.resolve(this.defaultPromptResponse ?? items[0]);
    },
    showErrorMessage: (message: string, ...items: string[]): Promise<string | undefined> => {
      this.messagesShown.push({ type: 'error', message, items });
      return Promise.resolve(this.defaultPromptResponse ?? items[0]);
    },
  };

  public commands = {
    executeCommand: (command: string, ...args: unknown[]): Promise<unknown> => {
      this.executedCommands.push({ command, args });
      const handler = this.registeredCommands.get(command);
      if (handler) {
        return Promise.resolve(handler(...args));
      }
      return Promise.resolve(undefined);
    },
    registerCommand: (command: string, callback: (...args: unknown[]) => unknown): { dispose(): void } => {
      this.registeredCommands.set(command, callback);
      return {
        dispose: () => {
          this.registeredCommands.delete(command);
        },
      };
    },
  };

  public workspace = {
    workspaceFolders: this.workspaceFolders,
    openTextDocument: (uri: IUri | string): Promise<{ getText(): string }> => {
      const filePath = typeof uri === 'string' ? uri : uri.fsPath;
      return Promise.resolve({
        getText: () => `Content of ${filePath}`,
      });
    },
  };

  public Uri = {
    file: (filePath: string): IUri => ({
      fsPath: filePath,
      scheme: 'file',
      toString: () => `file://${filePath.replace(/\\/g, '/')}`,
    }),
    parse: (uriStr: string): IUri => ({
      fsPath: uriStr.replace(/^file:\/\//, ''),
      scheme: uriStr.split(':')[0] ?? 'file',
      toString: () => uriStr,
    }),
  };
}

/**
 * Creates an in-memory mock webview view for testing webview providers.
 */
export class MockWebviewView implements IWebviewView {
  public visible = true;
  private messageListeners = new Set<(message: WebviewToExtensionMessage) => void>();
  public postedMessages: ExtensionToWebviewMessage[] = [];

  public webview: IWebview = {
    html: '',
    postMessage: (message: ExtensionToWebviewMessage): Promise<boolean> => {
      this.postedMessages.push(message);
      return Promise.resolve(true);
    },
    onDidReceiveMessage: (listener: (message: WebviewToExtensionMessage) => void) => {
      this.messageListeners.add(listener);
      return {
        dispose: () => {
          this.messageListeners.delete(listener);
        },
      };
    },
  };

  /**
   * Simulates a message sent from the webview UI to the extension.
   */
  public simulateWebviewMessage(message: WebviewToExtensionMessage): void {
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }
}

/**
 * Creates an in-memory mock webview panel for testing webview panel managers.
 */
export class MockWebviewPanel implements IWebviewPanel {
  public title: string;
  public active = true;
  public visible = true;
  private disposeListeners = new Set<() => void>();
  private messageListeners = new Set<(message: WebviewToExtensionMessage) => void>();
  public postedMessages: ExtensionToWebviewMessage[] = [];

  constructor(title: string) {
    this.title = title;
  }

  public webview: IWebview = {
    html: '',
    postMessage: (message: ExtensionToWebviewMessage): Promise<boolean> => {
      this.postedMessages.push(message);
      return Promise.resolve(true);
    },
    onDidReceiveMessage: (listener: (message: WebviewToExtensionMessage) => void) => {
      this.messageListeners.add(listener);
      return {
        dispose: () => {
          this.messageListeners.delete(listener);
        },
      };
    },
  };

  public reveal(_viewColumn?: unknown, _preserveFocus?: boolean): void {
    this.active = true;
    this.visible = true;
  }

  public onDidDispose(listener: () => void): { dispose(): void } {
    this.disposeListeners.add(listener);
    return {
      dispose: () => {
        this.disposeListeners.delete(listener);
      },
    };
  }

  public dispose(): void {
    this.active = false;
    this.visible = false;
    for (const listener of this.disposeListeners) {
      listener();
    }
  }

  public simulateWebviewMessage(message: WebviewToExtensionMessage): void {
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }
}
