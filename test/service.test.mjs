import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { startApp } from './support/app.mjs';

test('health endpoint works on apex and user hosts without an upstream fetch', async t => {
  const app = await startApp(t);
  for (const host of ['at.hn', 'fixture.at.hn']) {
    const res = await app.request('/healthz', { Host: host });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { status: 'ok' });
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  assert.equal(app.events.filter(event => event.type === 'fetch').length, 0);
});

test('homepage, profiles and errors receive restrictive browser policies', async t => {
  const app = await startApp(t);
  for (const url of ['/', '/user?user=fixture', '/user']) {
    const res = await app.request(url);
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.equal(res.headers['strict-transport-security'], 'max-age=31536000; includeSubDomains');
    assert.match(res.headers['content-security-policy'], /default-src 'none'/);
    assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.match(res.headers['content-security-policy'], /style-src 'unsafe-inline'/);
  }
});

test('SIGTERM drains an in-flight request and exits successfully', { timeout: 15000 }, async t => {
  const app = await startApp(t, { fixtures: { fixture: { delay: 200 } } });
  const response = app.request('/user?user=fixture');
  // Wait until the request is active before delivering a termination signal.
  while (!app.events.some(event => event.type === 'fetch')) await new Promise(resolve => setTimeout(resolve, 5));
  const exited = once(app.child, 'exit');
  app.child.kill('SIGTERM');
  assert.equal((await response).status, 200);
  const [code, signal] = await exited;
  assert.equal(code, 0);
  assert.equal(signal, null);
});

test('direct production entry sets production mode and receives SIGTERM', { timeout: 15000 }, async t => {
  const app = await startApp(t, {
    entryFile: 'start.mjs', env: { NODE_ENV: 'development' },
    fixtures: { fixture: { delay: 200 } }
  });
  const health = await app.request('/healthz');
  assert.equal(health.status, 200);
  assert.equal(health.headers['strict-transport-security'], 'max-age=31536000; includeSubDomains');
  const response = app.request('/user?user=fixture');
  while (!app.events.some(event => event.type === 'fetch')) await new Promise(resolve => setTimeout(resolve, 5));
  const exited = once(app.child, 'exit');
  app.child.kill('SIGTERM');
  assert.equal((await response).status, 200);
  const [code, signal] = await exited;
  assert.equal(code, 0);
  assert.equal(signal, null);
});
