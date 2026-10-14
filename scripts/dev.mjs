import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const api = fork(fileURLToPath(new URL('../server/index.mjs', import.meta.url)), ['--dev'], {
  cwd: rootDir,
  env: { ...process.env, NODE_ENV: 'development', PORT: '0' },
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
});
let vite;
let stopping = false;

const stop = async (code = 0) => {
  if (stopping) return;
  stopping = true;
  api.kill('SIGTERM');
  await vite?.close();
  process.exit(code);
};

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
process.once('exit', () => api.kill('SIGTERM'));

try {
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Development API startup timed out.')), 10_000);
    api.once('error', error => { clearTimeout(timeout); reject(error); });
    api.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Development API exited (${code}). Check .env.development.local.`));
    });
    api.on('message', message => {
      if (message?.type === 'ready') {
        clearTimeout(timeout);
        resolve(message.port);
      }
    });
  });
  api.once('exit', code => {
    if (!stopping) {
      console.error('Development API stopped; shutting down the development site.');
      void stop(code || 1);
    }
  });
  vite = await createServer({
    root: rootDir,
    server: {
      host: '127.0.0.1',
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${port}`,
          changeOrigin: true,
          // Flex may take 15 minutes per attempt, including provider retries.
          timeout: 65 * 60_000,
          proxyTimeout: 65 * 60_000,
        },
      },
    },
  });
  await vite.listen();
  vite.printUrls();
} catch (error) {
  console.error(error.message);
  await stop(1);
}
