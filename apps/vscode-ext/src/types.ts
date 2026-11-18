import type { TaskItem } from '@nirman/artifacts';
import type { ArtifactFileInfo, RunRecord } from '@nirman/server';

export interface ExtensionConfig {
  serverUrl: string;
  serverToken: string;
  model: string;
  contextWindowLimit: number;
}

export interface ChatMessageItem {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  toolCalls?: Array<{ name: string; args: string; result?: string | undefined }> | undefined;
}

export type WebviewToExtensionMessage =
  | { type: 'describe_project'; prompt: string; skipPlanning?: boolean }
  | { type: 'approve_plan'; runId: string }
  | { type: 'comment_plan'; runId: string; feedback: string }
  | { type: 'pause_run'; runId: string }
  | { type: 'resume_run'; runId: string }
  | { type: 'cancel_run'; runId: string }
  | { type: 'approve_action'; runId: string; actionId?: string; approved: boolean }
  | { type: 'review_diff'; runId: string; filePath?: string }
  | { type: 'open_artifact'; runId: string; artifactName: string }
  | { type: 'refresh_state' }
  // Agent Manager messages
  | { type: 'start_agent'; task: string; workspaceRoot?: string; skipPlanning?: boolean }
  | { type: 'pause_agent'; runId: string }
  | { type: 'resume_agent'; runId: string }
  | { type: 'cancel_agent'; runId: string }
  | { type: 'approve_agent_plan'; runId: string }
  | { type: 'approve_agent_action'; runId: string; actionId?: string; approved: boolean }
  | { type: 'comment_artifact'; runId: string; artifactPath?: string; feedback: string }
  | { type: 'open_run_artifact'; runId: string; artifactName: string }
  | { type: 'jump_to_file'; runId: string; filePath: string }
  | { type: 'refresh_agents' }
  | { type: 'toggle_manager_focus' };

export type ExtensionToWebviewMessage =
  | { type: 'chat_message'; message: ChatMessageItem }
  | { type: 'run_state_changed'; run: RunRecord | null }
  | { type: 'plan_updated'; runId: string; planMarkdown: string; specMarkdown: string; tasks: readonly TaskItem[] }
  | { type: 'tasks_updated'; runId: string; tasks: readonly TaskItem[] }
  | { type: 'artifacts_updated'; runId: string; artifacts: readonly ArtifactFileInfo[] }
  | { type: 'action_approval_requested'; runId: string; actionId: string; toolName: string; reason: string }
  | { type: 'status_updated'; model: string; usedTokens: number; contextLimit: number }
  // Agent Manager messages
  | { type: 'runs_updated'; runs: readonly RunRecord[] }
  | { type: 'artifacts_list'; runId: string; artifacts: readonly ArtifactFileInfo[] }
  | { type: 'artifact_content'; runId: string; artifactName: string; content: string };

export interface ActionApprovalRequest {
  runId: string;
  actionId: string;
  toolName: string;
  reason: string;
  resolve: (approved: boolean) => void;
}
