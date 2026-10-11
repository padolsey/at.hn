import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { startApp } from './support/app.mjs';

const { default: template } = await import(process.env.TEST_SOURCE_DIR
  ? path.join(process.env.TEST_SOURCE_DIR, 'template.mjs') : '../template.mjs');

test('missing and invalid usernames return 400 without terminating the server', async t => {
  const app = await startApp(t);
  for (const url of ['/user', '/user?user=', '/user?user=a&user=b', '/user?user=' + 'a'.repeat(64)]) {
    assert.equal((await app.request(url)).status, 400);
  }
  assert.equal((await app.request('/user?user=fixture')).status, 200);
});

test('Host is not used as a URL parser base', async t => {
  const app = await startApp(t);
  assert.equal((await app.request('/user?user=fixture', { Host: '%' })).status, 200);
  assert.equal((await app.request('/user?user=fixture')).status, 200);
});

test('crafted username cannot execute script in an error page', async t => {
  const user = 'audit<script>window.auditxss=true</script>';
  const app = await startApp(t, { fixtures: { [user]: { status: 404 } } });
  const res = await app.request('/user?user=' + encodeURIComponent(user));
  assert.equal(res.status, 400);
  const dom = new JSDOM(res.body, { runScripts: 'dangerously' });
  assert.equal(dom.window.auditxss, undefined);
  dom.window.close();
  assert.equal(app.events.filter(event => event.type === 'fetch').length, 0);
});

test('template escapes identifiers independently of request validation', () => {
  const html = template({ encodedUsername: 'x" onclick="alert(1)', decodedUsername: '</title><script>window.auditxss=true</script>', fields: { karma: '<img onerror="alert(1)">' }, bioHtml: '<p>safe</p>' });
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  assert.equal(dom.window.auditxss, undefined);
  assert.equal(dom.window.document.querySelector('[onclick], [onerror], script'), null);
  dom.window.close();
});

test('encoded usernames resolve to the same canonical identity and redirect', async t => {
  const app = await startApp(t);
  const res = await app.request('/user?user=r0x52ally0x5fdriver&refresh');
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, 'https://r0x52ally0x5fdriver.at.hn');
  assert.equal(app.events.find(event => event.type === 'fetch').username, 'Rally_driver');
});

test('opt-in must name the exact account and domain', async t => {
  const app = await startApp(t, { fixtures: {
    victim: { profile: { about: 'Unrelated prefixvictimXatYhn' } },
    suffix: { profile: { about: 'suffix.at.hn.evil.test' } },
    wrong: { profile: { username: 'another', about: 'wrong.at.hn' } }
  } });
  for (const user of ['victim', 'suffix', 'wrong']) assert.equal((await app.request('/user?user=' + user)).status, 404);
  assert.equal((await app.request('/user?user=fixture')).status, 200);
});

test('all permitted anchors retain enforced nofollow and opener/referrer policy', async t => {
  const app = await startApp(t, { fixtures: {
    fixture: { profile: { about: 'fixture.at.hn\n\n[external](https://example.test)\n\n&lt;a href="https://raw.test" rel="follow"&gt;raw&lt;/a&gt;\n\n[bad](javascript:alert(1)) &lt;img src=x onerror=alert(1)&gt;' } },
    established: { profile: { karma: 201 } }
  } });
  const res = await app.request('/user?user=fixture');
  const dom = new JSDOM(res.body);
  for (const host of ['example.test', 'raw.test']) {
    const link = dom.window.document.querySelector(`a[href="https://${host}"]`);
    assert.ok(link);
    assert.equal(link.getAttribute('rel'), 'noopener noreferrer nofollow');
  }
  assert.equal(dom.window.document.querySelector('[onerror],script,a[href^="javascript:"]'), null);
  dom.window.close();
  const high = new JSDOM((await app.request('/user?user=established')).body);
  assert.equal(high.window.document.querySelector('a[href="https://example.test"]').getAttribute('rel'), 'noopener noreferrer');
  high.window.close();
});
