import { LRUCache } from 'lru-cache';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const PROFILE_TTL = 3 * 60 * 60 * 1000;
const MAX_ENTRY_BYTES = 256 * 1024;
const MAX_FILES = 1000;

export class ProfileCache {
  constructor(directory) {
    this.directory = directory;
    this.memory = new LRUCache({ max: MAX_FILES, maxSize: 32 * 1024 * 1024,
      sizeCalculation: entry => Buffer.byteLength(entry.html) + 128 });
    this.ready = fs.mkdir(directory, { recursive: true }).catch(() => {});
    this.pruning = null;
  }

  file(key) {
    return path.join(this.directory, createHash('md5').update(key).digest('hex') + '.json');
  }

  remember(key, entry) {
    const remaining = entry.checkedAt + PROFILE_TTL - Date.now();
    if (remaining > 0) this.memory.set(key, entry, { ttl: remaining });
  }

  async get(key) {
    const remembered = this.memory.get(key);
    if (remembered) return remembered;
    await this.ready;
    try {
      const file = this.file(key);
      if ((await fs.stat(file)).size > MAX_ENTRY_BYTES) return null;
      const entry = JSON.parse(await fs.readFile(file, 'utf8'));
      const age = Date.now() - entry.checkedAt;
      if (entry.version !== 1 || entry.key !== key || ![200, 404].includes(entry.status) ||
          typeof entry.html !== 'string' || !Number.isFinite(entry.checkedAt) || age < 0 || age >= PROFILE_TTL) return null;
      this.remember(key, entry);
      return entry;
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(JSON.stringify({ event: 'profile_cache_read_failed' }));
      return null;
    }
  }

  async put(key, html, status = 200) {
    const entry = { version: 1, key, checkedAt: Date.now(), status, html };
    // Negative entries replace all memory state immediately on confirmed opt-out.
    this.remember(key, entry);
    await this.ready;
    const temporary = this.file(key) + '.' + randomUUID() + '.tmp';
    try {
      const data = JSON.stringify(entry);
      if (Buffer.byteLength(data) > MAX_ENTRY_BYTES) throw new Error('Cache entry too large');
      await fs.writeFile(temporary, data, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, this.file(key));
      await this.prune();
    } catch (err) {
      console.warn(JSON.stringify({ event: 'profile_cache_write_failed' }));
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
  }

  async prune() {
    if (this.pruning) return this.pruning;
    this.pruning = (async () => {
      const names = (await fs.readdir(this.directory)).filter(name => /^[a-f0-9]{32}\.(json|html)$/.test(name));
      const files = [];
      for (const name of names) {
        const file = path.join(this.directory, name);
        try {
          const stat = await fs.stat(file);
          if (name.endsWith('.html') || stat.size > MAX_ENTRY_BYTES || Date.now() - stat.mtimeMs >= PROFILE_TTL) {
            await fs.unlink(file);
          } else files.push({ file, mtime: stat.mtimeMs });
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
        }
      }
      files.sort((a, b) => b.mtime - a.mtime);
      for (const { file } of files.slice(MAX_FILES)) await fs.unlink(file).catch(() => {});
    })().finally(() => { this.pruning = null; });
    return this.pruning;
  }
}
