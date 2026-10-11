import { fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function startApp(t, { fixtures = {}, env = {}, prepare } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'athn-test-'));
  await fs.mkdir(path.join(dir, 'profiles'));
  await fs.mkdir(path.join(dir, 'public'));
  await fs.copyFile(path.join(root, 'public/index.html'), path.join(dir, 'public/index.html'));
  await prepare?.(dir);
  const child = fork(fileURLToPath(new URL('./child.mjs', import.meta.url)), [], {
    cwd: dir,
    env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: '0', TEST_SOURCE_DIR: process.env.TEST_SOURCE_DIR || root, TEST_FIXTURES: JSON.stringify(fixtures), ...env },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  const app = { dir, child, events: [], logs: '' };
  child.stdout.on('data', data => { app.logs += data; });
  child.stderr.on('data', data => { app.logs += data; });
  child.on('message', message => app.events.push(message));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    await fs.rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('App startup timeout')), 5000);
    child.on('message', message => {
      if (message.type === 'ready') { app.port = message.port; clearTimeout(timer); resolve(); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`App exited: ${code}`)); });
  });
  app.request = (url, headers = {}, timeout = 8000) => new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: app.port, path: url, headers }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', data => { body += data; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(timeout, () => req.destroy(new Error('Test client timeout')));
    req.on('error', reject);
  });
  return app;
}
