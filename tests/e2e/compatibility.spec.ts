import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
test('JPEG, MP3, WebM inputs and genuine 1080p output', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '파일 선택', exact: true })).toBeVisible();
  const jpeg = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    c.getContext('2d')!.fillRect(0, 0, 400, 300);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  const converted = await page.evaluate(async () => {
    const url = '/tests/fixtures.browser.ts';
    return (await import(/* @vite-ignore */ url)).makeCompatibilityFixtures();
  });
  await page
    .getByLabel('미디어 파일 선택')
    .setInputFiles([
      { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg) },
      ...converted.map((f: { name: string; mimeType: string; bytes: number[] }) => ({
        name: f.name,
        mimeType: f.mimeType,
        buffer: Buffer.from(f.bytes),
      })),
    ]);
  await expect(page.locator('.asset-card')).toHaveCount(3);
  await expect(page.locator('.import-progress')).toHaveCount(0);
  await page.getByRole('button', { name: '16:9', exact: true }).click();
  await page.getByRole('combobox', { name: '해상도', exact: true }).selectOption('1080');
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByLabel('파일 형식').selectOption('mp4');
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect
    .poll(
      async () => {
        const warning = page.getByRole('dialog').locator('.warning');
        if (await warning.count()) throw new Error(await warning.innerText());
        return page.getByText('내보내기가 완료됐습니다.').isVisible();
      },
      { timeout: 120000 },
    )
    .toBe(true);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 다운로드', exact: true }).click();
  await (await download).saveAs('artifacts/output-1080.mp4');
  const result = await page.evaluate(
    async (bytes) => {
      const url = '/node_modules/mediabunny/dist/modules/src/index.js';
      const { Input, BufferSource, ALL_FORMATS } = await import(/* @vite-ignore */ url);
      const input = new Input({
        source: new BufferSource(new Uint8Array(bytes)),
        formats: ALL_FORMATS,
      });
      const v = await input.getPrimaryVideoTrack(),
        a = await input.getPrimaryAudioTrack();
      const result = {
        width: v?.displayWidth,
        height: v?.displayHeight,
        videoCodec: v?.codec,
        audioCodec: a?.codec,
        duration: await input.computeDuration(),
      };
      input.dispose();
      return result;
    },
    Array.from(await fs.readFile('artifacts/output-1080.mp4')),
  );
  expect(result.width).toBe(1920);
  expect(result.height).toBe(1080);
  expect(result.audioCodec).toBe('aac');
  await fs.writeFile('artifacts/compatibility.json', JSON.stringify(result, null, 2));
});
