import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import semver from 'semver';
import { SUPPORTED_DSH_RANGE, HOST_BOUNDARIES } from '../scripts/check-release.mjs';

test('正式版声明、锁文件、peer 与宿主版本边界保持一致', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, '0.1.4');
  assert.equal(semver.prerelease(pkg.version), null);
  assert.equal(pkg.publishConfig.tag, 'latest');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.deepEqual(lock.packages[''].engines, pkg.engines);
  assert.deepEqual(lock.packages[''].peerDependencies, pkg.peerDependencies);
  assert.equal(pkg.engines.dsh, SUPPORTED_DSH_RANGE);
  assert.ok(semver.subset(pkg.engines.dsh, '>=0.2.1-rc.3 <1.0.0-0', { includePrerelease: true }));
  assert.ok(semver.subset('>=0.2.1-rc.3 <1.0.0-0', pkg.engines.dsh, { includePrerelease: true }));
  for (const [version, expected] of HOST_BOUNDARIES) assert.equal(semver.satisfies(version, pkg.engines.dsh, { includePrerelease: true }), expected, version);
  for (const name of ['@deepseek-ai/dsh-llm','@deepseek-ai/dsh-tools']) assert.equal(pkg.peerDependencies[name], pkg.engines.dsh);
});
