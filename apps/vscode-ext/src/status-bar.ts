import type { IStatusBarItem, IVSCodeAPI } from './vscode-api.js';

export class NirmanStatusBar {
  private item: IStatusBarItem;
  private model = 'qwen2.5-coder:7b';
  private usedTokens = 0;
  private contextLimit = 32_768;
  private activeRunId?: string | undefined;

  constructor(vscode: IVSCodeAPI) {
    this.item = vscode.window.createStatusBarItem(2, 100);
    this.item.command = 'nirman.showChat';
    this.render();
    this.item.show();
  }

  public updateModel(model: string): void {
    this.model = model;
    this.render();
  }

  public updateContextUsage(usedTokens: number, limit?: number): void {
    this.usedTokens = usedTokens;
    if (limit && limit > 0) {
      this.contextLimit = limit;
    }
    this.render();
  }

  public setActiveRun(runId: string | undefined): void {
    this.activeRunId = runId;
    this.render();
  }

  public getText(): string {
    return this.item.text;
  }

  public getTooltip(): string | undefined {
    return this.item.tooltip;
  }

  private render(): void {
    const usedK = (this.usedTokens / 1000).toFixed(1);
    const limitK = (this.contextLimit / 1000).toFixed(0);
    const percent = Math.min(100, (this.usedTokens / this.contextLimit) * 100).toFixed(1);

    this.item.text = `$(hubot) Nirman: ${this.model} | ${usedK}k / ${limitK}k (${percent}%)`;
    this.item.tooltip = [
      `NIRMAN Coding Agent`,
      `Model: ${this.model}`,
      `Active Run: ${this.activeRunId ?? 'None'}`,
      `Context Usage: ${this.usedTokens.toLocaleString()} / ${this.contextLimit.toLocaleString()} tokens (${percent}%)`,
      `Click to open Nirman Chat panel`,
    ].join('\n');
  }

  public dispose(): void {
    this.item.dispose();
  }
}
