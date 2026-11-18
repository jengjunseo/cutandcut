import fs from 'node:fs/promises';
const before = JSON.parse(await fs.readFile('artifacts/directive-bench-before.json', 'utf8'));
const after = JSON.parse(await fs.readFile('artifacts/directive-bench-after.json', 'utf8'));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const records = ['B1', 'B2', 'B3', 'B4'].map((scenario) => {
  const a = before.records.filter((r) => r.scenario === scenario),
    b = after.records.filter((r) => r.scenario === scenario);
  const summary = (rows) => ({
    firstMs: rows[0].metrics.wallMs,
    warmMs: rows.slice(1).map((r) => r.metrics.wallMs),
    medianMs: median(rows.slice(1).map((r) => r.metrics.wallMs)),
    bytes: rows[0].bytes,
    peakVideoQueue: Math.max(...rows.map((r) => r.metrics.peakVideoQueue)),
    encodedPackets: rows[0].metrics.encodedVideoPackets,
    stagesMedianMs: Object.fromEntries(
      Object.keys(rows[0].metrics.stagesMs).map((k) => [
        k,
        median(rows.slice(1).map((r) => r.metrics.stagesMs[k])),
      ]),
    ),
  });
  const x = summary(a),
    y = summary(b);
  return {
    scenario,
    before: x,
    after: y,
    improvementPercent: (100 * (x.medianMs - y.medianMs)) / x.medianMs,
    effectiveFps: y.encodedPackets / (y.medianMs / 1000),
    sameByteCounts: a.every((r, i) => r.bytes === b[i].bytes),
  };
});
const report = {
  date: '2026-11-18–19 (Asia/Seoul)',
  userAgent: after.userAgent,
  cpu: after.cpu,
  memoryBytes: after.memoryBytes,
  scope: after.scope,
  caveats: [
    'One worker reused across benchmark runs; first scenario is not a fresh browser/module startup each time.',
    'Stages overlap: render includes decode; encode may include backpressure/mux work. Do not sum stage times.',
    'B2 keeps legacy boundaries identical before/after. New v2 transitions have separate decoded-frame tests.',
    'B4 is synthetic moving geometry, not supplied game/camera footage.',
    'No cross-process peak memory or verified hardware encoder measurement.',
    'sameByteCounts compares sizes only. The audio packet-boundary fix can change encoded bytes; bitrate, resolution and FPS settings stay the same.',
  ],
  records,
};
await fs.mkdir('docs/results', { recursive: true });
await fs.writeFile('docs/results/directive-benchmark.json', JSON.stringify(report, null, 2) + '\n');
console.log(
  records.map((r) => ({
    scenario: r.scenario,
    before: r.before.medianMs,
    after: r.after.medianMs,
    improvement: r.improvementPercent,
    fps: r.effectiveFps,
  })),
);
