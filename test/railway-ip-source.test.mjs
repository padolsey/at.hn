import assert from 'node:assert/strict';
import test from 'node:test';
import { createClientIpKey } from '../client-ip.mjs';
import { startApp } from './support/app.mjs';

test('Railway mode ignores forged headers from an untrusted socket', async t => {
  const app = await startApp(t, { env: { CLIENT_IP_SOURCE: 'railway-edge', TRUSTED_PROXY_CIDRS: '100.64.0.2/32,100.64.0.3/32' } });
  for (let i = 0; i < 50; i++) assert.equal((await app.request('/user?user=fixture', {
    'X-Real-IP': `192.0.2.${i + 1}`, 'X-Forwarded-For': `198.51.100.${i + 1}`, 'CF-Connecting-IP': `192.0.2.${i + 1}`
  })).status, 200);
  assert.equal((await app.request('/user?user=fixture', { 'X-Real-IP': '203.0.113.99' })).status, 429);
});

test('configured edge fixture keys by real IP instead of a forwarded chain', async t => {
  const app = await startApp(t, { env: { CLIENT_IP_SOURCE: 'railway-edge', TRUSTED_PROXY_CIDRS: '127.0.0.1/32' } });
  for (let i = 0; i < 50; i++) assert.equal((await app.request('/user?user=fixture', {
    'X-Real-IP': '192.0.2.1', 'X-Forwarded-For': `198.51.100.${i + 1}`
  })).status, 200);
  assert.equal((await app.request('/user?user=fixture', { 'X-Real-IP': '192.0.2.1', 'X-Forwarded-For': '203.0.113.99' })).status, 429);
  assert.equal((await app.request('/user?user=fixture', { 'X-Real-IP': '192.0.2.2', 'X-Forwarded-For': '203.0.113.99' })).status, 200);
});

test('edge key validates mode, peer and header before normalizing addresses', () => {
  assert.throws(() => createClientIpKey({ source: 'typo' }));
  assert.throws(() => createClientIpKey({ source: 'railway-edge' }));
  const warnings = [];
  const key = createClientIpKey({ source: 'railway-edge', trustPeer: peer => ['100.64.0.2', '100.64.0.3'].includes(peer), warn: value => warnings.push(value) });
  const req = (peer, value) => ({ socket: { remoteAddress: peer }, ip: '203.0.113.250', headers: { 'x-real-ip': value, 'x-forwarded-for': '203.0.113.251', 'cf-connecting-ip': '203.0.113.252' } });
  for (const peer of ['100.64.0.2', '100.64.0.3']) {
    assert.equal(key(req(peer, '192.0.2.1')), '192.0.2.1');
    assert.equal(key(req(peer, '::ffff:192.0.2.1')), '192.0.2.1');
    assert.equal(key(req(peer, '0:0:0:0:0:ffff:c000:201')), '192.0.2.1');
    assert.equal(key(req(peer, '2001:db8:1::1')), key(req(peer, '2001:0db8:1:ff::2')));
    assert.notEqual(key(req(peer, '2001:db8:1::1')), key(req(peer, '2001:db8:1:100::1')));
    for (const value of [undefined, '', 'bad', '192.0.2.1, 192.0.2.2', ['192.0.2.1', '192.0.2.2']]) assert.equal(key(req(peer, value)), 'railway-unverified-ingress');
  }
  for (const peer of ['10.250.24.111', '100.64.0.99']) assert.equal(key(req(peer, '192.0.2.1')), 'railway-unverified-ingress');
  assert.equal(key(req('fd12:71f2:3b77::1', '192.0.2.1')), key(req('fd12:71f2:3b77::2', '192.0.2.99')));
  for (let i = 0; i < 100; i++) key(req(`10.0.0.${i}`, '192.0.2.1'));
  assert.equal(warnings.length, 16);
  assert.ok(warnings.every(value => value.event === 'client_ip_fallback'));
});

test('unknown rotating ingress and malformed headers share a single fallback quota', () => {
  const key = createClientIpKey({ source: 'railway-edge', trustPeer: peer => peer === '100.64.0.2', warn: () => {} });
  const request = (peer, value) => ({ socket: { remoteAddress: peer }, headers: { 'x-real-ip': value } });
  const fallback = key(request('100.64.0.2', undefined));
  for (let i = 3; i < 100; i++) assert.equal(key(request(`100.64.0.${i}`, `192.0.2.${i}`)), fallback);
  assert.equal(key(request('10.250.24.111', '203.0.113.99')), fallback);
  assert.equal(key(request('fd12:71f2:3b77::1', '203.0.113.99')), fallback);
  assert.notEqual(key(request('100.64.0.2', '192.0.2.1')), fallback);
});
