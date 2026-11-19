import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFile(join(root, path), 'utf8');
const json = async path => JSON.parse(await read(path));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pkg = await json('package.json');
const manifest = await json('qoder/.qoder-plugin/plugin.json');
const lock = await json('package-lock.json');
assert.equal(pkg.name, 'qoder-taskflow');
assert.equal(manifest.name, pkg.name);
assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
assert.equal(pkg.version, manifest.version);
assert.equal(lock.name, pkg.name);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[''].name, pkg.name);
assert.equal(lock.packages[''].version, pkg.version);
assert.equal(pkg.private, true, 'Development package must not publish to npm');
assert.deepEqual(Object.keys(pkg.engines), ['node']);
assert.equal(pkg.main, undefined);
assert.equal(pkg.peerDependencies, undefined);
assert.equal(pkg.publishConfig, undefined);
assert.equal(manifest.repository, 'https://github.com/Oak-liuhj/qoder-taskflow');
assert.equal(pkg.repository.url, 'git+' + manifest.repository + '.git');
assert.equal(manifest.homepage, pkg.homepage);
assert.equal(manifest.license, pkg.license);
const dependencies = ['@modelcontextprotocol/ext-apps', '@modelcontextprotocol/sdk', 'esbuild', 'fflate', 'jsdom', 'marked', 'react', 'react-dom'];
assert.deepEqual(Object.keys(pkg.devDependencies).sort(), dependencies.sort());

const report = await json('dist/qoder-package-report.json');
assert.equal(report.version, pkg.version);
assert.equal(report.name, pkg.name);
assert.equal(report.archive.replaceAll('\\', '/'), `dist/qoder-taskflow-${pkg.version}.zip`);
const archive = await readFile(join(root, report.archive));
assert.equal(archive.length, report.bytes);
assert.equal(sha256(archive), report.sha256);
assert.equal(await read('dist/SHA256SUMS.txt'), `${report.sha256}  qoder-taskflow-${pkg.version}.zip\n`);
const entries = unzipSync(archive);
const required = [
  '.qoder-plugin/plugin.json', '.mcp.json', 'hooks/hooks.json',
  'skills/taskflow/SKILL.md', 'agents/taskflow-worker.md',
  'commands/taskflow.md', 'commands/taskflow-status.md',
  'runtime/server.cjs', 'runtime/hook.cjs', 'runtime/panel.html',
  'assets/icon.png', 'README.md', 'README_en.md', 'CHANGELOG.md',
  'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.txt',
].sort();
assert.deepEqual(Object.keys(entries).sort(), required, 'Archive must contain only runtime distribution files');
assert.deepEqual(report.files.map(f => f.path).sort(), required);
assert.deepEqual(JSON.parse(Buffer.from(entries['.qoder-plugin/plugin.json']).toString()), manifest);
for (const file of report.files) {
  assert.equal(entries[file.path].length, file.bytes, file.path);
  assert.equal(sha256(entries[file.path]), file.sha256, file.path);
  assert.equal(sha256(await readFile(join(root, 'dist/qoder-taskflow', file.path))), file.sha256, `Directory mismatch: ${file.path}`);
}
async function inventory(folder, prefix = '') {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = prefix + entry.name;
    assert.ok(!entry.isSymbolicLink(), `Unexpected symlink: ${path}`);
    if (entry.isDirectory()) files.push(...await inventory(join(folder, entry.name), path + '/'));
    else files.push(path);
  }
  return files;
}
assert.deepEqual((await inventory(join(root, 'dist/qoder-taskflow'))).sort(), required, 'Stale files in directory distribution');
for (const path of ['skills', 'commands', 'hooks', 'mcpServers']) {
  const declared = manifest[path].replace(/^\.\//, '');
  assert.ok(required.some(file => file === declared || file.startsWith(declared)), `Missing manifest component ${path}`);
}
for (const agent of manifest.agents) {
  assert.match(agent, /\.md$/);
  assert.ok(required.includes(agent.replace(/^\.\//, '')));
}
const notices = Buffer.from(entries['THIRD_PARTY_NOTICES.txt']).toString();
for (const name of ['@modelcontextprotocol/sdk', '@modelcontextprotocol/ext-apps', 'react', 'react-dom', 'marked']) {
  assert.ok(report.thirdPartyPackages.some(id => id.startsWith(name + '@')), `Missing bundled package: ${name}`);
  assert.ok(notices.includes(name + '@'), `Missing notice: ${name}`);
}
for (const path of ['README.md', 'README_en.md', 'CHANGELOG.md']) assert.ok(Buffer.from(entries[path]).toString().includes(pkg.version));
const result = {
  name: pkg.name, version: pkg.version, archive: report.archive, sha256: report.sha256,
  files: required.length, thirdPartyPackages: report.thirdPartyPackages,
  checks: ['stable-version-consistency', 'qoder-only-dependencies', 'manifest-components', 'archive-allowlist', 'directory-parity', 'file-hashes', 'third-party-licenses'],
  status: 'passed',
};
await writeFile(join(root, 'dist/qoder-release-validation.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`Qoder ${pkg.version}: release checks passed (${required.length} files, SHA256 ${report.sha256})`);
