import net from 'node:net';
import path from 'node:path';

const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  const callback = args.findLast(arg => typeof arg === 'function');
  return originalListen.call(this, 0, '127.0.0.1', () => {
    callback?.();
    process.send({ type: 'ready', port: this.address().port });
  });
};

const calls = new Map();
const fixtures = JSON.parse(process.env.TEST_FIXTURES || '{}');
globalThis.fetch = async (url, options = {}) => {
  const username = decodeURIComponent(String(url).split('/').at(-1));
  const source = fixtures[username] || {};
  const count = calls.get(username) || 0;
  calls.set(username, count + 1);
  const fixture = source.sequence ? source.sequence[Math.min(count, source.sequence.length - 1)] : source;
  process.send({ type: 'fetch', username, signal: Boolean(options.signal), time: Date.now() });
  if (fixture.hang || fixture.delay) {
    await new Promise((resolve, reject) => {
      const timer = fixture.delay ? setTimeout(resolve, fixture.delay) : null;
      const abort = () => { clearTimeout(timer); reject(options.signal.reason); };
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener('abort', abort, { once: true });
    });
  }
  if (fixture.error) throw new Error('Fixture upstream error');
  return {
    ok: fixture.status ? fixture.status === 200 : true,
    status: fixture.status || 200,
    statusText: 'Fixture status',
    json: async () => {
      if (fixture.bodyHang) {
        await new Promise((resolve, reject) => {
          const abort = () => reject(options.signal.reason);
          if (options.signal?.aborted) abort();
          else options.signal?.addEventListener('abort', abort, { once: true });
        });
      }
      return ({
      username, about: `${username}.at.hn\n\nHello [external](https://example.test).`,
      karma: 10, created_at: '2020-01-01', ...fixture.profile
      });
    }
  };
};

if (!process.env.TEST_PRELOAD_ONLY) await import(path.join(process.env.TEST_SOURCE_DIR, 'server.mjs'));
