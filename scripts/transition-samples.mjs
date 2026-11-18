import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage();
  await page.route('**/transition-helper', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Generated transition samples</title>',
    }),
  );
  await page.goto('http://localhost:5174/transition-helper');
  const records = [];
  for (const kind of ['dissolve', 'black', 'slide', 'wipe']) {
    const result = await page.evaluate(async (kind) => {
      const { makeFixtures } = await import('/tests/fixtures.browser.ts'),
        { encodeProject, verifyFile } = await import('/tests/directive-media.browser.ts'),
        { emptyProject, clipDefaults, tick } = await import('/src/model.ts'),
        { setTransitionV2 } = await import('/src/transitions.ts'),
        { inspect } = await import('/src/engine.ts');
      const sources = [];
      for (const f of (await makeFixtures()).slice(0, 2)) {
        const file = new File([new Uint8Array(f.bytes)], f.name, { type: f.mimeType }),
          asset = await inspect(file);
        sources.push({ id: asset.id, file, asset });
      }
      const p = emptyProject();
      p.width = 1280;
      p.height = 720;
      p.assets = sources.map((s) => s.asset);
      p.clips = sources.map((s, i) => ({
        ...clipDefaults(),
        id: `v${i}`,
        name: `v${i}`,
        kind: 'video',
        assetId: s.id,
        trackId: p.tracks[1].id,
        start: tick(i),
        duration: tick(1),
        sourceIn: tick(0.25),
      }));
      const q = setTransitionV2(p, 'v1', kind, tick(0.4)).project,
        bytes = await encodeProject(q, sources);
      return {
        bytes: Array.from(new Uint8Array(bytes)),
        verification: await verifyFile(new File([bytes], kind + '.mp4'), [0.8, 0.9, 1, 1.1, 1.2]),
      };
    }, kind);
    await fs.writeFile(`artifacts/directive-transition-${kind}.mp4`, new Uint8Array(result.bytes));
    records.push({ kind, bytes: result.bytes.length, ...result.verification });
  }
  await fs.writeFile(
    'artifacts/directive-transition-samples.json',
    JSON.stringify(records, null, 2),
  );
} finally {
  await browser.close();
}
