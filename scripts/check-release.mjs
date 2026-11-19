import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Script, createContext } from 'node:vm';
import { parse } from 'yaml';
import semver from 'semver';

export const SUPPORTED_DSH_RANGE = '>=0.2.1-rc.3 <1.0.0-0 || >=0.2.2-0 <1.0.0-0 || >=0.2.3-0 <1.0.0-0 || >=0.3.0-0 <1.0.0-0';
export const HOST_BOUNDARIES = [['0.2.1-rc.2',false],['0.2.1-rc.3',true],['0.2.1',true],['0.2.2-0',true],['0.2.2-rc.2',true],['0.2.3-0',true],['0.3.0-0',true],['0.9.9',true],['1.0.0-0',false],['1.0.0-alpha.1',false],['1.0.0',false],['2.0.0',false]];

const project = fileURLToPath(new URL('../', import.meta.url));
const json = async path => JSON.parse(await readFile(path, 'utf8'));
export function allowedFile(path, files) {
  return path === 'package.json' || files.some(pattern => new RegExp('^' + pattern.split('*').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$').test(path));
}

/** Can run against the unpacked/installed package without the source checkout. */
export async function checkRuntime(root) {
  const pkg = await json(join(root, 'package.json'));
  assert.equal(pkg.name, 'dsh-taskflow'); assert.equal(pkg.type, 'module');
  assert.equal(pkg.main, 'index.js'); assert.equal(pkg.exports['.'], './index.js');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(pkg.engines.dsh, SUPPORTED_DSH_RANGE, 'Host declaration must match the release compatibility policy');
  assert.ok(semver.validRange(pkg.engines.dsh));
  for (const [version, expected] of HOST_BOUNDARIES) assert.equal(semver.satisfies(version, pkg.engines.dsh, { includePrerelease: true }), expected, `Host boundary: ${version}`);
  for (const name of ['@deepseek-ai/dsh-llm','@deepseek-ai/dsh-tools']) assert.equal(pkg.peerDependencies[name], SUPPORTED_DSH_RANGE, `Host peer must not remain pinned: ${name}`);
  assert.equal(pkg.peerDependencies['@deepseek-ai/cordis'], '~4.0.5 || ~4.1.0');
  assert.equal(pkg.peerDependencies['@deepseek-ai/schemastery'], '~3.18.5 || ~3.19.0');
  assert.equal(pkg.publishConfig.registry, 'https://registry.npmjs.org/');
  assert.equal(pkg.publishConfig.access, 'public');
  assert.equal(pkg.publishConfig.tag, pkg.version.includes('-') ? pkg.version.split('-')[1].split('.')[0] : 'latest');
  assert.equal(pkg.repository.url, 'git+https://github.com/Oak-liuhj/dsh-taskflow.git');
  assert.equal(pkg.homepage, 'https://github.com/Oak-liuhj/dsh-taskflow#readme');
  assert.equal(pkg.bugs.url, 'https://github.com/Oak-liuhj/dsh-taskflow/issues');
  for (const hook of ['prepare', 'install', 'postinstall', 'preinstall']) assert.ok(!pkg.scripts[hook], `Unexpected install hook: ${hook}`);
  const patch = parse(await readFile(join(root, 'cordis.patch.yml'), 'utf8'));
  assert.equal(patch[0].insert[0].name, pkg.name); assert.equal(patch[0].insert[0].id, 'taskflow');
  for (const [key,target] of Object.entries(pkg.exports)) {
    assert.equal(typeof target, 'string');
    assert.ok(target.startsWith('./') && !target.includes('..'), `Unsafe export: ${key}`);
    if (target.includes('*')) { for (const locale of ['en','zh']) await readFile(join(root,target.replace('*',locale))); }
    else await readFile(join(root,target));
  }
  for (const lang of ['en','zh']) { const locale = await json(join(root,`locale/${lang}.json`)); assert.ok(locale.meta.title && locale.meta.description); await readFile(join(root,locale.meta.detail)); }
  const icon = await readFile(join(root,pkg.icon));
  assert.equal(icon.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(icon.readUInt32BE(16),180); assert.equal(icon.readUInt32BE(20),180);
  for (const path of ['LICENSE','NOTICE','licenses/DeepSeek-MIT.txt','licenses/Montserrat-OFL.txt','CHANGELOG.md']) assert.ok((await readFile(join(root,path),'utf8')).trim().length > 100);
  const client = await readFile(join(root,'client.js'),'utf8');
  assert.match(client,/Copyright \(c\) 2026 DeepSeek/); assert.match(client,/Permission is hereby granted/);
  let registration;
  new Script(client,{filename:'client.js'}).runInContext(createContext({window:{__ModuleLoader__:{load: value => { assert.equal(registration,undefined); registration=value; }}}}));
  assert.equal(registration.id,pkg.name);
  const require = createRequire(import.meta.url), requested = new Set();
  const exports = registration.factory(id => { assert.ok(['react','react-dom'].includes(id), `Unexpected browser dependency: ${id}`); requested.add(id); return require(id); });
  assert.equal(typeof exports.apply,'function'); assert.ok(exports.inject.includes('sessions'));
  for (const id of requested) assert.ok(pkg.peerDependencies[id], `Undeclared client peer: ${id}`);
  const entry = await import(pathToFileURL(join(root,pkg.main)).href);
  assert.equal(entry.name,'taskflow'); assert.equal(typeof entry.apply,'function'); assert.ok(entry.Config); assert.ok(entry.inject.includes('subagents'));
  return { name:pkg.name,version:pkg.version,host:pkg.engines.dsh,hostBoundaryChecks:HOST_BOUNDARIES.length,clientDependencies:[...requested] };
}

export async function checkRelease(root = project) {
  const result = await checkRuntime(root), pkg = await json(join(root,'package.json'));
  assert.equal(pkg.license,'(Apache-2.0 AND MIT)');
  assert.ok(pkg.keywords.includes('dsh-plugin'));
  const runtimeImports = new Set();
  for (const folder of ['domain','application','storage','server']) {
    for (const file of await readdir(join(root,'src',folder))) {
      if (!file.endsWith('.mjs')) continue;
      const path = join(root,'src',folder,file), source = await readFile(path,'utf8');
      for (const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
        const id = match[1]; if(id.startsWith('node:')) continue;
        if(id.startsWith('.')) { await readFile(resolve(dirname(path),id)); continue; }
        const name = id.startsWith('@') ? id.split('/').slice(0,2).join('/') : id.split('/')[0];
        runtimeImports.add(name);
        assert.ok(pkg.dependencies?.[name] || (pkg.peerDependencies?.[name] && !pkg.peerDependenciesMeta?.[name]?.optional), `Runtime import cannot be dev-only or optional: ${name}`);
      }
    }
  }
  const market = parse(await readFile(join(root,'marketplace/Oak-liuhj__dsh-taskflow.yml'),'utf8'));
  assert.deepEqual(Object.keys(market).sort(),['url','name','category','description','icon'].sort());
  assert.equal(market.url,'https://github.com/Oak-liuhj/dsh-taskflow'); assert.equal(market.name,'Oak-liuhj/dsh-taskflow'); assert.equal(market.category,'workflow');
  assert.ok(market.description.en.endsWith('.') && market.description.zh.endsWith('。'));
  assert.equal(market.icon,'https://raw.githubusercontent.com/Oak-liuhj/dsh-taskflow/main/assets/icon.png');
  const screenshots = await json(join(root,'screenshots.json'));
  assert.ok(screenshots.length >= 1 && screenshots.length <= 8);
  for (const path of screenshots) {
    assert.match(path,/^docs\/screenshots\/[\w-]+\.png$/);
    const image = await readFile(join(root,path));
    assert.equal(image.subarray(0,8).toString('hex'),'89504e470d0a1a0a', `Screenshot must contain PNG data: ${path}`);
    assert.ok(image.length >= 24 && image.readUInt32BE(16) > 0 && image.readUInt32BE(20) > 0, `Screenshot dimensions: ${path}`);
  }
  const readme = await readFile(join(root,'README.md'),'utf8'); assert.ok(readme.includes(pkg.version)); assert.ok(readme.includes(pkg.engines.dsh), 'README must include the declared host range'); assert.doesNotMatch(readme,/file:\/\/\/|[A-Z]:\\|Users\/Administrator/);
  assert.ok(!pkg.files.some(p=>['src','docs','scripts','test','.local','docs/screenshots','docs/prototype'].includes(p.replace(/\/$/,''))), 'Runtime package must use an explicit allowlist');
  return { ...result, runtimeImports:[...runtimeImports],screenshots:screenshots.length };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log('Release metadata and runtime validated:',await checkRelease());
