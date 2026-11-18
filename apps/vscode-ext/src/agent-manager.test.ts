/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';
import { AgentManagerViewProvider, type AgentManagerDelegate } from './agent-manager-view.js';
import { MockWebviewPanel, MockWebviewView } from './vscode-api.js';
import type { RunRecord } from '@nirman/server';

describe('AgentManagerViewProvider', () => {
  it('renders empty state when no runs exist', () => {
    const provider = new AgentManagerViewProvider();
    const html = provider.getHtml();

    expect(html).toContain('NIRMAN Agent Manager');
    expect(html).toContain('No active or completed agent runs found');
  });

  it('renders runs across workspaces with status badges, current tasks, and pending approvals', () => {
    const provider = new AgentManagerViewProvider();
    const mockRuns: RunRecord[] = [
      {
        runId: 'run-101',
        task: 'Build CLI file converter',
        status: 'running',
        repoRoot: '/workspace/repo-a',
        worktreePath: '/workspace/repo-a/.agent/worktrees/run-101',
        gitBranch: 'nirman/run-101',
        startTime: '2026-11-18T10:00:00.000Z',
        stepsCount: 5,
        currentTask: 'Implementing CSV parser',
      },
      {
        runId: 'run-102',
        task: 'Create REST API service',
        status: 'waiting_approval',
        repoRoot: '/workspace/repo-b',
        worktreePath: '/workspace/repo-b/.agent/worktrees/run-102',
        gitBranch: 'nirman/run-102',
        startTime: '2026-11-18T10:05:00.000Z',
        stepsCount: 2,
        currentTask: 'Review generated architecture plan',
        pendingApproval: {
          type: 'plan',
          reason: 'Execution plan awaiting user approval',
        },
      },
      {
        runId: 'run-103',
        task: 'Design static landing page',
        status: 'paused',
        repoRoot: '/workspace/repo-c',
        worktreePath: '/workspace/repo-c/.agent/worktrees/run-103',
        gitBranch: 'nirman/run-103',
        startTime: '2026-11-18T10:10:00.000Z',
        stepsCount: 8,
        currentTask: 'Waiting for resume',
        comments: [
          {
            timestamp: '2026-11-18T10:12:00.000Z',
            feedback: 'Please use dark mode styling',
            artifactPath: 'index.html',
          },
        ],
      },
    ];

    provider.setRuns(mockRuns);
    const html = provider.getHtml();

    // Verify all 3 runs appear on one screen
    expect(html).toContain('run-101');
    expect(html).toContain('Build CLI file converter');
    expect(html).toContain('Implementing CSV parser');
    expect(html).toContain('badge-running');

    expect(html).toContain('run-102');
    expect(html).toContain('Create REST API service');
    expect(html).toContain('badge-waiting_approval');
    expect(html).toContain('Pending Plan Approval');
    expect(html).toContain('Approve Plan');

    expect(html).toContain('run-103');
    expect(html).toContain('Design static landing page');
    expect(html).toContain('badge-paused');
    expect(html).toContain('Please use dark mode styling');
  });

  it('dispatches delegate methods on webview actions', () => {
    const provider = new AgentManagerViewProvider();
    const mockView = new MockWebviewView();
    provider.resolveWebviewView(mockView);

    const delegate: AgentManagerDelegate = {
      onStartAgent: vi.fn().mockResolvedValue('run-new'),
      onPauseAgent: vi.fn().mockResolvedValue(undefined),
      onResumeAgent: vi.fn().mockResolvedValue(undefined),
      onCancelAgent: vi.fn().mockResolvedValue(undefined),
      onApproveAgentPlan: vi.fn().mockResolvedValue(undefined),
      onApproveAgentAction: vi.fn().mockResolvedValue(undefined),
      onCommentArtifact: vi.fn().mockResolvedValue(undefined),
      onOpenRunArtifact: vi.fn().mockResolvedValue(undefined),
      onJumpToFile: vi.fn().mockResolvedValue(undefined),
      onRefreshAgents: vi.fn().mockResolvedValue(undefined),
      onToggleFocus: vi.fn().mockResolvedValue(undefined),
    };
    provider.setDelegate(delegate);

    // Simulate start_agent
    mockView.simulateWebviewMessage({
      type: 'start_agent',
      task: 'Build a new microservice',
      workspaceRoot: '/tmp/workspace',
      skipPlanning: true,
    });
    expect(delegate.onStartAgent).toHaveBeenCalledWith(
      'Build a new microservice',
      '/tmp/workspace',
      true,
    );

    // Simulate pause_agent
    mockView.simulateWebviewMessage({
      type: 'pause_agent',
      runId: 'run-1',
    });
    expect(delegate.onPauseAgent).toHaveBeenCalledWith('run-1');

    // Simulate resume_agent
    mockView.simulateWebviewMessage({
      type: 'resume_agent',
      runId: 'run-1',
    });
    expect(delegate.onResumeAgent).toHaveBeenCalledWith('run-1');

    // Simulate cancel_agent
    mockView.simulateWebviewMessage({
      type: 'cancel_agent',
      runId: 'run-2',
    });
    expect(delegate.onCancelAgent).toHaveBeenCalledWith('run-2');

    // Simulate approve_agent_plan
    mockView.simulateWebviewMessage({
      type: 'approve_agent_plan',
      runId: 'run-3',
    });
    expect(delegate.onApproveAgentPlan).toHaveBeenCalledWith('run-3');

    // Simulate approve_agent_action
    mockView.simulateWebviewMessage({
      type: 'approve_agent_action',
      runId: 'run-3',
      actionId: 'action-1',
      approved: true,
    });
    expect(delegate.onApproveAgentAction).toHaveBeenCalledWith('run-3', 'action-1', true);

    // Simulate comment_artifact
    mockView.simulateWebviewMessage({
      type: 'comment_artifact',
      runId: 'run-4',
      artifactPath: 'walkthrough.md',
      feedback: 'Great documentation, please also document environment variables.',
    });
    expect(delegate.onCommentArtifact).toHaveBeenCalledWith(
      'run-4',
      'Great documentation, please also document environment variables.',
      'walkthrough.md',
    );

    // Simulate jump_to_file
    mockView.simulateWebviewMessage({
      type: 'jump_to_file',
      runId: 'run-4',
      filePath: 'src/main.ts',
    });
    expect(delegate.onJumpToFile).toHaveBeenCalledWith('run-4', 'src/main.ts');

    // Simulate toggle_manager_focus
    mockView.simulateWebviewMessage({
      type: 'toggle_manager_focus',
    });
    expect(delegate.onToggleFocus).toHaveBeenCalled();
  });

  it('supports full WebviewPanel integration and tracks active visibility', () => {
    const provider = new AgentManagerViewProvider();
    const panel = new MockWebviewPanel('NIRMAN: Agent Manager');

    provider.setWebviewPanel(panel);
    expect(provider.isPanelActive()).toBe(true);

    provider.hideOrBlur();
    expect(provider.isPanelActive()).toBe(false);

    provider.reveal();
    expect(provider.isPanelActive()).toBe(true);

    panel.dispose();
    expect(provider.isPanelActive()).toBe(false);
  });
});
