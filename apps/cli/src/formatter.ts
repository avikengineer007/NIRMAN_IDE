import type { AgentEvent } from '@nirman/artifacts';

/**
 * Format an agent event into a human-readable CLI message string.
 */
export function formatCliEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'run_started':
      return `\n=== NIRMAN RUN STARTED ===\nRun ID: ${event.runId}\nTask:   ${event.task}\n==========================\n`;

    case 'clarification_requested': {
      const qList = event.questions.map((q, i) => `  ${i + 1}. ${q}`).join('\n');
      return `\n❓ [Clarifications Requested]:\n${qList}\n`;
    }

    case 'plan_created': {
      const taskList = event.tasks
        .map(
          (t) =>
            `  - [${t.status === 'completed' ? 'x' : ' '}] ${t.title}${t.description ? ` (${t.description})` : ''}`,
        )
        .join('\n');
      return `\n=== EXECUTION PLAN CREATED ===\nPlan:  ${event.planPath}\nSpec:  ${event.specPath}\nTasks:\n${taskList}\n==============================\n`;
    }

    case 'plan_revision_requested':
      return `\n🔄 [Revising Plan]: "${event.feedback}"\n`;

    case 'plan_approved':
      return `\n✔ [Plan Approved]: Proceeding to execution.\n`;

    case 'task_status_changed': {
      const icon =
        event.status === 'completed'
          ? '✔'
          : event.status === 'blocked'
            ? '🛑'
            : event.status === 'failed'
              ? '✖'
              : '⏳';
      return `\n${icon} [Task ${event.status.toUpperCase()}]: ${event.taskId}${event.explanation ? ` - ${event.explanation}` : ''}\n`;
    }

    case 'verification_started':
      return `\n🔍 [Verifying] Task ${event.taskId} -> "${event.command}"\n`;

    case 'verification_finished': {
      const icon = event.success ? '✔' : '✖';
      const label = event.success ? 'Verification Passed' : 'Verification Failed';
      return `${icon} [${label}] Task ${event.taskId}${event.error ? `\nError: ${event.error}` : ''}\n`;
    }

    case 'task_retry':
      return `\n🔄 [Fix Attempt ${event.attempt}/${event.maxRetries}] Task ${event.taskId}: retrying after error:\n${event.error}\n`;

    case 'walkthrough_created':
      return `\n📄 [Walkthrough Created]: ${event.path}\n`;

    case 'model_message':
      return `\n[Agent]:\n${event.content}\n`;

    case 'tool_call': {
      const argsStr = JSON.stringify(event.arguments, null, 2);
      return `\n⚙ [Tool Call] ${event.tool}\nArguments: ${argsStr}\n`;
    }

    case 'tool_result': {
      const statusIcon = event.success ? '✔' : '✖';
      const statusText = event.success ? 'Success' : `Failed (${event.error ?? 'error'})`;
      const outputSnippet =
        event.output.length > 500
          ? `${event.output.slice(0, 500)}\n...(truncated output)`
          : event.output;
      return `${statusIcon} [Tool Result] ${event.tool}: ${statusText}\n${outputSnippet ? `Output: ${outputSnippet}` : ''}\n`;
    }

    case 'run_finished': {
      const icon = event.status === 'completed' ? '✔' : '✖';
      return `\n=== NIRMAN RUN ${event.status.toUpperCase()} ===\n${icon} Completed ${event.totalSteps} steps in ${event.durationMs}ms${event.reason ? `\nReason: ${event.reason}` : ''}\nArtifacts: .agent/runs/${event.runId}/\n=================================\n`;
    }

    case 'error':
      return `\n✖ [Error]: ${event.error}\n`;
  }
}
