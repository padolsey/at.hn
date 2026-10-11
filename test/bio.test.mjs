import assert from 'node:assert/strict';
import test from 'node:test';
import { renderBio } from '../bio.mjs';

test('renderer instances preserve per-profile link policy without accumulating global overrides', () => {
  for (let i = 0; i < 100; i++) {
    const karma = i % 2 ? 201 : 10;
    const html = renderBio('fixture.at.hn\n\n[external](https://example.test)', /fixture\.at\.hn/, karma);
    assert.ok(html.includes(karma > 200 ? 'rel="noopener noreferrer"' : 'rel="noopener noreferrer nofollow"'));
  }
});
