import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { realpath, readFile, readdir, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { FileStore, emptyState } from '../storage/task-store.mjs';
import { TaskService } from '../domain/task-service.mjs';

export function dataDirectory(base = process.env.TASKFLOW_QODER_DATA || process.env.QODER_PLUGIN_DATA) {
  if (base?.includes('${')) base = undefined;
  return base ? resolve(base) : join(homedir(), '.qoder', 'taskflow');
}

export async function projectDirectory(cwd = process.env.QODER_PROJECT_DIR || process.cwd(), base) {
  const project = await realpath(cwd);
  // Plugin installs/upgrades are disposable; state belongs outside the package.
  const key = createHash('sha256').update(process.platform === 'win32' ? project.toLowerCase() : project).digest('hex');
  return join(dataDirectory(base), 'projects', key);
}

export async function rememberProject(directory, projectPath) {
  const destination = join(directory, 'project.json'), bytes = JSON.stringify({ projectPath: await realpath(projectPath) });
  try { if (await readFile(destination, 'utf8') === bytes) return; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.project-${process.pid}-${Date.now()}.tmp`);
  try {
    await writeFile(temporary, bytes);
    const deadline = Date.now() + 3000;
    for (;;) {
      try { await rename(temporary, destination); break; }
      catch (e) { if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || Date.now() >= deadline) throw e; await new Promise(r => setTimeout(r, 50)); }
    }
  }
  finally { await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}

// Desktop MCP processes are shared across workspaces. Catalogue explicitly
// labelled projects; never interpret the server's startup cwd as a workspace.
export async function projectCatalogue(base) {
  const root = join(dataDirectory(base), 'projects');
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return { plans: [] }; throw e; }
  const plans = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    const directory = join(root, entry.name);
    try {
      const { projectPath } = JSON.parse(await readFile(join(directory, 'project.json'), 'utf8'));
      if (await projectDirectory(projectPath, base) !== directory) throw new Error('Taskflow project catalogue path mismatch');
      const state = await snapshot(directory);
      plans.push(...Object.values(state.plans).map(p => ({ title: p.title, sessionId: p.rootSessionId, updatedAt: p.updatedAt, projectPath })));
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return { plans: plans.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
}

// Qoder's thread App proxy supplies its bound conversation in request metadata.
// Resolve only that exact session, including child/explicit-resume aliases. Never
// pick the most recent plan: the MCP process can serve multiple windows/projects.
export async function sessionProject(sessionId, base) {
  const root = join(dataDirectory(base), 'projects');
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  let match = null;
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    const directory = join(root, entry.name), state = await snapshot(directory);
    if (!Object.hasOwn(state.sessions, sessionId)) continue;
    const { projectPath } = JSON.parse(await readFile(join(directory, 'project.json'), 'utf8'));
    if (await projectDirectory(projectPath, base) !== directory) throw new Error('Taskflow session project path mismatch');
    if (match) throw new Error('当前会话对应多个项目，无法确定任务清单');
    match = { directory, projectPath };
  }
  return match;
}

export async function snapshot(directory) {
  let state;
  try { state = JSON.parse(await readFile(join(directory, 'taskflow.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return emptyState(); throw error; }
  if (state.schema !== 1 || !state.plans || !state.sessions || !Array.isArray(state.outbox)) throw new Error('Unsupported Taskflow state schema');
  return state;
}

// Each MCP process may serve a different Qoder session. Acquire the existing
// durable FileStore lock for one operation, never for a whole conversation.
export async function withService(directory, operation) {
  let store;
  const deadline = Date.now() + 8000;
  for (;;) {
    try { store = await new FileStore(directory).init(); break; }
    catch (error) {
      // A contender can observe the newly created lock before its PID write.
      // Retry without deleting it; a persistently malformed lock still fails.
      if (Date.now() >= deadline || !['EEXIST', 'ENOENT'].includes(error.code) && !error.message.includes('active writer') && !error.message.includes('writer lock is invalid')) throw error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  try { return await operation(new TaskService(store)); }
  finally { await store.close(); }
}
