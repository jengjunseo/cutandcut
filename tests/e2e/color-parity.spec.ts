import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';

async function preview(page: Page) {
  await expect(page.locator('.preview-loading')).toHaveCount(0);
  await expect(page.locator('.canvas-wrap')).toHaveAttribute('aria-busy', 'false');
  await expect
    .poll(() => page.locator('.canvas-wrap canvas').evaluate((c: HTMLCanvasElement) => c.width))
    .toBeGreaterThan(20);
  return page.evaluate(async () => {
    const url = '/tests/e2e/color.browser.ts';
    const { patches } = await import(/* @vite-ignore */ url);
    const c = document.querySelector('.canvas-wrap canvas') as HTMLCanvasElement;
    return {
      width: c.width,
      height: c.height,
      patches: patches(c),
      colorSpace: c.getContext('2d')!.getContextAttributes().colorSpace,
      alpha: c.getContext('2d')!.getContextAttributes().alpha,
    };
  });
}

for (const mode of ['standard', 'mobile'])
  test(`letterbox background: ${mode} preserves old project, changes blue bars to black with undo and real portrait MP4`, async ({
    page,
  }) => {
    await page.goto('/');
    const original = await page.evaluate(async (mode) => {
      const fixtureUrl = '/tests/e2e/color.browser.ts';
      const storageUrl = '/src/storage.ts';
      const project = await (await import(/* @vite-ignore */ fixtureUrl)).seedColorProject();
      project.width = 1080;
      project.height = 1920;
      project.background = '#111820';
      await (await import(/* @vite-ignore */ storageUrl)).saveProject(project);
      localStorage.setItem('cyancut-ui-mode', mode);
      return project;
    }, mode);
    if (mode === 'mobile') await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
    const before = await preview(page);
    expect(before.patches[0]).toEqual([17, 24, 32, 255]);
    const blueOutput = await output(page, `letterbox-${mode}-before`);
    expect(blueOutput.patches[0][2]).toBeGreaterThan(blueOutput.patches[0][0] + 8);
    if (mode === 'mobile')
      await page.locator('.mobile-dock').getByRole('button', { name: '화면', exact: true }).click();
    await page.getByRole('button', { name: '검정으로', exact: true }).click();
    if (mode === 'mobile')
      await page.getByRole('button', { name: '프로젝트 설정 닫기', exact: true }).click();
    await expect.poll(async () => (await preview(page)).patches[0]).toEqual([0, 0, 0, 255]);
    await page.getByRole('button', { name: '실행 취소 (Ctrl/Cmd+Z)', exact: true }).click();
    await expect.poll(async () => (await preview(page)).patches[0]).toEqual([17, 24, 32, 255]);
    await page.getByRole('button', { name: '다시 실행 (Ctrl/Cmd+Shift+Z)', exact: true }).click();
    await expect.poll(async () => (await preview(page)).patches[0]).toEqual([0, 0, 0, 255]);
    const blackOutput = await output(page, `letterbox-${mode}-after`);
    expect([blackOutput.width, blackOutput.height]).toEqual([1080, 1920]);
    for (const pixel of blackOutput.patches)
      expect(Math.max(...pixel.slice(0, 3))).toBeLessThanOrEqual(2);
    await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
    await page.reload();
    expect((await preview(page)).patches[0]).toEqual([0, 0, 0, 255]);
    const restored = await page.evaluate(async () => {
      const url = '/src/storage.ts';
      return (await import(/* @vite-ignore */ url)).restoreProject();
    });
    expect(restored.clips).toEqual(original.clips);
    expect(restored.background).toBe('#000000');
    await fs.writeFile(
      `artifacts/color-letterbox-${mode}.json`,
      JSON.stringify({ blueOutput, blackOutput }, null, 2),
    );
  });

async function output(page: Page, name: string) {
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByLabel('파일 형식').selectOption('mp4');
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByText('내보내기가 완료됐습니다.')).toBeVisible({ timeout: 120000 });
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 다운로드', exact: true }).click();
  const download = await waiting;
  await download.saveAs(`artifacts/color-${name}.mp4`);
  const bytes = Array.from(await fs.readFile((await download.path())!));
  const result = await page.evaluate(async (bytes) => {
    const url = '/tests/e2e/color.browser.ts';
    return (await import(/* @vite-ignore */ url)).inspectColorOutput(bytes);
  }, bytes);
  await page.getByRole('button', { name: '편집으로 돌아가기', exact: true }).click();
  return result;
}

test('color parity: standard and phone UI preserve neutral colors, project and real 1080p MP4', async ({
  browser,
}) => {
  test.setTimeout(240000);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    hasTouch: true,
    isMobile: true,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto('/');
    const original = await page.evaluate(async () => {
      const url = '/tests/e2e/color.browser.ts';
      return (await import(/* @vite-ignore */ url)).seedColorProject();
    });
    await page.reload();
    await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
    const standardPreview = await preview(page);
    const standardOutput = await output(page, 'standard');
    await page.evaluate(() => localStorage.setItem('cyancut-ui-mode', 'mobile'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.locator('.app')).toHaveClass(/ui-mobile/);
    await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
    const phonePreview = await preview(page);
    expect(phonePreview.alpha).toBe(false);
    expect(standardPreview.alpha).toBe(false);
    expect(phonePreview.colorSpace).toBe('srgb');
    await expect(page.locator('.canvas-wrap')).toHaveCSS(
      '-webkit-tap-highlight-color',
      'rgba(0, 0, 0, 0)',
    );
    const phoneOutput = await output(page, 'phone');
    const restored = await page.evaluate(async () => {
      const url = '/src/storage.ts';
      return (await import(/* @vite-ignore */ url)).restoreProject();
    });
    expect(restored).toEqual(original);
    for (const pixels of [
      standardPreview.patches,
      phonePreview.patches,
      standardOutput.patches,
      phoneOutput.patches,
    ])
      for (const neutral of pixels.slice(0, 3))
        expect(
          Math.max(...neutral.slice(0, 3)) - Math.min(...neutral.slice(0, 3)),
        ).toBeLessThanOrEqual(3);
    expect(phoneOutput).toEqual(standardOutput);
    for (let i = 0; i < 6; i++)
      for (let channel = 0; channel < 3; channel++)
        expect(
          Math.abs(phonePreview.patches[i][channel] - standardPreview.patches[i][channel]),
        ).toBeLessThanOrEqual(2);
    expect(errors).toEqual([]);
    await fs.writeFile(
      'artifacts/color-parity.json',
      JSON.stringify(
        {
          standardPreview,
          phonePreview,
          standardOutput,
          phoneOutput,
          errors,
          userAgent: await page.evaluate(() => navigator.userAgent),
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
  }
});

for (const mode of ['standard', 'mobile'])
  test(`color diagnostics: ${mode} warns about HDR before export without changing source metadata`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.evaluate(async (mode) => {
      const fixtureUrl = '/tests/e2e/color.browser.ts';
      const storageUrl = '/src/storage.ts';
      const project = await (await import(/* @vite-ignore */ fixtureUrl)).seedColorProject();
      // Diagnostic UI fixture only: this is not an HDR decode/tone-mapping test.
      project.assets[0].colorSpace = {
        primaries: 'bt2020',
        transfer: 'hlg',
        matrix: 'bt2020-ncl',
        fullRange: false,
      };
      await (await import(/* @vite-ignore */ storageUrl)).saveProject(project);
      localStorage.setItem('cyancut-ui-mode', mode);
    }, mode);
    if (mode === 'mobile') await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
    if (mode === 'mobile')
      await page
        .locator('.mobile-dock')
        .getByRole('button', { name: '미디어', exact: true })
        .click();
    await expect(page.locator('.asset-card .asset-color-note')).toContainText('HDR 원본');
    if (mode === 'mobile')
      await page.getByRole('button', { name: '추가 도구 닫기', exact: true }).click();
    await page.getByRole('button', { name: '내보내기', exact: true }).click();
    await expect(page.getByRole('dialog').locator('.asset-color-note')).toContainText(
      'SDR/Rec.709',
    );
    await expect(
      page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }),
    ).toBeEnabled();
    await expect(page.locator('.export-preflight summary')).toContainText('확인할 항목 있음');
  });
