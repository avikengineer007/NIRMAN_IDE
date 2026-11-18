import { describe, it, expect } from 'vitest';
import { ChatViewProvider } from './chat-view.js';
import { PlanViewProvider } from './plan-view.js';
import { TasksViewProvider } from './tasks-view.js';
import { ArtifactsViewProvider } from './artifacts-view.js';
import { NirmanStatusBar } from './status-bar.js';
import { DiffReviewer } from './diff-viewer.js';
import { MockVSCodeAPI, MockWebviewView } from './vscode-api.js';

describe('VS Code Extension Views & Components', () => {
  it('manages ChatViewProvider messages and webview dispatch', () => {
    const provider = new ChatViewProvider();
    const mockView = new MockWebviewView();

    provider.appendMessage('user', 'Hello Agent');
    provider.appendMessage('assistant', 'Hello User');

    expect(provider.getMessages()).toHaveLength(2);

    provider.resolveWebviewView(mockView);
    expect(mockView.webview.html).toContain('NIRMAN Agent Chat');
    expect(mockView.postedMessages.length).toBeGreaterThanOrEqual(2);
  });

  it('manages PlanViewProvider data updates and user actions', () => {
    const provider = new PlanViewProvider();
    const mockView = new MockWebviewView();

    let approvedRunId = '';
    let commentFeedback = '';

    provider.setDelegate({
      onApprovePlan: (runId) => {
        approvedRunId = runId;
        return Promise.resolve();
      },
      onCommentPlan: (_runId, feedback) => {
        commentFeedback = feedback;
        return Promise.resolve();
      },
    });

    provider.resolveWebviewView(mockView);

    provider.setPlanData({
      runId: 'run-view-1',
      planMarkdown: '# Plan for Project',
      specMarkdown: '# Spec',
      tasks: [{ id: '1', title: 'Task 1', status: 'pending' }],
      isWaitingApproval: true,
    });

    expect(provider.getPlanMarkdown()).toBe('# Plan for Project');

    // Simulate user approving plan from webview
    mockView.simulateWebviewMessage({ type: 'approve_plan', runId: 'run-view-1' });
    expect(approvedRunId).toBe('run-view-1');

    // Simulate user requesting feedback
    mockView.simulateWebviewMessage({
      type: 'comment_plan',
      runId: 'run-view-1',
      feedback: 'Use TypeScript instead',
    });
    expect(commentFeedback).toBe('Use TypeScript instead');
  });

  it('manages TasksViewProvider real-time task updates', () => {
    const provider = new TasksViewProvider();
    const mockView = new MockWebviewView();

    provider.resolveWebviewView(mockView);
    provider.setTasks('run-task-1', [
      { id: 't1', title: 'Task 1', status: 'completed' },
      { id: 't2', title: 'Task 2', status: 'in_progress' },
    ]);

    expect(provider.getTasks()).toHaveLength(2);
    expect(mockView.postedMessages.some((m) => m.type === 'tasks_updated')).toBe(true);
  });

  it('manages ArtifactsViewProvider listings and user opening', () => {
    const provider = new ArtifactsViewProvider();
    const mockView = new MockWebviewView();

    let openedName = '';
    provider.setDelegate({
      onOpenArtifact: (_runId, name) => {
        openedName = name;
        return Promise.resolve();
      },
    });

    provider.resolveWebviewView(mockView);
    provider.setArtifacts('run-art-1', [
      {
        name: 'walkthrough.md',
        relativePath: 'walkthrough.md',
        sizeBytes: 1024,
        modifiedTime: new Date().toISOString(),
      },
      {
        name: 'browser-verify.png',
        relativePath: 'screenshots/browser-verify.png',
        sizeBytes: 40960,
        modifiedTime: new Date().toISOString(),
      },
    ]);

    expect(provider.getArtifacts()).toHaveLength(2);

    // Simulate clicking artifact in UI
    mockView.simulateWebviewMessage({
      type: 'open_artifact',
      runId: 'run-art-1',
      artifactName: 'screenshots/browser-verify.png',
    });
    expect(openedName).toBe('screenshots/browser-verify.png');
  });

  it('renders NirmanStatusBar with model and context usage percent', () => {
    const mockVsCode = new MockVSCodeAPI();
    const statusBar = new NirmanStatusBar(mockVsCode);

    statusBar.updateModel('qwen2.5-coder:7b');
    statusBar.updateContextUsage(16384, 32768);

    expect(statusBar.getText()).toContain('qwen2.5-coder:7b');
    expect(statusBar.getText()).toContain('16.4k / 33k (50.0%)');
    expect(statusBar.getTooltip()).toContain('Context Usage: 16,384 / 32,768 tokens (50.0%)');

    statusBar.dispose();
  });

  it('executes native VS Code diff review via DiffReviewer', async () => {
    const mockVsCode = new MockVSCodeAPI();
    const diffReviewer = new DiffReviewer(mockVsCode);

    await diffReviewer.openDiff({
      runId: 'run-diff-1',
      repoRoot: process.cwd(),
      worktreePath: process.cwd(),
      relativePath: 'package.json',
    });

    expect(mockVsCode.executedCommands.some((c) => c.command === 'vscode.diff')).toBe(true);
  });
});
