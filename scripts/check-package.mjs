import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { allowedFile, checkRuntime } from './check-release.mjs';

const run = promisify(execFile), root = process.cwd(), npmCli = process.env.npm_execpath;
assert.ok(npmCli,'Run this check with npm run check:package');
const npm = (args,cwd=root) => run(process.execPath,[npmCli,...args],{cwd,maxBuffer:8*1024*1024,timeout:180000});
await mkdir('dist',{recursive:true}); await mkdir('.local/npm-cache',{recursive:true});
const cache = resolve('.local/npm-cache');
const packed = await npm(['pack','--ignore-scripts','--json','--pack-destination','dist','--cache',cache]);
const [manifest] = JSON.parse(packed.stdout), pkg = JSON.parse(await readFile('package.json','utf8'));
for (const {path} of manifest.files) assert.ok(allowedFile(path,pkg.files),`Unexpected packed file: ${path}`);
assert.ok(manifest.size < 128*1024,'Packed package exceeds 128 KiB');
assert.ok(manifest.unpackedSize < 512*1024,'Unpacked package exceeds 512 KiB');
const archive = resolve('dist',manifest.filename), bytes = await readFile(archive), hash = createHash('sha256').update(bytes).digest('hex');
// Install the actual archive outside the checkout: upward resolution cannot hide a missing dependency.
const temporary = await mkdtemp(join(tmpdir(),'dsh-taskflow-package-'));
let installMode = 'offline';
try {
  await writeFile(join(temporary,'package.json'),JSON.stringify({name:'taskflow-package-consumer',version:'1.0.0',private:true,type:'module'}));
  const args=['install',archive,'--ignore-scripts','--omit=dev','--no-audit','--no-fund','--package-lock=false','--cache',cache];
  try { await npm([...args,'--offline'],temporary); }
  catch (error) { if(!/ENOTCACHED|cache mode is 'only-if-cached'/i.test(error.stderr ?? '')) throw error; installMode='registry'; await npm(args,temporary); }
  const installed = join(temporary,'node_modules',pkg.name);
  for(const [name] of Object.entries(pkg.peerDependencies).filter(([name])=>!pkg.peerDependenciesMeta?.[name]?.optional)) await stat(join(temporary,'node_modules',name,'package.json'));
  await assert.rejects(stat(join(installed,'src/client')));
  await assert.rejects(stat(join(installed,'docs/prototype')));
  await assert.rejects(stat(join(installed,'scripts')));
  await assert.rejects(stat(join(temporary,'node_modules/esbuild')));
  const runtime = await checkRuntime(installed);
  await run(process.execPath,['--test','test/host.test.mjs'],{cwd:root,env:{...process.env,TASKFLOW_TEST_PLUGIN:join(installed,'index.js')},maxBuffer:8*1024*1024,timeout:60000});
  const report={...runtime,archive:relative(root,archive).replaceAll('\\','/'),sha256:hash,size:manifest.size,unpackedSize:manifest.unpackedSize,files:manifest.files.map(f=>f.path),productionInstall:true,packedAgentLoop:true,installMode};
  await writeFile('dist/package-report.json',JSON.stringify(report,null,2)+'\n');
  await writeFile('dist/SHA256SUMS.txt',`${hash}  ${manifest.filename}\n`);
  console.log(JSON.stringify({...report,files:report.files.length},null,2));
} finally {
  const base = resolve(tmpdir()), rel=relative(base,temporary);
  assert.ok(rel.startsWith('dsh-taskflow-package-')&&!rel.startsWith('..')&&!isAbsolute(rel),'Refusing to clean an unrelated path');
  await rm(temporary,{recursive:true,force:true});
}
