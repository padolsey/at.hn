import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { setupHelper } from '../public/setup-helper.mjs';
import { startApp } from './support/app.mjs';

function document(t, response) {
  const dom = new JSDOM(response.body);
  t.after(() => dom.window.close());
  return dom.window.document;
}

test('the form fallback generates the exact case-sensitive address without fetching or scripting', async t => {
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

test('the homepage preserves its instructions and example while serving the browser helper', async t => {
  const app = await startApp(t);
  const home = await app.request('/');
  const doc = document(t, home);
  assert.equal(doc.querySelector('header h1').textContent, '{you?}.at.hn');
  assert.ok(doc.querySelector('img[src="/screenshot.jpg"]'));
  assert.match(doc.querySelector('ol').textContent, /RallyDriver/);
  assert.match(doc.querySelector('ol').textContent, /rel=nofollow/);
  assert.ok(doc.querySelector('a[href="https://padolsey.at.hn"]'));
  assert.match(doc.querySelector('footer').textContent, /Made by James @padolsey/);
  assert.match(home.headers['content-security-policy'], /script-src 'self'; script-src-attr 'none'/);
  for (const asset of ['/setup-helper.mjs', '/username.mjs']) {
    const response = await app.request(asset);
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /javascript/);
  }
  const fallback = await app.request('/setup?username=fixture');
  assert.doesNotMatch(fallback.headers['content-security-policy'], /script-src 'self'/);
});

test('the browser helper updates in place, copies the exact address and rejects ambiguous names', async t => {
  const app = await startApp(t);
  const doc = document(t, await app.request('/'));
  let copied;
  setupHelper(doc, { writeText: async text => { copied = text; } });
  const input = doc.querySelector('#setup-username');
  const change = value => {
    input.value = value;
    input.dispatchEvent(new doc.defaultView.Event('input'));
  };
  assert.equal(doc.querySelector('#setup-result').hidden, true);
  assert.equal(doc.querySelector('#setup-submit').hidden, true);
  change(' Rally_driver ');
  assert.equal(doc.querySelector('#setup-result').hidden, false);
  assert.equal(doc.querySelector('#generated-address').value, 'r0x52ally0x5fdriver.at.hn');
  assert.equal(doc.querySelector('#profile-address').href, 'https://r0x52ally0x5fdriver.at.hn/');
  assert.equal(doc.querySelector('#edit-profile').href, 'https://news.ycombinator.com/user?id=Rally_driver');
  assert.equal(doc.querySelector('#check-profile').getAttribute('href'), '/user?user=r0x52ally0x5fdriver&refresh');
  const submit = new doc.defaultView.Event('submit', { cancelable: true });
  doc.querySelector('form').dispatchEvent(submit);
  assert.equal(submit.defaultPrevented, true);
  doc.querySelector('#copy-address').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(copied, 'r0x52ally0x5fdriver.at.hn');
  assert.match(doc.querySelector('#copy-status').textContent, /Copied/);
  for (const invalid of ['r0x52ally', 'www', 'xn--a', 'A'.repeat(13), '<img src=x>']) {
    change(invalid);
    assert.equal(doc.querySelector('#setup-result').hidden, true, invalid);
    assert.equal(doc.querySelector('#generated-address').value, '');
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal(doc.querySelector('#setup-error').hidden, false);
    assert.equal(doc.querySelector('#setup-error img'), null);
  }
  change('');
  assert.equal(doc.querySelector('#setup-error').hidden, true);
  change('rally_driver');
  assert.equal(doc.querySelector('#generated-address').value, 'rally0x5fdriver.at.hn');
  assert.equal(input.getAttribute('aria-invalid'), 'false');
  assert.equal(app.events.filter(event => event.type === 'fetch').length, 0);
});

test('preview browser links stay on staging and failed copying selects the address', async t => {
  const app = await startApp(t, { env: { PREVIEW_HOST: 'preview.at.hn' } });
  const doc = document(t, await app.request('/', { Host: 'preview.at.hn' }));
  setupHelper(doc, { writeText: async () => { throw new Error('Permission denied'); } });
  const input = doc.querySelector('#setup-username');
  input.value = 'Rally_driver';
  input.dispatchEvent(new doc.defaultView.Event('input'));
  assert.equal(doc.querySelector('#profile-address').getAttribute('href'), '/user?user=r0x52ally0x5fdriver');
  doc.querySelector('#copy-address').click();
  await new Promise(resolve => setImmediate(resolve));
  const address = doc.querySelector('#generated-address');
  assert.equal(doc.activeElement, address);
  assert.equal(address.selectionStart, 0);
  assert.equal(address.selectionEnd, address.value.length);
  assert.match(doc.querySelector('#copy-status').textContent, /Copy it with your keyboard or touch menu/);
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
    assert.doesNotMatch(response.headers['content-security-policy'], /script-src 'self'/);
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

test('the configured staging host keeps the complete flow in preview with production policies', async t => {
  const host = 'rollout-6f6c1de8.at.hn';
  const app = await startApp(t, { env: { PREVIEW_HOST: host } });
  const request = url => app.request(url, { Host: host });
  const home = await request('/');
  assert.equal(home.status, 200);
  assert.match(home.body, /Staging preview/);
  assert.equal(home.headers['x-robots-tag'], 'noindex, nofollow');
  assert.ok(home.headers['strict-transport-security']);
  assert.ok(document(t, home).querySelector('a[href="/user?user=padolsey"]'));
  const setup = await request('/setup?username=Rally_driver');
  const doc = document(t, setup);
  assert.equal(doc.querySelector('#address').value, 'r0x52ally0x5fdriver.at.hn');
  const ready = await request(doc.querySelector('a.button').getAttribute('href'));
  assert.equal(ready.status, 303);
  assert.equal(ready.headers.location, '/user?user=r0x52ally0x5fdriver');
  const profile = await request(ready.headers.location);
  assert.equal(profile.status, 200);
  assert.match(profile.headers['content-security-policy'], /form-action 'none'/);
  const refresh = document(t, profile).querySelector('nav[aria-label="Manage this page"] a').getAttribute('href');
  assert.equal(refresh, '/user?user=r0x52ally0x5fdriver&refresh');
  assert.equal((await request(refresh)).headers.location, ready.headers.location);
  const ordinary = await app.request('/', { Host: 'another.at.hn' });
  assert.equal(ordinary.status, 200);
  assert.equal(document(t, ordinary).querySelector('form'), null);
  assert.equal(app.events.find(event => event.type === 'fetch').username, 'Rally_driver');
});
