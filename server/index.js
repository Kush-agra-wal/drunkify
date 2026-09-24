import { createApp, loadConfig } from './app.js';

const config = loadConfig();
const app = createApp(config);

app.server.on('error', (err) => {
  console.error(`[server] ${err.message}`);
  process.exit(1);
});

app.server.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${app.server.address().port}`);
});

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[server] ${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 10000);
  force.unref();
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    console.error('[server] shutdown error', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
