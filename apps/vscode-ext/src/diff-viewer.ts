import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { IVSCodeAPI } from './vscode-api.js';

export interface DiffReviewOptions {
  runId: string;
  repoRoot: string;
  worktreePath: string;
  relativePath: string;
}

export class DiffReviewer {
  private vscode: IVSCodeAPI;

  constructor(vscode: IVSCodeAPI) {
    this.vscode = vscode;
  }

  /**
   * Opens VS Code native side-by-side diff editor for a modified file.
   */
  public async openDiff(options: DiffReviewOptions): Promise<void> {
    const originalFile = path.join(options.repoRoot, options.relativePath);
    const modifiedFile = path.join(options.worktreePath, options.relativePath);

    // If original does not exist (new file created in worktree), use an empty file
    let leftPath = originalFile;
    try {
      await fs.stat(originalFile);
    } catch {
      // Create empty temp placeholder for original
      const emptyDir = path.join(os.tmpdir(), 'nirman-empty');
      await fs.mkdir(emptyDir, { recursive: true });
      leftPath = path.join(emptyDir, 'empty.txt');
      await fs.writeFile(leftPath, '', 'utf-8');
    }

    const leftUri = this.vscode.Uri.file(leftPath);
    const rightUri = this.vscode.Uri.file(modifiedFile);
    const title = `${path.basename(options.relativePath)} (Original ↔ Nirman Worktree)`;

    await this.vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
  }
}
