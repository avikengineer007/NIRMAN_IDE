import WebSocket from 'ws';
import type { AgentEvent } from '@nirman/artifacts';
import type {
  ArtifactFileInfo,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  RunRecord,
  StartRunParams,
  StartRunResult,
  AgentEventNotificationParams,
} from './types.js';

export type { RunRecord, ArtifactFileInfo };

export interface ClientOptions {
  url: string;
  token: string;
  timeoutMs?: number | undefined;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

function rawDataToString(data: WebSocket.RawData): string {
  if (Buffer.isBuffer(data)) {
    return data.toString('utf-8');
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf-8');
  }
  return Buffer.from(data).toString('utf-8');
}

export class NirmanClient {
  private url: string;
  private token: string;
  private timeoutMs: number;
  private ws: WebSocket | null = null;
  private reqCounter = 0;
  private pendingRequests = new Map<string | number, PendingRequest>();
  private eventListeners = new Set<(notification: AgentEventNotificationParams) => void>();

  constructor(options: ClientOptions) {
    this.url = options.url;
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /**
   * Connects to the daemon WebSocket endpoint.
   */
  public async connect(): Promise<void> {
    const wsUrl = `${this.url}?token=${encodeURIComponent(this.token)}`;

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      const openHandler = (): void => {
        cleanup();
        resolve();
      };

      const errorHandler = (err: Error): void => {
        cleanup();
        reject(err);
      };

      const cleanup = (): void => {
        this.ws?.removeListener('open', openHandler);
        this.ws?.removeListener('error', errorHandler);
      };

      this.ws.once('open', openHandler);
      this.ws.once('error', errorHandler);

      this.ws.on('message', (data: WebSocket.RawData) => {
        const text = rawDataToString(data);
        this.handleMessage(text);
      });

      this.ws.on('close', () => {
        for (const req of this.pendingRequests.values()) {
          clearTimeout(req.timer);
          req.reject(new Error('WebSocket connection closed'));
        }
        this.pendingRequests.clear();
      });
    });
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;

    // Check if it's a notification
    if ('method' in parsed && !('id' in parsed)) {
      const notif = parsed as JsonRpcNotification;
      if (notif.method === 'agent_event') {
        const params = notif.params as AgentEventNotificationParams;
        for (const listener of this.eventListeners) {
          try {
            listener(params);
          } catch {
            // ignore
          }
        }
      }
      return;
    }

    // Check if it's a response
    if ('id' in parsed) {
      const resp = parsed as JsonRpcResponse;
      if (resp.id === null) return;
      const pending = this.pendingRequests.get(resp.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(resp.id);

        if (resp.error) {
          pending.reject(new Error(resp.error.message));
        } else {
          pending.resolve(resp.result);
        }
      }
    }
  }

  /**
   * Subscribes to agent events across runs.
   */
  public onEvent(callback: (notification: AgentEventNotificationParams) => void): () => void {
    this.eventListeners.add(callback);
    return () => {
      this.eventListeners.delete(callback);
    };
  }

  /**
   * Subscribes to events for a specific run only.
   */
  public onRunEvent(runId: string, callback: (event: AgentEvent) => void): () => void {
    const handler = (notif: AgentEventNotificationParams): void => {
      if (notif.runId === runId) {
        callback(notif.event);
      }
    };
    return this.onEvent(handler);
  }

  /**
   * Sends a JSON-RPC request and awaits response.
   */
  public async sendRequest<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    const id = `req-${++this.reqCounter}`;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout (${this.timeoutMs}ms) for method "${method}"`));
      }, this.timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (val: unknown) => void,
        reject,
        timer,
      });

      this.ws!.send(JSON.stringify(request));
    });
  }

  // Typed JSON-RPC methods
  public async startRun(params: StartRunParams): Promise<StartRunResult> {
    return this.sendRequest<StartRunResult>('start_run', params as unknown as Record<string, unknown>);
  }

  public async listRuns(): Promise<RunRecord[]> {
    return this.sendRequest<RunRecord[]>('list_runs');
  }

  public async getRun(runId: string): Promise<RunRecord> {
    return this.sendRequest<RunRecord>('get_run', { runId });
  }

  public async approvePlan(runId: string): Promise<{ approved: boolean }> {
    return this.sendRequest<{ approved: boolean }>('approve_plan', { runId });
  }

  public async comment(
    runId: string,
    feedback: string,
    artifactPath?: string,
  ): Promise<{ commented: boolean }> {
    return this.sendRequest<{ commented: boolean }>('comment', {
      runId,
      feedback,
      ...(artifactPath ? { artifactPath } : {}),
    });
  }

  public async pause(runId: string): Promise<{ paused: boolean }> {
    return this.sendRequest<{ paused: boolean }>('pause', { runId });
  }

  public async resume(runId: string): Promise<{ resumed: boolean }> {
    return this.sendRequest<{ resumed: boolean }>('resume', { runId });
  }

  public async cancel(runId: string): Promise<{ cancelled: boolean }> {
    return this.sendRequest<{ cancelled: boolean }>('cancel', { runId });
  }

  public async approveAction(
    runId: string,
    actionId: string | undefined,
    approved: boolean,
  ): Promise<{ approved: boolean }> {
    return this.sendRequest<{ approved: boolean }>('approve_action', { runId, actionId, approved });
  }

  public async listArtifacts(runId: string): Promise<ArtifactFileInfo[]> {
    return this.sendRequest<ArtifactFileInfo[]>('list_artifacts', { runId });
  }

  public async readArtifact(
    runId: string,
    artifactName: string,
  ): Promise<{ artifactName: string; content: string }> {
    return this.sendRequest<{ artifactName: string; content: string }>('read_artifact', {
      runId,
      artifactName,
    });
  }

  public close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
