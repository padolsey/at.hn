import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ProfileCache } from '../profile-cache.mjs';

async function cacheFor(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'athn-cache-race-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return new ProfileCache(dir);
}

test('an older delayed positive write cannot overwrite a completed revocation', async t => {
  const cache = await cacheFor(t);
  await cache.ready;
  const original = fs.writeFile;
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  fs.writeFile = async (...args) => {
    if (JSON.parse(args[1]).status === 200) { entered(); await blocked; }
    return original(...args);
  };
  try {
    const old = cache.put('fixture', '<p>old</p>', 200);
    await started;
    const revoked = cache.put('fixture', '<p>unavailable</p>', 404);
    release();
    await Promise.all([old, revoked]);
    assert.equal(JSON.parse(await fs.readFile(cache.file('fixture'), 'utf8')).status, 404);
    assert.equal((await new ProfileCache(cache.directory).get('fixture')).status, 404);
  } finally { release(); fs.writeFile = original; }
});

test('a delayed old disk read cannot replace a newer memory revocation', async t => {
  const cache = await cacheFor(t);
  await cache.put('fixture', '<p>old</p>', 200);
  cache.memory.delete('fixture');
  const original = fs.readFile;
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  fs.readFile = async (...args) => { const data = await original(...args); entered(); await blocked; return data; };
  try {
    const reading = cache.get('fixture');
    await started;
    await cache.put('fixture', '<p>unavailable</p>', 404);
    release();
    assert.equal((await reading).status, 404);
    assert.equal((await cache.get('fixture')).status, 404);
  } finally { release(); fs.readFile = original; }
});

test('failed revocation persistence cannot revive disk data after eviction or restart', async t => {
  const cache = await cacheFor(t);
  await cache.put('fixture', '<p>old</p>', 200);
  const originalWrite = fs.writeFile;
  const originalUnlink = fs.unlink;
  fs.writeFile = async () => { throw Object.assign(new Error('Readonly fixture'), { code: 'EROFS' }); };
  fs.unlink = async () => { throw Object.assign(new Error('Readonly fixture'), { code: 'EROFS' }); };
  try { await cache.put('fixture', '<p>unavailable</p>', 404); }
  finally { fs.writeFile = originalWrite; fs.unlink = originalUnlink; }
  assert.equal((await cache.get('fixture')).status, 404);
  cache.memory.delete('fixture');
  assert.equal(await cache.get('fixture'), null);
  // Restart must revalidate positives; even an unreadable tombstone cannot
  // make an earlier process's cached 200 authoritative in the new process.
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(await new ProfileCache(cache.directory).get('fixture'), null);
});

test('entry-size bound applies to memory and disk', async t => {
  const cache = await cacheFor(t);
  await cache.put('fixture', 'x'.repeat(256 * 1024));
  assert.equal(cache.memory.has('fixture'), false);
  assert.equal(await cache.get('fixture'), null);
});
