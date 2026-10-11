import assert from 'node:assert/strict';
import test from 'node:test';
import { startApp } from './support/app.mjs';
import { trustedProxyCidrs } from '../proxy-trust.mjs';

test('untrusted forwarded addresses cannot reset the per-IP limiter', async t => {
  const app = await startApp(t);
  for (let i = 0; i < 50; i++) {
    assert.equal((await app.request('/user?user=fixture', { 'X-Forwarded-For': `192.0.2.${i + 1}` })).status, 200);
  }
  assert.equal((await app.request('/user?user=fixture', { 'X-Forwarded-For': '198.51.100.1' })).status, 429);
});

test('trusted ingress uses the closest untrusted client address', async t => {
  const app = await startApp(t, { env: { TRUSTED_PROXY_CIDRS: '127.0.0.1/32' } });
  for (let i = 0; i < 50; i++) {
    assert.equal((await app.request('/user?user=fixture', { 'X-Forwarded-For': `198.51.100.${i + 1}, 192.0.2.1` })).status, 200);
  }
  assert.equal((await app.request('/user?user=fixture', { 'X-Forwarded-For': '203.0.113.1, 192.0.2.1' })).status, 429);
  assert.equal((await app.request('/user?user=fixture', { 'X-Forwarded-For': '192.0.2.2' })).status, 200);
});

test('blanket trust and malformed CIDRs are rejected', () => {
  assert.equal(trustedProxyCidrs(), false);
  assert.deepEqual(trustedProxyCidrs('10.0.0.0/8, ::1/128'), ['10.0.0.0/8', '::1/128']);
  assert.deepEqual(trustedProxyCidrs('2606:4700::/32, ::ffff:10.0.0.0/120'), ['2606:4700::/32', '::ffff:10.0.0.0/120']);
  for (const value of ['true', '1', 'loopback', '::/1', '::1/8', '::ff00:0:0/88', '::fff0:0:0/92', '::fffe:0:0/95', '0:0:0:1::/32', '0.0.0.0/0', '10.0.0.1/33', '::ffff:10.0.0.0/8', '::ffff:0.0.0.0/96', '0:0:0:0:0:ffff:0:0/8', '0:0:0:0:0:ffff:0:0/96', '10.0.0.1/32/1']) {
    assert.throws(() => trustedProxyCidrs(value));
  }
});
