import type { RunManager } from './run-manager.js';
import {
  JSON_RPC_ERRORS,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type StartRunParams,
} from './types.js';

export class RpcHandler {
  private runManager: RunManager;

  constructor(runManager: RunManager) {
    this.runManager = runManager;
  }

  /**
   * Handles an incoming JSON-RPC request and returns the response.
   */
  public async handleRequest(rawMessage: string): Promise<JsonRpcResponse> {
    let request: JsonRpcRequest;

    try {
      request = JSON.parse(rawMessage) as JsonRpcRequest;
    } catch {
      return {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: JSON_RPC_ERRORS.PARSE_ERROR,
          message: 'Parse error: Invalid JSON string received',
        },
      };
    }

    if (!request || typeof request !== 'object' || request.jsonrpc !== '2.0' || !request.method) {
      return {
        jsonrpc: '2.0',
        id: request?.id ?? null,
        error: {
          code: JSON_RPC_ERRORS.INVALID_REQUEST,
          message: 'Invalid Request: Not a valid JSON-RPC 2.0 request',
        },
      };
    }

    const id = request.id ?? null;
    const method = request.method;
    const params = request.params ?? {};

    try {
      const result = await this.dispatchMethod(method, params);
      return {
        jsonrpc: '2.0',
        id,
        result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      let code: number = JSON_RPC_ERRORS.INTERNAL_ERROR;

      if (message.includes('not found')) {
        code = JSON_RPC_ERRORS.RUN_NOT_FOUND;
      } else if (message.includes('Unknown method')) {
        code = JSON_RPC_ERRORS.METHOD_NOT_FOUND;
      } else if (message.includes('Invalid') || message.includes('required')) {
        code = JSON_RPC_ERRORS.INVALID_PARAMS;
      }

      return {
        jsonrpc: '2.0',
        id,
        error: {
          code,
          message,
        },
      };
    }
  }

  private async dispatchMethod(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (method) {
      case 'start_run': {
        if (!params['task'] || typeof params['task'] !== 'string') {
          throw new Error('Missing or invalid required parameter "task"');
        }
        if (!params['workspaceRoot'] || typeof params['workspaceRoot'] !== 'string') {
          throw new Error('Missing or invalid required parameter "workspaceRoot"');
        }
        return await this.runManager.startRun(params as unknown as StartRunParams);
      }

      case 'list_runs': {
        return this.runManager.listRuns();
      }

      case 'get_run': {
        const runId = params['runId'] as string | undefined;
        if (!runId) throw new Error('Missing required parameter "runId"');
        const run = this.runManager.getRun(runId);
        if (!run) throw new Error(`Run ${runId} not found`);
        return run;
      }

      case 'approve_plan': {
        const runId = params['runId'] as string | undefined;
        if (!runId) throw new Error('Missing required parameter "runId"');
        const success = this.runManager.approvePlan(runId);
        return { approved: success };
      }

      case 'comment': {
        const runId = params['runId'] as string | undefined;
        const feedback = params['feedback'] as string | undefined;
        const artifactPath = params['artifactPath'] as string | undefined;
        if (!runId) throw new Error('Missing required parameter "runId"');
        if (!feedback) throw new Error('Missing required parameter "feedback"');
        const success = this.runManager.comment(runId, feedback, artifactPath);
        return { commented: success };
      }

      case 'pause': {
        const runId = params['runId'] as string | undefined;
        if (!runId) throw new Error('Missing required parameter "runId"');
        const success = this.runManager.pause(runId);
        return { paused: success };
      }

      case 'resume': {
        const runId = params['runId'] as string | undefined;
        if (!runId) throw new Error('Missing required parameter "runId"');
        const success = this.runManager.resume(runId);
        return { resumed: success };
      }

      case 'cancel': {
        const runId = params['runId'] as string | undefined;
        if (!runId) throw new Error('Missing required parameter "runId"');
        const success = this.runManager.cancel(runId);
        return { cancelled: success };
      }

      case 'approve_action': {
        const runId = params['runId'] as string | undefined;
        const approved = Boolean(params['approved']);
        const actionId = params['actionId'] as string | undefined;
        if (!runId) throw new Error('Missing required parameter "runId"');
        const success = this.runManager.approveAction(runId, actionId, approved);
        return { approved: success };
      }

      case 'list_artifacts': {
        const runId = params['runId'] as string | undefined;
        if (!runId) throw new Error('Missing required parameter "runId"');
        return await this.runManager.listArtifacts(runId);
      }

      case 'read_artifact': {
        const runId = params['runId'] as string | undefined;
        const artifactName = params['artifactName'] as string | undefined;
        if (!runId) throw new Error('Missing required parameter "runId"');
        if (!artifactName) throw new Error('Missing required parameter "artifactName"');
        const content = await this.runManager.readArtifact(runId, artifactName);
        return { artifactName, content };
      }

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }
}
