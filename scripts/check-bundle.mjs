import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root = path.resolve('dist');
const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
const files = await fs.readdir(path.join(root, 'assets'));
const visited = new Set();
async function initialJs(file) {
  const resolved = path.resolve(root, file.replace(/^\//, ''));
  if (!resolved.startsWith(root + path.sep)) throw new Error('Asset outside dist');
  if (visited.has(resolved)) return 0;
  visited.add(resolved);
  const bytes = await fs.readFile(resolved);
  let gzip = gzipSync(bytes).byteLength;
  for (const match of bytes.toString().matchAll(/(?:\bfrom\s*|\bimport\s*)["'](\.[^"']+\.js)["']/g))
    gzip += await initialJs(path.relative(root, path.resolve(path.dirname(resolved), match[1])));
  return gzip;
}
let initialJsGzip = 0;
for (const match of html.matchAll(/<(?:script|link)[^>]+(?:src|href)=["']([^"']+\.js)["']/g))
  initialJsGzip += await initialJs(match[1]);
const groups = {};
for (const name of files) {
  const bytes = await fs.readFile(path.join(root, 'assets', name));
  const group = /^engine\.worker-.*\.js$/.test(name)
    ? 'startupWorker'
    : /^mediabunny-.*encoder-.*\.js$/.test(name)
      ? 'encoderJsWithEmbeddedWasm'
      : /\.js$/.test(name)
        ? 'js'
        : /\.css$/.test(name)
          ? 'css'
          : /\.(woff2?|ttf|otf)$/.test(name)
            ? 'font'
            : /\.wasm$/.test(name)
              ? 'standaloneWasm'
              : 'other';
  const summary = (groups[group] ??= { files: 0, rawBytes: 0, gzipBytes: 0 });
  summary.files++;
  summary.rawBytes += bytes.byteLength;
  summary.gzipBytes += gzipSync(bytes).byteLength;
}
const metrics = {
  initialJsGzip,
  startupWorkerGzip: groups.startupWorker?.gzipBytes ?? 0,
  encoderJsGzip: groups.encoderJsWithEmbeddedWasm?.gzipBytes ?? 0,
  cssGzip: groups.css?.gzipBytes ?? 0,
  fontRaw: groups.font?.rawBytes ?? 0,
};
const report = {
  metrics,
  groups,
  scope:
    'Build bytes, gzip level 6; not Brotli or actual network transfer. Startup worker is budgeted separately. Encoder WASM is embedded in JS.',
};
await fs.mkdir('artifacts', { recursive: true });
await fs.writeFile('artifacts/bundle-report.json', JSON.stringify(report, null, 2));
const budgetPath = process.env.BUNDLE_BUDGET ?? 'scripts/bundle-budget.json';
if (process.argv.includes('--baseline')) {
  await fs.writeFile(
    budgetPath,
    JSON.stringify(
      {
        baseline: metrics,
        max: Object.fromEntries(
          Object.entries(metrics).map(([key, value]) => [key, Math.ceil(value * 1.1)]),
        ),
      },
      null,
      2,
    ) + '\n',
  );
} else {
  const { max } = JSON.parse(await fs.readFile(budgetPath, 'utf8'));
  for (const [key, value] of Object.entries(metrics)) {
    if (!Number.isFinite(max[key]) || value > max[key]) {
      console.error(`${key}: ${value} exceeds ${max[key]}`);
      process.exitCode = 1;
    }
  }
}
console.log(JSON.stringify(report));
