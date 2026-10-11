import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { startApp } from './support/app.mjs';

const filename = user => createHash('md5').update(user).digest('hex');
async function seed(dir, user, checkedAt = Date.now()) {
  const html = '<p>old-profile-content</p>';
  await fs.writeFile(path.join(dir, 'profiles', filename(user) + '.html'), html);
  await fs.writeFile(path.join(dir, 'profiles', filename(user) + '.json'), JSON.stringify({ version: 1, key: user, checkedAt, status: 200, html }));
}

test('expired disk HTML is revalidated rather than served indefinitely', async t => {
  const app = await startApp(t, { fixtures: { stale: { profile: { about: '' } } }, prepare: dir => seed(dir, 'stale', 946684800000) });
  assert.equal((await app.request('/user?user=stale')).status, 404);
  assert.equal(app.events.filter(event => event.type === 'fetch').length, 1);
});

for (const fixture of [{ profile: { karma: 0 } }, { profile: { about: null } }, { profile: { about: '' } }, { status: 404 }]) {
  test('confirmed ineligibility replaces old cache: ' + JSON.stringify(fixture), async t => {
    const app = await startApp(t, { fixtures: { revoked: fixture }, prepare: dir => seed(dir, 'revoked') });
    assert.equal((await app.request('/user?user=revoked&refresh')).status, 404);
    const ordinary = await app.request('/user?user=revoked');
    assert.equal(ordinary.status, 404);
    assert.ok(!ordinary.body.includes('old-profile-content'));
    const disk = JSON.parse(await fs.readFile(path.join(app.dir, 'profiles', filename('revoked') + '.json'), 'utf8'));
    assert.equal(disk.status, 404);
    assert.ok(!disk.html.includes('old-profile-content'));
  });
}

test('refresh bypasses memory and disk cache; upstream failures retain only fresh cached content', async t => {
  const app = await startApp(t, { fixtures: { fixture: { sequence: [{}, { error: true }] } } });
  assert.equal((await app.request('/user?user=fixture')).status, 200);
  assert.equal((await app.request('/user?user=fixture&refresh')).status, 502);
  assert.equal((await app.request('/user?user=fixture')).status, 200);
  assert.equal(app.events.filter(event => event.type === 'fetch').length, 2);
});

test('atomic cache writes and disk failures do not prevent valid profile responses', async t => {
  const app = await startApp(t);
  const responses = await Promise.all([app.request('/user?user=fixture&refresh'), app.request('/user?user=fixture&refresh')]);
  assert.deepEqual(responses.map(res => res.status), [303, 303]);
  const files = await fs.readdir(path.join(app.dir, 'profiles'));
  assert.equal(files.filter(file => file.endsWith('.tmp')).length, 0);
  const entry = JSON.parse(await fs.readFile(path.join(app.dir, 'profiles', filename('fixture') + '.json'), 'utf8'));
  assert.equal(entry.status, 200);
  await fs.rm(path.join(app.dir, 'profiles'), { recursive: true });
  await fs.writeFile(path.join(app.dir, 'profiles'), 'Not a directory');
  assert.equal((await app.request('/user?user=another')).status, 200);
  assert.equal((await app.request('/user?user=another')).status, 200);
});
