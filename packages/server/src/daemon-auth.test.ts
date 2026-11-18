import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import http from 'node:http';
import { NirmanDaemon } from './daemon.js';

describe('NirmanDaemon Authentication & Localhost Binding', () => {
  let daemon: NirmanDaemon | null = null;

  afterEach(async () => {
    if (daemon) {
      await daemon.close();
      daemon = null;
    }
  });

  it('rejects binding to remote hosts and enforces localhost only', () => {
    expect(() => {
      new NirmanDaemon({ host: '0.0.0.0', port: 0 });
    }).toThrow('Security restriction: Server can only bind to localhost');

    expect(() => {
      new NirmanDaemon({ host: '192.168.1.1', port: 0 });
    }).toThrow('Security restriction: Server can only bind to localhost');
  });

  it('rejects unauthenticated HTTP requests with 401 Unauthorized', async () => {
    daemon = new NirmanDaemon({ host: '127.0.0.1', port: 0 });
    await daemon.start();
    const port = daemon.getPort();

    const statusCode = await new Promise<number>((resolve) => {
      http.get(`http://127.0.0.1:${port}/status`, (res) => {
        resolve(res.statusCode ?? 0);
      });
    });

    expect(statusCode).toBe(401);
  });

  it('allows authenticated HTTP requests with valid session token', async () => {
    daemon = new NirmanDaemon({ host: '127.0.0.1', port: 0 });
    await daemon.start();
    const port = daemon.getPort();
    const token = daemon.getToken();

    const body = await new Promise<string>((resolve) => {
      http.get(
        `http://127.0.0.1:${port}/status?token=${token}`,
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve(data));
        },
      );
    });

    const parsed = JSON.parse(body) as { status: string };
    expect(parsed.status).toBe('ok');
  });

  it('rejects unauthenticated WebSocket connection', async () => {
    daemon = new NirmanDaemon({ host: '127.0.0.1', port: 0 });
    await daemon.start();
    const port = daemon.getPort();

    const connectionError = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      ws.on('error', () => {
        resolve(true);
      });
      ws.on('open', () => {
        ws.close();
        resolve(false);
      });
    });

    expect(connectionError).toBe(true);
  });

  it('accepts authenticated WebSocket connection with session token', async () => {
    daemon = new NirmanDaemon({ host: '127.0.0.1', port: 0 });
    await daemon.start();
    const port = daemon.getPort();
    const token = daemon.getToken();

    const connected = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
      ws.on('open', () => {
        ws.close();
        resolve(true);
      });
      ws.on('error', () => {
        resolve(false);
      });
    });

    expect(connected).toBe(true);
  });
});
