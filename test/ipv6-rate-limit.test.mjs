import assert from 'node:assert/strict';
import test from 'node:test';
import { startApp } from './support/app.mjs';

test('equivalent IPv6 spellings and addresses in one /56 share a rate limit', async t => {
  const app = await startApp(t, { env: { TRUSTED_PROXY_CIDRS: '127.0.0.1/32' } });
  const request = address => app.request('/user?user=fixture', { 'X-Forwarded-For': address });
  for (let i = 0; i < 50; i++) assert.equal((await request('2001:db8:1::1')).status, 200);
  const statuses = [];
  for (const address of [
    '2001:db8:1::1',
    '2001:0db8:0001:0000:0000:0000:0000:0001',
    '2001:db8:1::2',
    '2001:db8:1:ff::1'
  ]) statuses.push((await request(address)).status);
  assert.deepEqual(statuses, [429, 429, 429, 429]);
  assert.equal((await request('2001:db8:1:100::1')).status, 200);
  assert.equal((await request('192.0.2.1')).status, 200);
  assert.equal((await request('192.0.2.2')).status, 200);
});

test('mapped IPv6 spellings share the underlying IPv4 client bucket', async t => {
  const app = await startApp(t, { env: { TRUSTED_PROXY_CIDRS: '127.0.0.1/32' } });
  const request = address => app.request('/user?user=fixture', { 'X-Forwarded-For': address });
  for (let i = 0; i < 50; i++) assert.equal((await request('192.0.2.1')).status, 200);
  const statuses = [];
  for (const address of ['192.0.2.1', '::ffff:192.0.2.1', '0:0:0:0:0:ffff:c000:201']) {
    statuses.push((await request(address)).status);
  }
  assert.deepEqual(statuses, [429, 429, 429]);
  assert.equal((await request('192.0.2.2')).status, 200);
});
