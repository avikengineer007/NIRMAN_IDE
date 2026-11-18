import { NirmanDaemon } from './daemon.js';

async function main() {
  const args = process.argv.slice(2);
  let port = Number(process.env.NIRMAN_SERVER_PORT || process.env.PORT || 4096);
  let host = process.env.NIRMAN_SERVER_HOST || process.env.HOST || '127.0.0.1';
  let token = process.env.NIRMAN_SESSION_TOKEN || process.env.TOKEN;
  let baseWorktreesDir = process.env.NIRMAN_WORKTREES_DIR;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' && args[i + 1]) {
      port = Number(args[++i]);
    } else if (arg === '--host' && args[i + 1]) {
      host = args[++i]!;
    } else if (arg === '--token' && args[i + 1]) {
      token = args[++i];
    } else if (arg === '--worktrees-dir' && args[i + 1]) {
      baseWorktreesDir = args[++i];
    }
  }

  const daemon = new NirmanDaemon({
    port,
    host,
    token,
    baseWorktreesDir,
  });

  await daemon.start();

  console.log(`[NIRMAN DAEMON] Started on ${daemon.getUrl()}`);
  console.log(`[NIRMAN DAEMON] Port: ${daemon.getPort()}`);
  console.log(`[NIRMAN DAEMON] Token: ${daemon.getToken()}`);

  const shutdown = async () => {
    console.log('[NIRMAN DAEMON] Shutting down...');
    await daemon.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main().catch((err) => {
  console.error('[NIRMAN DAEMON ERROR]', err);
  process.exit(1);
});
