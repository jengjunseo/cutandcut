import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
test('variable input PTS to fixed 24fps and keyboard focus', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '단축키 도움말 (?)', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '키보드 단축키' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '키보드 단축키' })).toHaveCount(0);
  await page.getByRole('separator', { name: '미디어 패널 너비' }).focus();
  await page.keyboard.press('ArrowRight');
  expect(
    await page
      .locator('.app')
      .evaluate((e) => (e as HTMLElement).style.getPropertyValue('--left-width')),
  ).toBe('290px');
  await expect(page.locator('.current-time')).toHaveValue('00:00:00:00');
  const fixture = await page.evaluate(async () => {
    const url = '/tests/fixtures.browser.ts';
    return (await import(/* @vite-ignore */ url)).makeVfrFixture();
  });
  await page.getByLabel('가져오면서 타임라인에 연속 배치').check();
  await page.getByLabel('미디어 파일 선택').setInputFiles({
    name: fixture.name,
    mimeType: fixture.mimeType,
    buffer: Buffer.from(fixture.bytes),
  });
  await expect(page.locator('.asset-card')).toHaveCount(1);
  await expect(page.locator('.import-progress')).toHaveCount(0);
  await page.getByRole('combobox', { name: '프레임레이트', exact: true }).selectOption('24');
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByText('내보내기가 완료됐습니다.')).toBeVisible();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 다운로드', exact: true }).click();
  await (await waiting).saveAs('artifacts/vfr-24fps.mp4');
  const result = await page.evaluate(
    async (bytes) => {
      const url = '/node_modules/mediabunny/dist/modules/src/index.js';
      const { Input, BufferSource, ALL_FORMATS, CanvasSink } = await import(/* @vite-ignore */ url);
      const input = new Input({
        source: new BufferSource(new Uint8Array(bytes)),
        formats: ALL_FORMATS,
      });
      try {
        const v = await input.getPrimaryVideoTrack(),
          sink = new CanvasSink(v, { poolSize: 1 });
        const results = [];
        for (const t of [0.1, 0.25, 0.5, 0.8, 1.2]) {
          const frame = await sink.getCanvas(t);
          results.push({
            time: t,
            timestamp: frame.timestamp,
            color: Array.from(frame.canvas.getContext('2d').getImageData(100, 100, 1, 1).data),
          });
        }
        return results;
      } finally {
        input.dispose();
      }
    },
    Array.from(await fs.readFile('artifacts/vfr-24fps.mp4')),
  );
  for (const f of result) {
    const time = Math.floor(f.time * 24) / 24;
    const index = fixture.times.slice(0, -1).findLastIndex((t: number) => t <= time + 0.5e-6);
    const expected = index % 2 ? [30, 75, 180] : [200, 50, 50];
    const color = f.color as number[];
    for (let c = 0; c < 3; c++) expect(Math.abs(color[c] - expected[c])).toBeLessThan(10);
    expect(f.timestamp).toBeCloseTo(time, 5);
  }
  await fs.writeFile('artifacts/vfr-verification.json', JSON.stringify(result, null, 2));
  await page.getByRole('button', { name: '편집으로 돌아가기', exact: true }).click();
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /제목 추가/ }).click();
  const box = await page.locator('.text-selection').boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2 + 30, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.locator('.timeline-clip.text').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('spinbutton', { name: '가로 위치 (%)', exact: true })).toHaveValue(
    '50',
  );
  await expect(page.getByRole('spinbutton', { name: '세로 위치 (%)', exact: true })).toHaveValue(
    '50',
  );
});
