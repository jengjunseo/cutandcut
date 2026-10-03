import { History } from '../src/history.ts';
import fs from 'node:fs';
const project = {
  version: 1,
  id: 'benchmark',
  name: 'a',
  width: 1280,
  height: 720,
  fps: 30,
  background: '#111',
  tracks: [],
  clips: [],
  assets: Array.from({ length: 64 }, (_, i) => ({ id: String(i), thumbnail: 'a'.repeat(16000) })),
};
const iterations = 200;
let at = performance.now();
for (let i = 0; i < iterations; i++) {
  const next = { ...project, name: 'edit ' + i };
  if (JSON.stringify(project) === JSON.stringify(next)) throw new Error('Unexpected equality');
}
const serializationMs = performance.now() - at;
at = performance.now();
const history = new History();
for (let i = 0; i < iterations; i++) history.commit(project, { ...project, name: 'edit ' + i });
const result = {
  runtime: process.version,
  assets: 64,
  thumbnailCharacters: 16000,
  iterations,
  serializationMs,
  branchComparisonMs: performance.now() - at,
  oldCapabilityPayloadBytes: JSON.stringify(project).length,
  newCapabilityPayloadBytes: JSON.stringify({
    width: project.width,
    height: project.height,
    fps: project.fps,
  }).length,
  scope:
    'Synthetic shared-asset History equality and capability payload only; not complete editor latency',
};
fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync('artifacts/history-performance.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
