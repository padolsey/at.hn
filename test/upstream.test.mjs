import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startApp } from './support/app.mjs';

test('upstream pacing allows at most two starts per interval', async t => {
  const app = await startApp(t);
  for (const user of ['one', 'two', 'three']) assert.equal((await app.request('/user?user=' + user)).status, 200);
  const starts = app.events.filter(event => event.type === 'fetch').map(event => event.time);
  assert.equal(starts.length, 3);
  assert.ok(starts[2] - starts[0] >= 900, `third fetch started after ${starts[2] - starts[0]}ms`);
});

test('simultaneous requests for one identity share an upstream fetch', async t => {
  const app = await startApp(t, { fixtures: { fixture: { delay: 100 } } });
  const responses = await Promise.all([app.request('/user?user=fixture'), app.request('/user?user=fixture&refresh')]);
  assert.deepEqual(responses.map(res => res.status), [200, 303]);
  assert.equal(app.events.filter(event => event.type === 'fetch').length, 1);
});

test('timeouts release active and queued work while cached pages remain usable', { timeout: 12000 }, async t => {
  const fixtures = Object.fromEntries(['one', 'two', 'three', 'four'].map(user => [user, { hang: true }]));
  const app = await startApp(t, { fixtures });
  assert.equal((await app.request('/user?user=cached')).status, 200);
  const pending = ['one', 'two', 'three'].map(user => app.request('/user?user=' + user + '&refresh'));
  await delay(100);
  assert.equal((await app.request('/user?user=four&refresh')).status, 503);
  assert.equal((await app.request('/user?user=cached')).status, 200);
  assert.deepEqual((await Promise.all(pending)).map(res => res.status), [504, 504, 504]);
  assert.equal((await app.request('/user?user=recovered')).status, 200);
  assert.ok(app.events.filter(event => event.type === 'fetch').every(event => event.signal));
});

test('upstream failures use distinguishable status codes', async t => {
  const app = await startApp(t, { fixtures: {
    missing: { status: 404 }, failing: { status: 503 }, broken: { error: true }
  } });
  assert.equal((await app.request('/user?user=missing')).status, 404);
  assert.equal((await app.request('/user?user=failing')).status, 502);
  assert.equal((await app.request('/user?user=broken')).status, 502);
});
