import { test, expect } from '@playwright/test';
import { pixelsPerSecond, closeMobilePanel } from './workspace-helpers';

test('directive: native media drop preserves frame positions across three zooms and horizontal scroll', async ({
  page,
}) => {
  await page.goto('/');
  const fixtures = await page.evaluate(async () => {
    const url = '/tests/fixtures.browser.ts';
    return (await import(/* @vite-ignore */ url)).makeFixtures();
  });
  await page.getByLabel('미디어 파일 선택').setInputFiles(
    fixtures.map((f: { name: string; mimeType: string; bytes: number[] }) => ({
      name: f.name,
      mimeType: f.mimeType,
      buffer: Buffer.from(f.bytes),
    })),
  );
  await expect(page.locator('.import-progress')).toHaveCount(0);
  const records = [];
  for (const [range, name, row, time] of [
    ['15', 'first.mp4', 1, 0.5],
    ['5', 'overlay.png', 0, 2],
    ['1', 'music.wav', 3, 6.5],
  ] as const) {
    await page.getByLabel('타임라인 표시 범위').filter({ visible: true }).selectOption(range);
    const scale = await pixelsPerSecond(page),
      scroll = page.locator('.timeline-scroll');
    await scroll.evaluate(
      (el, left) => {
        el.scrollLeft = left;
      },
      Math.max(0, (time - 0.5) * scale),
    );
    const asset = page
      .locator('.asset-card')
      .filter({ has: page.getByRole('button', { name: `${name} 타임라인에 추가`, exact: true }) });
    const lane = page.locator('.track-lane').nth(row);
    await lane.scrollIntoViewIfNeeded();
    await scroll.evaluate(
      (el, left) => {
        el.scrollLeft = left;
      },
      Math.max(0, (time - 0.5) * scale),
    );
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await asset.dispatchEvent('dragstart', { dataTransfer: dt });
    const id = await dt.evaluate((dt) => dt.getData('application/cyancut-asset'));
    const box = (await lane.boundingBox())!;
    await lane.dispatchEvent('dragover', {
      dataTransfer: dt,
      clientX: box.x + time * scale,
      clientY: box.y + box.height / 2,
    });
    await lane.dispatchEvent('drop', {
      dataTransfer: dt,
      clientX: box.x + time * scale,
      clientY: box.y + box.height / 2,
    });
    await dt.dispose();
    await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
    const p = await page.evaluate(async () => {
      const url = '/src/storage.ts';
      return (await import(/* @vite-ignore */ url)).restoreProject();
    });
    const c =
      p.clips.find(
        (c: { assetId: string; kind: string }) => c.assetId === id && c.kind !== 'audio',
      ) ?? p.clips.find((c: { assetId: string }) => c.assetId === id);
    expect(c).toBeTruthy();
    expect(Math.abs(c.start - time * 1e6)).toBeLessThanOrEqual(1e6 / 30);
    records.push({ range, name, start: c.start });
  }
  expect(records).toHaveLength(3);
});

test('directive: phone touch drag uses the dedicated handle without duplicating linked clips', async ({
  browser,
}) => {
  const context = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    }),
    page = await context.newPage();
  try {
    await page.goto('/');
    await page.locator('.mobile-dock').getByRole('button', { name: '미디어', exact: true }).tap();
    const sample = await page.evaluate(async () => {
      const url = '/tests/fixtures.browser.ts';
      return (await (await import(/* @vite-ignore */ url)).makeFixtures())[0];
    });
    await page.getByLabel('미디어 파일 선택').setInputFiles({
      name: sample.name,
      mimeType: sample.mimeType,
      buffer: Buffer.from(sample.bytes),
    });
    await expect(page.locator('.import-progress')).toHaveCount(0);
    const handle = page.getByRole('button', {
      name: 'first.mp4 끌어서 배치 · Enter는 재생헤드에 추가',
      exact: true,
    });
    await handle.scrollIntoViewIfNeeded();
    const a = (await handle.boundingBox())!,
      b = (await page.locator('.track-lane').first().boundingBox())!;
    const session = await context.newCDPSession(page);
    try {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: a.x + a.width / 2, y: a.y + a.height / 2, id: 1 }],
      });
      for (let i = 1; i <= 15; i++) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            {
              x: a.x + a.width / 2 + ((b.x + 45 - a.x - a.width / 2) * i) / 15,
              y: a.y + a.height / 2 + ((b.y + b.height / 2 - a.y - a.height / 2) * i) / 15,
              id: 1,
            },
          ],
        });
        await page.evaluate(() => new Promise(requestAnimationFrame));
      }
      await expect(page.locator('.drop-ghost')).toHaveCount(1);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await session.detach();
    }
    await expect(page.locator('.timeline-clip.video')).toHaveCount(1);
    await expect(page.locator('.timeline-clip.audio')).toHaveCount(1);
    await closeMobilePanel(page);
    await page.getByRole('button', { name: '실행 취소 (Ctrl/Cmd+Z)', exact: true }).tap();
    await expect(page.locator('.timeline-clip')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
