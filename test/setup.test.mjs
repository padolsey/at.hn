import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { startApp } from './support/app.mjs';

function document(t, response) {
  const dom = new JSDOM(response.body);
  t.after(() => dom.window.close());
  return dom.window.document;
}

test('setup generates the exact case-sensitive address without fetching or scripting', async t => {
  const app = await startApp(t);
  const home = await app.request('/');
  const form = document(t, home).querySelector('form');
  assert.equal(form.getAttribute('action'), '/setup');
  assert.equal(form.getAttribute('method'), 'get');
  const setup = await app.request('/setup?username=Rally_driver');
  assert.equal(setup.status, 200);
  const doc = document(t, setup);
  assert.equal(doc.querySelector('#address').value, 'r0x52ally0x5fdriver.at.hn');
  assert.ok(doc.querySelector('a[href="https://news.ycombinator.com/user?id=Rally_driver"]'));
  assert.equal(doc.querySelector('script'), null);
  assert.equal(app.events.filter(event => event.type === 'fetch').length, 0);
  const check = doc.querySelector('a.button').getAttribute('href');
  const ready = await app.request(check);
  assert.equal(ready.status, 303);
  assert.equal(ready.headers.location, 'https://r0x52ally0x5fdriver.at.hn');
  assert.equal(app.events.find(event => event.type === 'fetch').username, 'Rally_driver');
});

test('setup rejects malformed, ambiguous and unrepresentable names without reflecting HTML', async t => {
  const app = await startApp(t);
  for (const query of ['', 'username=a&username=b', 'username=r0x52ally', 'username=a0x5fb',
    'username=' + 'A'.repeat(13), 'username=-abc', 'username=abc-', 'username=www',
    'username=xn--a', 'username=xn--abc',
    'username=' + encodeURIComponent('"><img src=x onerror=alert(1)>')]) {
    const response = await app.request('/setup?' + query);
    assert.equal(response.status, 400, query);
    const doc = document(t, response);
    assert.equal(doc.querySelector('img, script, [onerror]'), null);
    assert.equal(doc.querySelector('#username').getAttribute('aria-invalid'), 'true');
    assert.equal(doc.querySelector('#address'), null);
  }
  const valid = await app.request('/setup?username=xn--bcher-kva');
  assert.equal(valid.status, 200);
  assert.equal(document(t, valid).querySelector('#address').value, 'xn--bcher-kva.at.hn');
  assert.equal(app.events.filter(event => event.type === 'fetch').length, 0);
});

test('forms are allowed only on application setup pages; all dynamic pages avoid HTTP caching', async t => {
  const app = await startApp(t);
  for (const url of ['/', '/index.html', '/setup?username=fixture', '/setup?username=']) {
    const response = await app.request(url);
    assert.match(response.headers['content-security-policy'], /form-action 'self'/);
    assert.match(response.headers['content-security-policy'], /default-src 'none'/);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  for (const [url, headers] of [['/user?user=fixture', {}], ['/user', {}],
    ['/', { Host: 'fixture.at.hn' }], ['/setup', { Host: 'fixture.at.hn' }],
    ['/index.html', { Host: 'fixture.at.hn' }]]) {
    const response = await app.request(url, headers);
    assert.match(response.headers['content-security-policy'], /form-action 'none'/);
    assert.equal(document(t, response).querySelector('form'), null);
    if (url !== '/index.html') assert.equal(response.headers['cache-control'], 'no-store');
  }
});

test('retry bypasses a cached missing opt-in, refresh updates the page, and removal replaces it', async t => {
  const app = await startApp(t, { fixtures: { fixture: { sequence: [
    { profile: { about: 'No opt-in yet' } },
    { profile: { about: 'fixture.at.hn\n\nFirst bio.' } },
    { profile: { about: 'fixture.at.hn\n\nUpdated bio.' } },
    { profile: { about: 'Opted out.' } }
  ] } } });
  const first = await app.request('/user?user=fixture&refresh');
  assert.equal(first.status, 404);
  assert.match(first.body, /This page is not published/);
  const cached = await app.request('/user?user=fixture');
  assert.equal(cached.body, first.body);
  const retry = new URL(document(t, cached).querySelector('a.button').href);
  const ready = await app.request(retry.pathname + retry.search, { Host: retry.host });
  assert.equal(ready.status, 303);
  const profile = await app.request('/', { Host: 'fixture.at.hn' });
  const doc = document(t, profile);
  assert.match(doc.querySelector('.bio').textContent, /First bio/);
  const checkedAt = doc.querySelector('time').dateTime;
  assert.ok(Number.isFinite(Date.parse(checkedAt)));
  assert.equal(document(t, await app.request('/user?user=fixture')).querySelector('time').dateTime, checkedAt);
  const refresh = new URL(doc.querySelector('nav[aria-label="Manage this page"] a').href);
  assert.equal((await app.request(refresh.pathname + refresh.search, { Host: refresh.host })).status, 303);
  const updated = await app.request('/user?user=fixture');
  assert.match(document(t, updated).querySelector('.bio').textContent, /Updated bio/);
  assert.notEqual(document(t, updated).querySelector('time').dateTime, checkedAt);
  const removed = await app.request(refresh.pathname + refresh.search, { Host: refresh.host });
  assert.equal(removed.status, 404);
  assert.match(removed.body, /your cached page is no longer served/);
  assert.doesNotMatch(removed.body, /Updated bio/);
  assert.equal((await app.request('/user?user=fixture')).body, removed.body);
  assert.equal(app.events.filter(event => event.type === 'fetch').length, 4);
});

test('missing accounts, insufficient karma and upstream failures have distinct recovery guidance', async t => {
  const app = await startApp(t, { fixtures: {
    missing: { status: 404 }, low: { profile: { karma: 4 } }, unavailable: { error: true }
  } });
  for (const [user, status, title] of [['missing', 404, 'Profile not found in the index'],
    ['low', 404, 'This account needs more karma'], ['unavailable', 502, 'Could not check your profile']]) {
    const response = await app.request('/user?user=' + user);
    assert.equal(response.status, status);
    assert.equal(document(t, response).querySelector('h1').textContent, title);
    assert.ok(document(t, response).querySelector('a.button').href.endsWith('/?refresh'));
    if (status === 502) assert.equal(response.headers['retry-after'], '30');
  }
});

test('development setup, refresh redirects and removal links stay on the configured origin', async t => {
  const app = await startApp(t, { env: { NODE_ENV: 'development' } });
  const setup = await app.request('/setup?username=Rally_driver');
  const check = document(t, setup).querySelector('a.button').getAttribute('href');
  const ready = await app.request(check);
  assert.equal(ready.headers.location, '/user?user=r0x52ally0x5fdriver');
  const doc = document(t, await app.request(ready.headers.location));
  assert.equal(doc.querySelector('nav[aria-label="Manage this page"] a').getAttribute('href'),
    '/user?user=r0x52ally0x5fdriver&refresh');
  assert.match(doc.querySelector('details').textContent, /Rally_driver.at.hn/);
  assert.match(doc.querySelector('details').textContent, /r0x52ally0x5fdriver.at.hn/);
});
