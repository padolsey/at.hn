// No HTTP or production data. Execute the original registration block verbatim
// or the fixed render function, then measure retained heap after forced GC.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { marked } from 'marked';
import he from 'he';
import { renderBio, sansHtml } from '../bio.mjs';

assert.equal(typeof globalThis.gc, 'function', 'Run with node --expose-gc');
const revision = process.argv[2];
let render;
if (revision) {
  const source = execFileSync('git', ['show', `${revision}:server.mjs`], { encoding: 'utf8' });
  const start = source.indexOf('          marked.use({');
  const end = source.indexOf('\n          const bioHtml', start);
  assert.ok(start >= 0 && end > start, 'Revision must contain the original registration block');
  const register = new Function('marked', 'he', 'sansHtml', 'karma', source.slice(start, end));
  render = karma => register(marked, he, sansHtml, karma);
} else render = karma => renderBio('fixture.at.hn\n\n[external](https://example.test)', /fixture\.at\.hn/, karma);

for (let i = 0; i < 20; i++) render(i);
globalThis.gc();
const before = process.memoryUsage().heapUsed;
for (let i = 0; i < 50000; i++) render(i);
globalThis.gc();
const retainedBytes = process.memoryUsage().heapUsed - before;
console.log(JSON.stringify({ mode: revision ? 'before' : 'fixed', revision, registrations: 50000, retainedBytes }));
if (revision) assert.ok(retainedBytes > 20 * 1024 * 1024, 'Expected retained renderer history on baseline');
else assert.ok(retainedBytes < 10 * 1024 * 1024, 'Renderer history must not accumulate');
