import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'qoder'), out = join(root, 'dist', 'qoder-taskflow');
const manifest = JSON.parse(await readFile(join(source, '.qoder-plugin/plugin.json'), 'utf8'));
// Regenerate this build-owned directory so directory installs match the ZIP.
if (resolve(out) !== resolve(root, 'dist', 'qoder-taskflow')) throw new Error('Invalid output directory');
await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'runtime'), { recursive: true });
const files = new Map();
async function save(path, bytes) { const data = typeof bytes === 'string' ? Buffer.from(bytes) : bytes; files.set(path, data); await mkdir(dirname(join(out, path)), { recursive: true }); await writeFile(join(out, path), data); }
async function copyTree(folder) {
  for (const entry of await readdir(join(source, folder), { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await copyTree(path);
    else if (entry.isFile()) await save(path.replaceAll('\\', '/'), await readFile(join(source, path)));
  }
}
for (const folder of ['.qoder-plugin', 'skills', 'agents', 'commands', 'hooks']) await copyTree(folder);
for (const name of ['.mcp.json', 'README.md']) await save(name, await readFile(join(source, name)));
for (const name of ['LICENSE', 'NOTICE', 'README_en.md', 'CHANGELOG.md']) await save(name, await readFile(join(root, name)));
await save('assets/icon.png', await readFile(join(root, 'assets/icon.png')));
const notices = new Map();
async function collectLicenses(meta) {
  for (const input of Object.keys(meta.inputs)) {
    if (!input.includes('node_modules/')) continue;
    let dir = dirname(resolve(root, input));
    while (dir.startsWith(root) && dir !== root) {
      try {
        const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
        if (!pkg.name || !pkg.version) { dir = dirname(dir); continue; }
        const id = `${pkg.name}@${pkg.version}`;
        if (!notices.has(id)) {
          const names = (await readdir(dir)).filter(n => /^(licen[sc]e|copying|notice)(\.|$)/i.test(n));
          if (!names.length && !pkg.license) throw new Error(`Missing license: ${id}`);
          notices.set(id, `${id} (${pkg.license || 'see license'})\n${(await Promise.all(names.map(n => readFile(join(dir, n), 'utf8')))).join('\n')}`);
        }
        break;
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
      dir = dirname(dir);
    }
  }
}
for (const entry of ['server', 'hook']) {
  const bundle = await build({ absWorkingDir: root, entryPoints: [`src/qoder/${entry}.mjs`], platform: 'node', target: 'node24', format: 'cjs', bundle: true, minify: true, write: false, metafile: true, legalComments: 'inline' });
  await save(`runtime/${entry}.cjs`, bundle.outputFiles[0].contents); await collectLicenses(bundle.metafile);
}
const panel = await build({ absWorkingDir: root, entryPoints: ['src/qoder/panel.jsx'], outfile: 'panel.js', platform: 'browser', target: 'es2022', format: 'iife', bundle: true, minify: true, write: false, metafile: true, charset: 'utf8', legalComments: 'inline', define: { 'process.env.NODE_ENV': '"production"' } });
await collectLicenses(panel.metafile);
const js = panel.outputFiles.find(f => f.path.endsWith('.js')).text.replaceAll('</script', '<\\/script');
const css = panel.outputFiles.find(f => f.path.endsWith('.css')).text;
await save('runtime/panel.html', `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Taskflow</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`);
await save('THIRD_PARTY_NOTICES.txt', [...notices].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v).join('\n\n'));
const zip = zipSync(Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, data]) => [path, [data, { mtime: new Date('1980-01-01T00:00:00Z') }]])), { level: 9 });
const zipPath = join(root, 'dist', `qoder-taskflow-${manifest.version}.zip`);
await writeFile(zipPath, zip);
const report = { name: manifest.name, version: manifest.version, archive: relative(root, zipPath), sha256: createHash('sha256').update(zip).digest('hex'), bytes: zip.length, files: [...files].map(([path, data]) => ({ path, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') })), thirdPartyPackages: [...notices.keys()].sort() };
await writeFile(join(root, 'dist/qoder-package-report.json'), JSON.stringify(report, null, 2));
await writeFile(join(root, 'dist/SHA256SUMS.txt'), `${report.sha256}  qoder-taskflow-${manifest.version}.zip\n`);
console.log(`Built ${report.archive}: ${files.size} files, ${zip.length} bytes, SHA256 ${report.sha256}`);
