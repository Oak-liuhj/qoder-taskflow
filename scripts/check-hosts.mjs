import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import semver from 'semver';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Each fixture installs the packed plugin and a complete, exact host baseline.
// Its tests resolve dependencies there, never through the source checkout.
const run = promisify(execFile), root = process.cwd(), npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run with npm run check:hosts');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const archive = resolve('dist', `${pkg.name}-${pkg.version}.tgz`);
const archiveSha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
const versions = process.env.TASKFLOW_HOST_VERSIONS?.split(',').map(v => v.trim()).filter(Boolean) ?? ['0.2.1-rc.3', '0.2.2-rc.2', '0.2.2-rc.3'];
const hostNames = Object.keys(pkg.devDependencies).filter(name => name.startsWith('@deepseek-ai/dsh-') && (!name.startsWith('@deepseek-ai/dsh-client-') || ['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-ui-slots'].includes(name)));
const cache = resolve('.local/npm-cache'), results = [];
for (const version of versions) {
  assert.ok(semver.valid(version) && semver.satisfies(version, pkg.engines.dsh, { includePrerelease: true }), `Unsupported fixture: ${version}`);
  const legacy = semver.lt(version, '0.2.2-0');
  const cordis = legacy ? '4.0.5' : '4.1.0', schema = legacy ? '3.18.5' : '3.19.0';
  const fixture = await mkdtemp(join(tmpdir(), 'dsh-taskflow-host-'));
  console.log(`Checking host ${version}`);
  try {
    await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'taskflow-host-fixture', version: '1.0.0', private: true, type: 'module' }));
    await run(process.execPath, [npmCli, 'install', archive, ...hostNames.map(name => `${name}@${version}`), `@deepseek-ai/cordis@${cordis}`, `@deepseek-ai/schemastery@${schema}`, '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--cache', cache, '--registry=https://registry.npmjs.org/'], { cwd: fixture, maxBuffer: 8 * 1024 * 1024, timeout: 180000 });
    const dependencies = {};
    for (const name of hostNames) {
      const installed = JSON.parse(await readFile(join(fixture, 'node_modules', name, 'package.json'), 'utf8'));
      assert.equal(installed.version, version, `Fixture dependency: ${name}`);
      dependencies[name] = installed.version;
    }
    for (const [name, expected] of [['@deepseek-ai/cordis',cordis],['@deepseek-ai/schemastery',schema]]) {
      const installed = JSON.parse(await readFile(join(fixture, 'node_modules', name, 'package.json'), 'utf8'));
      assert.equal(installed.version, expected, `Fixture dependency: ${name}`);
      dependencies[name] = installed.version;
    }
    await mkdir(join(fixture, 'test'));
    await mkdir(join(fixture, 'src/server'), { recursive: true });
    const test = (await readFile('test/host.test.mjs', 'utf8')).replace('真实 DSH rc.2 AgentLoop', `真实 DSH ${version} AgentLoop`);
    await writeFile(join(fixture, 'test/host.test.mjs'), test);
    await copyFile('src/server/notifications.mjs', join(fixture, 'src/server/notifications.mjs'));
    await copyFile('test/rpc-http.test.mjs', join(fixture, 'test/rpc-http.test.mjs'));
    let rpcTest = await readFile(join(fixture, 'test/rpc-http.test.mjs'), 'utf8');
    rpcTest = rpcTest.replace("'../src/domain/task-service.mjs'", "'../node_modules/dsh-taskflow/src/domain/task-service.mjs'").replace("'../src/storage/task-store.mjs'", "'../node_modules/dsh-taskflow/src/storage/task-store.mjs'");
    await writeFile(join(fixture, 'test/rpc-http.test.mjs'), rpcTest);
    const inlineTest = (await readFile('test/inline-sessions.test.mjs', 'utf8')).replaceAll("'../src/", "'../node_modules/dsh-taskflow/src/");
    // The browser model is source-only; native persisted Session checks remain
    // in the packed-host fixture, while model navigation is covered locally.
    await writeFile(join(fixture, 'test/inline-sessions.test.mjs'), inlineTest);
    const viewsTest = (await readFile('test/tool-views.test.mjs', 'utf8')).replaceAll("'../src/", "'../node_modules/dsh-taskflow/src/");
    await writeFile(join(fixture, 'test/tool-views.test.mjs'), viewsTest);
    const repliesTest = (await readFile('test/quick-replies.test.mjs', 'utf8')).replaceAll("'../src/", "'../node_modules/dsh-taskflow/src/");
    await writeFile(join(fixture, 'test/quick-replies.test.mjs'), repliesTest);
    const plugin = join(fixture, 'node_modules', pkg.name, 'index.js');
    const { stdout } = await run(process.execPath, ['--test', 'test/host.test.mjs', 'test/rpc-http.test.mjs', 'test/inline-sessions.test.mjs', 'test/tool-views.test.mjs', 'test/quick-replies.test.mjs'], { cwd: fixture, env: { ...process.env, TASKFLOW_TEST_PLUGIN: plugin, TASKFLOW_TEST_RPC: join(fixture, 'node_modules', pkg.name, 'src/server/rpc.mjs') }, maxBuffer: 8 * 1024 * 1024, timeout: 60000 });
    const slotsPath = createRequire(join(fixture, 'package.json')).resolve('@deepseek-ai/dsh-client-ui-slots');
    const { stdout: clientOutput } = await run(process.execPath, ['--test', 'test/execution-record.test.mjs'], { cwd: root, env: { ...process.env, TASKFLOW_TEST_SLOTS: pathToFileURL(slotsPath).href, TASKFLOW_TEST_CLIENT: join(fixture, 'node_modules', pkg.name, 'client.js') }, maxBuffer: 8 * 1024 * 1024, timeout: 60000 });
    results.push({ version, passed: true, dependencies, output: stdout, clientOutput });
    console.log(`Host ${version}: passed`);
  } catch (error) {
    results.push({ version, passed: false, output: `${error.message}\n${error.stdout ?? ''}\n${error.stderr ?? ''}` });
    console.log(`Host ${version}: failed; see dist/host-report.json`);
  } finally {
    const rel = relative(resolve(tmpdir()), fixture);
    assert.ok(rel.startsWith('dsh-taskflow-host-') && !rel.startsWith('..') && !isAbsolute(rel), 'Refusing to clean an unrelated directory');
    await rm(fixture, { recursive: true, force: true });
  }
}
await mkdir(join(root, 'dist'), { recursive: true });
await writeFile('dist/host-report.json', JSON.stringify({ pluginVersion: pkg.version, declaredRange: pkg.engines.dsh, archiveSha256, scope: 'Packed server plugin with exact host dependencies and deterministic AgentLoop model, real authenticated Connection HTTP RPC, and execution-record JSDOM rendering with exact native SlotCore; excludes full UI and production providers', results }, null, 2) + '\n');
if (results.some(result => !result.passed)) process.exitCode = 1;
