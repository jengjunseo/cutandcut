import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
const phase = process.env.BENCH_PHASE ?? 'before',
  base = process.env.BENCH_URL ?? 'http://localhost:5175';
const dir =
  process.env.BENCH_BUILD ?? (phase === 'before' ? 'artifacts/directive-baseline-dist' : 'dist');
const worker = (await fs.readdir(`${dir}/assets`)).find((f) => /^engine\.worker-.*\.js$/.test(f));
const browser = await chromium.launch({ channel: 'chrome' });
try {
  await fs.mkdir('artifacts/directive-inputs', { recursive: true });
  const helper = await browser.newPage();
  await helper.route('**/bench-helper', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Local media benchmark</title>',
    }),
  );
  await helper.goto('http://localhost:5174/bench-helper');
  if (!(await fs.readdir('artifacts/directive-inputs')).includes('synthetic-1080-60.mp4')) {
    const fixture = await helper.evaluate(async () =>
      (await import('/tests/directive-bench.browser.ts')).directiveFixtures(),
    );
    for (const f of fixture)
      await fs.writeFile(`artifacts/directive-inputs/${f.name}`, new Uint8Array(f.bytes));
  }
  const sources = [];
  for (const name of ['synthetic-1080-30.mp4', 'synthetic-1080-60.mp4', 'overlay.png']) {
    const bytes = Array.from(await fs.readFile(`artifacts/directive-inputs/${name}`));
    const asset = await helper.evaluate(
      async ({ name, bytes }) => {
        const { inspect } = await import('/src/engine.ts');
        return inspect(new File([new Uint8Array(bytes)], name));
      },
      { name, bytes },
    );
    sources.push({ asset, bytes, name });
  }
  const page = await browser.newPage();
  await page.goto(base);
  const records = [];
  for (const scenario of process.env.BENCH_V2 === '1' ? ['B2-v2'] : ['B1', 'B2', 'B3', 'B4']) {
    const project = await helper.evaluate(
      async ({ scenario, assets }) =>
        scenario === 'B2-v2'
          ? (await import('/tests/directive-bench.browser.ts')).directiveProjectV2(assets)
          : (await import('/tests/directive-bench.browser.ts')).directiveProject(scenario, assets),
      { scenario, assets: sources.map((s) => s.asset) },
    );
    for (let run = 0; run < 4; run++) {
      const record = await page.evaluate(
        async ({ project, sources, worker, run }) => {
          const w = (window.__benchWorker ??= new Worker(`/assets/${worker}`, { type: 'module' }));
          for (const s of sources)
            w.postMessage({
              type: 'file',
              id: s.asset.id,
              file: new File([new Uint8Array(s.bytes)], s.name),
            });
          return new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error('No output progress for 120s')),
              120000,
            );
            let progressTimer = timer;
            w.onmessage = async (e) => {
              const d = e.data;
              if (d.type === 'progress') {
                clearTimeout(progressTimer);
                progressTimer = setTimeout(() => reject(new Error('Stalled')), 120000);
              }
              if (d.type === 'error') {
                clearTimeout(progressTimer);
                reject(new Error(d.error));
              }
              if (d.type === 'complete') {
                clearTimeout(progressTimer);
                const blob = d.file ?? new Blob([d.buffer], { type: 'video/mp4' });
                window.__benchBlob = blob;
                resolve({
                  run,
                  cold: run === 0,
                  bytes: blob.size,
                  metrics: d.metrics,
                  revision: project.editRevision ?? 0,
                });
              }
            };
            w.postMessage({ type: 'export', project, format: 'mp4', bitrate: 8e6, profile: true });
          });
        },
        { project, sources, worker, run },
      );
      records.push({ scenario, ...record });
      console.log(
        JSON.stringify({
          phase,
          scenario,
          run,
          seconds: record.metrics?.wallMs / 1000,
          bytes: record.bytes,
        }),
      );
      await fs.writeFile(
        `artifacts/directive-bench-${phase}.json`,
        JSON.stringify(
          {
            phase,
            scope:
              process.env.BENCH_V2 === '1'
                ? 'Synthetic SDR moving blocks and tone; B2-v2 with dissolve, dip-black, slide and wipe. Candidate-only, no legacy speed comparison.'
                : 'Synthetic SDR moving blocks and tone. B2 uses four legacy transition boundaries for identical before/after comparison; not real game/camera footage.',
            userAgent: await page.evaluate(() => navigator.userAgent),
            cpu: os.cpus()[0]?.model,
            memoryBytes: os.totalmem(),
            memoryMeasurement: 'No cross-process peak memory metric; not fabricated.',
            records,
          },
          null,
          2,
        ),
      );
      if (run === 3 && phase.startsWith('after')) {
        const downloading = page.waitForEvent('download');
        await page.evaluate(() => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(window.__benchBlob);
          a.download = 'benchmark.mp4';
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 30000);
        });
        const path = `artifacts/directive-${scenario}.mp4`;
        await (await downloading).saveAs(path);
        await helper.evaluate(() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.id = 'verify-output';
          document.body.replaceChildren(input);
        });
        await helper.locator('#verify-output').setInputFiles(path);
        const verification = await helper.evaluate(
          async ({ length }) => {
            const url = '/tests/directive-media.browser.ts';
            const file = document.querySelector('#verify-output').files[0];
            return (await import(url)).verifyFile(file, [0.5, length / 2 + 0.1, length - 0.2]);
          },
          { length: scenario === 'B3' ? 300 : 60 },
        );
        await fs.writeFile(
          `artifacts/directive-${scenario}-verification.json`,
          JSON.stringify(verification, null, 2),
        );
      }
    }
  }
} finally {
  await browser.close();
}
