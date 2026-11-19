import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const emptyState = () => ({ schema: 1, revision: 0, plans: {}, sessions: {}, outbox: [] });

/** Single writer, fsync before rename, publish only after durable commit. */
export class FileStore {
  constructor(directory) { this.directory = directory; this.path = join(directory, 'taskflow.json'); this.tail = Promise.resolve(); this.state = emptyState(); }
  async init() {
    await mkdir(this.directory, { recursive: true });
    this.lockPath = join(this.directory, 'writer.lock');
    try { this.lock = await open(this.lockPath, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(await readFile(this.lockPath, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Taskflow writer lock is invalid; inspect it before recovery');
      try { process.kill(pid, 0); throw new Error('Taskflow data directory already has an active writer'); }
      catch (e) { if (e.code !== 'ESRCH') throw e; }
      await unlink(this.lockPath); this.lock = await open(this.lockPath, 'wx');
    }
    await this.lock.writeFile(String(process.pid));
    try {
      try { this.state = JSON.parse(await readFile(this.path, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw new Error(`Cannot read Taskflow state; original file preserved: ${error.message}`); }
      if (this.state.schema !== 1 || !this.state.plans || !this.state.sessions || !Array.isArray(this.state.outbox)) throw new Error('Unsupported Taskflow state schema; migration required');
      return this;
    } catch (error) { await this.close(); throw error; }
  }
  read() { return structuredClone(this.state); }
  transaction(change) {
    const pending = this.tail.then(async () => {
      const next = this.read();
      const result = await change(next);
      next.revision++;
      const temp = `${this.path}.${randomUUID()}.tmp`;
      let handle;
      try {
        handle = await open(temp, 'wx'); await handle.writeFile(JSON.stringify(next)); await handle.sync(); await handle.close(); handle = undefined;
        await rename(temp, this.path);
      } catch (error) { await handle?.close(); await unlink(temp).catch(() => {}); throw error; }
      this.state = next;
      return result;
    });
    this.tail = pending.catch(() => {});
    return pending;
  }
  async close() { await this.tail; if (this.lock) { await this.lock.close(); this.lock = undefined; await unlink(this.lockPath); } }
}

export class MemoryStore {
  constructor(state = emptyState()) { this.state = structuredClone(state); this.tail = Promise.resolve(); }
  read() { return structuredClone(this.state); }
  transaction(change) {
    const pending = this.tail.then(async () => { const next = this.read(); const result = await change(next); next.revision++; this.state = next; return result; });
    this.tail = pending.catch(() => {}); return pending;
  }
  async close() { await this.tail; }
}
