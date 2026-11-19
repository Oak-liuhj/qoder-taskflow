import { readFile } from 'node:fs/promises';
import { resolve, posix } from 'node:path';

// Resolve this client from explicit source files. No ancestor-directory scan is
// needed: local modules, one bundled Markdown lexer, and host React.
export function clientSource(root = process.env.TASKFLOW_BUILD_SOURCE || process.cwd()) {
  return {
    name: 'taskflow-source',
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (args.path === 'marked') return { path: 'node_modules/marked/lib/marked.esm.js', namespace: 'taskflow-vendor' };
        if (args.kind !== 'entry-point' && !args.path.startsWith('.')) {
          if (!['react', 'react-dom'].includes(args.path)) throw new Error(`Unexpected client dependency: ${args.path}`);
          return { path: args.path, external: true };
        }
        const path = posix.normalize(posix.join(args.importer ? posix.dirname(args.importer) : '', args.path));
        if (!path.startsWith('src/client/')) throw new Error(`Unexpected client source: ${path}`);
        return { path, namespace: 'taskflow-source' };
      });
      build.onLoad({ filter: /.*/, namespace: 'taskflow-vendor' }, async ({ path }) => ({ contents: await readFile(resolve(root, path), 'utf8'), loader: 'js' }));
      build.onLoad({ filter: /.*/, namespace: 'taskflow-source' }, async ({ path }) => ({
        contents: (await readFile(resolve(root, path), 'utf8')).replaceAll('\r\n', '\n'),
        loader: path.endsWith('.css') ? 'text' : path.endsWith('.jsx') ? 'jsx' : 'js',
      }));
    },
  };
}
