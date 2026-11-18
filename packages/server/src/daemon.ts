import crypto from 'node:crypto';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { RunManager } from './run-manager.js';
import { RpcHandler } from './rpc-handler.js';
import type { ServerConfig, AgentEventNotificationParams, JsonRpcNotification } from './types.js';

function rawDataToString(data: WebSocket.RawData): string {
  if (Buffer.isBuffer(data)) {
    return data.toString('utf-8');
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf-8');
  }
  return Buffer.from(data).toString('utf-8');
}

export class NirmanDaemon {
  private config: Required<ServerConfig>;
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private runManager: RunManager;
  private rpcHandler: RpcHandler;
  private unsubscribeEvents?: (() => void) | undefined;
  private authenticatedSockets = new Set<WebSocket>();

  constructor(config?: ServerConfig, runManager?: RunManager) {
    const host = config?.host ?? '127.0.0.1';
    // Strictly bind to localhost only
    if (host !== '127.0.0.1' && host !== 'localhost') {
      throw new Error(`Security restriction: Server can only bind to localhost, received "${host}"`);
    }

    const token = config?.token ?? crypto.randomBytes(24).toString('hex');
    const port = config?.port ?? 4096;
    const baseWorktreesDir = config?.baseWorktreesDir;

    this.config = {
      port,
      host,
      token,
      baseWorktreesDir: baseWorktreesDir ?? '',
    };

    this.runManager =
      runManager ??
      new RunManager({
        baseWorktreesDir: this.config.baseWorktreesDir || undefined,
      });

    this.rpcHandler = new RpcHandler(this.runManager);
  }

  public getPort(): number {
    if (!this.httpServer) {
      throw new Error('Server is not running');
    }
    const address = this.httpServer.address();
    if (typeof address === 'object' && address !== null) {
      return address.port;
    }
    return this.config.port ?? 4096;
  }

  public getToken(): string {
    return this.config.token ?? '';
  }

  public getUrl(): string {
    return `ws://${this.config.host}:${this.getPort()}`;
  }

  public getRunManager(): RunManager {
    return this.runManager;
  }

  /**
   * Starts the HTTP and WebSocket daemon server.
   */
  public async start(): Promise<void> {
    if (this.httpServer) {
      return;
    }

    // 1. Create HTTP Server
    this.httpServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${this.config.host}`);
      const token =
        url.searchParams.get('token') ??
        req.headers['authorization']?.replace(/^Bearer\s+/i, '');

      if (token !== this.config.token) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: Invalid or missing token' }));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            activeRuns: this.runManager.listRuns().length,
            authenticatedClients: this.authenticatedSockets.size,
          }),
        );
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    });

    // 2. Create WebSocket Server
    this.wss = new WebSocketServer({
      noServer: true,
    });

    // Handle HTTP Upgrade to WebSocket with Token Authentication
    this.httpServer.on('upgrade', (request, socket, head) => {
      const hostHeader = request.headers['host'] ?? '';
      const isLocalHost =
        hostHeader.startsWith('127.0.0.1') ||
        hostHeader.startsWith('localhost') ||
        request.socket.remoteAddress === '127.0.0.1' ||
        request.socket.remoteAddress === '::1';

      if (!isLocalHost) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      const url = new URL(request.url ?? '/', `http://${this.config.host}`);
      const queryToken = url.searchParams.get('token');
      const authHeader = request.headers['authorization']?.replace(/^Bearer\s+/i, '');
      const subprotocols = (request.headers['sec-websocket-protocol'] ?? '')
        .split(',')
        .map((p) => p.trim());
      const protocolToken = subprotocols
        .find((p) => p.startsWith('nirman-token-'))
        ?.replace('nirman-token-', '');

      const token = queryToken ?? authHeader ?? protocolToken;

      if (!token || token !== this.config.token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss?.handleUpgrade(request, socket, head, (ws) => {
        this.wss?.emit('connection', ws, request);
      });
    });

    // 3. Setup WebSocket Connection Handling
    this.wss.on('connection', (ws) => {
      this.authenticatedSockets.add(ws);

      ws.on('message', (data: WebSocket.RawData) => {
        const raw = rawDataToString(data);
        void this.rpcHandler.handleRequest(raw).then((response) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(response));
          }
        });
      });

      ws.on('close', () => {
        this.authenticatedSockets.delete(ws);
      });

      ws.on('error', () => {
        this.authenticatedSockets.delete(ws);
      });
    });

    // 4. Subscribe to Run Manager events and stream to connected clients
    this.unsubscribeEvents = this.runManager.subscribeEvents((params: AgentEventNotificationParams) => {
      this.broadcastNotification('agent_event', params);
    });

    // 5. Start listening on localhost
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(this.config.port, this.config.host, () => {
        resolve();
      });
      this.httpServer!.on('error', reject);
    });
  }

  /**
   * Broadcasts a JSON-RPC notification to all connected authenticated clients.
   */
  public broadcastNotification(method: string, params: unknown): void {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    const payload = JSON.stringify(notification);

    for (const ws of this.authenticatedSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(payload);
        } catch {
          // ignore send error
        }
      }
    }
  }

  /**
   * Closes all connections and stops the server cleanly.
   */
  public async close(): Promise<void> {
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
      this.unsubscribeEvents = undefined;
    }

    for (const ws of this.authenticatedSockets) {
      try {
        ws.close(1000, 'Server shutting down');
      } catch {
        // ignore
      }
    }
    this.authenticatedSockets.clear();

    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }

    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    await this.runManager.cleanup();
  }
}
