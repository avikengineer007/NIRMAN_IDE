import type { ArtifactFileInfo } from '@nirman/server';
import type { WebviewToExtensionMessage } from './types.js';
import type { IWebviewView } from './vscode-api.js';

export interface ArtifactsViewDelegate {
  onOpenArtifact(runId: string, artifactName: string): Promise<void>;
}

export class ArtifactsViewProvider {
  private view?: IWebviewView | undefined;
  private delegate?: ArtifactsViewDelegate | undefined;
  private activeRunId?: string | undefined;
  private artifacts: readonly ArtifactFileInfo[] = [];

  public setDelegate(delegate: ArtifactsViewDelegate): void {
    this.delegate = delegate;
  }

  public resolveWebviewView(webviewView: IWebviewView): void {
    this.view = webviewView;
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage((msg: WebviewToExtensionMessage) => {
      if (!this.delegate) return;
      if (msg.type === 'open_artifact') {
        void this.delegate.onOpenArtifact(msg.runId, msg.artifactName);
      }
    });

    this.updateWebview();
  }

  public setArtifacts(runId: string, artifacts: readonly ArtifactFileInfo[]): void {
    this.activeRunId = runId;
    this.artifacts = artifacts;
    this.updateWebview();
  }

  public getArtifacts(): readonly ArtifactFileInfo[] {
    return this.artifacts;
  }

  private updateWebview(): void {
    if (!this.view) return;
    void this.view.webview.postMessage({
      type: 'artifacts_updated',
      runId: this.activeRunId ?? '',
      artifacts: this.artifacts,
    });
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NIRMAN Artifacts</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 12px; margin: 0; color: #ccc; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-top: 0; }
    .art-list { display: flex; flex-direction: column; gap: 6px; }
    .art-item { padding: 8px 10px; border-radius: 4px; background: #252526; border: 1px solid #333; display: flex; align-items: center; justify-content: space-between; cursor: pointer; }
    .art-item:hover { background: #2d2d2d; border-color: #007acc; }
    .art-name { font-size: 13px; font-weight: 500; }
    .art-meta { font-size: 11px; color: #888; }
    .badge-shot { background: #68217a; color: #fff; padding: 2px 4px; border-radius: 2px; font-size: 10px; }
    .badge-doc { background: #007acc; color: #fff; padding: 2px 4px; border-radius: 2px; font-size: 10px; }
  </style>
</head>
<body>
  <h2>Run Artifacts</h2>
  <div id="artifacts-container" class="art-list"></div>

  <script>
    const vscode = acquireVsCodeApi();
    const container = document.getElementById('artifacts-container');
    let currentRunId = '';

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'artifacts_updated') {
        currentRunId = msg.runId;
        container.innerHTML = '';
        if (!msg.artifacts || msg.artifacts.length === 0) {
          container.innerHTML = '<div style="color: #666; font-style: italic;">No artifacts generated yet</div>';
          return;
        }

        for (const art of msg.artifacts) {
          const item = document.createElement('div');
          item.className = 'art-item';

          const left = document.createElement('div');
          const isScreenshot = art.relativePath.endsWith('.png');
          const isMarkdown = art.relativePath.endsWith('.md');

          const badge = document.createElement('span');
          badge.className = isScreenshot ? 'badge-shot' : (isMarkdown ? 'badge-doc' : '');
          badge.textContent = isScreenshot ? 'IMAGE' : (isMarkdown ? 'DOC' : 'FILE');
          badge.style.marginRight = '6px';

          const nameSpan = document.createElement('span');
          nameSpan.className = 'art-name';
          nameSpan.textContent = art.relativePath;

          left.appendChild(badge);
          left.appendChild(nameSpan);

          const sizeSpan = document.createElement('div');
          sizeSpan.className = 'art-meta';
          sizeSpan.textContent = (art.sizeBytes / 1024).toFixed(1) + ' KB';

          item.appendChild(left);
          item.appendChild(sizeSpan);

          item.addEventListener('click', () => {
            vscode.postMessage({
              type: 'open_artifact',
              runId: currentRunId,
              artifactName: art.relativePath
            });
          });

          container.appendChild(item);
        }
      }
    });
  </script>
</body>
</html>`;
  }
}
