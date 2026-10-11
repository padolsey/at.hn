import assert from 'node:assert/strict';
import test from 'node:test';
import { startApp } from './support/app.mjs';

test('HTML-encoded delimiters preserve a visible exact opt-in', async t => {
  const app = await startApp(t, { fixtures: {
    quoted: { profile: { about: '&quot;quoted.at.hn&quot;' } },
    apostrophe: { profile: { about: '&#x27;apostrophe.at.hn&#x27;' } },
    space: { profile: { about: 'space.at.hn&nbsp;' } }
  } });
  const statuses = [];
  for (const user of ['quoted', 'apostrophe', 'space']) {
    statuses.push((await app.request('/user?user=' + user)).status);
  }
  assert.deepEqual(statuses, [200, 200, 200]);
});

test('DNS case differences preserve an encoded opt-in address', async t => {
  const app = await startApp(t, { fixtures: {
    fixture: { profile: { about: 'HTTPS://FIXTURE.AT.HN' } },
    Rally_driver: { profile: { about: 'HTTPS://R0X52ALLY0X5FDRIVER.AT.HN' } }
  } });
  const statuses = [];
  for (const host of ['FIXTURE.AT.HN', 'R0X52ALLY0X5FDRIVER.AT.HN']) {
    statuses.push((await app.request('/', { Host: host })).status);
  }
  assert.deepEqual(statuses, [200, 200]);
});
