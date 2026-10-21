import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import type { Project } from '../../src/model';

test('production color: reconnect legacy project, remove blue bars and preserve portrait MP4 across UI modes', async ({
  page,
  context,
}) => {
  test.skip(!process.env.PRODUCTION_URL, 'Set PRODUCTION_URL for the deployed bundle.');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const analyzer = await context.newPage();
  try {
    await analyzer.goto('http://localhost:5174');
    const data = await analyzer.evaluate(async () => {
      const fixtureUrl = '/tests/e2e/color.browser.ts';
      const storageUrl = '/src/storage.ts';
      const project: Project = await (
        await import(/* @vite-ignore */ fixtureUrl)
      ).seedColorProject();
      const storage = await import(/* @vite-ignore */ storageUrl);
      project.width = 1080;
      project.height = 1920;
      project.background = '#111820';
      const sources = await Promise.all(
        project.assets.map(async (a) => {
          const file: File = await storage.loadFile(a.id);
          return {
            name: file.name,
            mimeType: file.type,
            bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
          };
        }),
      );
      return { project, sources };
    });
    await page.goto(process.env.PRODUCTION_URL!);
    await expect(page.locator('.color-field input')).toHaveValue('#000000');
    await page.getByLabel('프로젝트 파일 선택').setInputFiles({
      name: 'legacy-blue.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(data.project)),
    });
    await expect(page.locator('.timeline-clip')).toHaveCount(3);
    await page.getByLabel('미디어 파일 선택').setInputFiles(
      data.sources.map((s) => ({
        name: s.name,
        mimeType: s.mimeType,
        buffer: Buffer.from(s.bytes),
      })),
    );
    await expect(page.locator('.asset-card.missing')).toHaveCount(0);
    await expect(page.locator('.import-progress')).toHaveCount(0);
    await expect.poll(() => bar(page)).toEqual([17, 24, 32, 255]);
    const blue = await exportAndInspect(page, analyzer, 'legacy-blue');
    expect(blue.patches[0][2]).toBeGreaterThan(blue.patches[0][0] + 8);
    await page.getByRole('button', { name: '검정으로', exact: true }).click();
    await expect.poll(() => bar(page)).toEqual([0, 0, 0, 255]);
    const standard = await exportAndInspect(page, analyzer, 'black-standard');
    await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
    await page.evaluate(() => localStorage.setItem('cyancut-ui-mode', 'mobile'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.locator('.app')).toHaveClass(/ui-mobile/);
    await expect.poll(() => bar(page)).toEqual([0, 0, 0, 255]);
    await page.locator('.mobile-dock').getByRole('button', { name: '화면', exact: true }).click();
    await expect(page.getByRole('button', { name: '검정으로', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '검정으로', exact: true }).scrollIntoViewIfNeeded();
    const reset = (await page
      .getByRole('button', { name: '검정으로', exact: true })
      .boundingBox())!;
    expect(reset.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: 'artifacts/color-production-phone-settings.png' });
    await page.getByRole('button', { name: '프로젝트 설정 닫기', exact: true }).click();
    await page.screenshot({ path: 'artifacts/color-production-phone-preview.png' });
    const mobile = await exportAndInspect(page, analyzer, 'black-mobile');
    expect([mobile.width, mobile.height]).toEqual([1080, 1920]);
    for (const pixel of mobile.patches)
      expect(Math.max(...pixel.slice(0, 3))).toBeLessThanOrEqual(2);
    expect(mobile).toEqual(standard);
    expect(errors).toEqual([]);
    await fs.writeFile(
      'artifacts/color-production.json',
      JSON.stringify(
        {
          url: process.env.PRODUCTION_URL,
          blue,
          standard,
          mobile,
          errors,
          userAgent: await page.evaluate(() => navigator.userAgent),
        },
        null,
        2,
      ),
    );
  } finally {
    await analyzer.close();
  }
});

async function bar(page: Page) {
  return page
    .locator('.canvas-wrap canvas')
    .evaluate((c: HTMLCanvasElement) =>
      Array.from(
        c.getContext('2d')!.getImageData(Math.floor(c.width / 6), Math.floor(c.height / 4), 1, 1)
          .data,
      ),
    );
}

async function exportAndInspect(page: Page, analyzer: Page, name: string) {
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByLabel('파일 형식').selectOption('mp4');
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByText('내보내기가 완료됐습니다.')).toBeVisible({ timeout: 120000 });
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 다운로드', exact: true }).click();
  const download = await waiting;
  await download.saveAs(`artifacts/color-production-${name}.mp4`);
  const bytes = Array.from(await fs.readFile((await download.path())!));
  const result = await analyzer.evaluate(async (bytes) => {
    const url = '/tests/e2e/color.browser.ts';
    return (await import(/* @vite-ignore */ url)).inspectColorOutput(bytes);
  }, bytes);
  await page.getByRole('button', { name: '편집으로 돌아가기', exact: true }).click();
  return result;
}
