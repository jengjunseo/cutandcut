import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
test('production bundle: real files, Korean, native playback and all output engines', async ({
  page,
  context,
}) => {
  test.skip(!process.env.PRODUCTION_URL, 'Set PRODUCTION_URL to verify a deployed bundle.');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const fixturePage = await context.newPage();
  await fixturePage.goto('http://localhost:5174');
  const fixtures = await fixturePage.evaluate(async () => {
    const url = '/tests/fixtures.browser.ts';
    return (await import(/* @vite-ignore */ url)).makeFixtures();
  });
  await fs.mkdir('artifacts/inputs', { recursive: true });
  for (const f of fixtures) await fs.writeFile('artifacts/inputs/' + f.name, Buffer.from(f.bytes));
  const fallback = process.env.FORCE_AAC_FALLBACK === '1';
  if (fallback)
    await page.route('**/assets/engine.worker-*.js', async (route) => {
      const response = await route.fetch(),
        body = await response.text();
      await route.fulfill({
        response,
        body: `const __auditAacCheck=AudioEncoder.isConfigSupported.bind(AudioEncoder);AudioEncoder.isConfigSupported=async c=>c.codec.startsWith('mp4a')?{supported:false,config:c}:__auditAacCheck(c);\n${body}`,
      });
    });
  await page.goto(process.env.PRODUCTION_URL!);
  if (fallback) await expect(page.locator('.output-support')).toContainText('로컬 AAC 대체 인코더');
  await expect(page.getByRole('button', { name: '파일 선택', exact: true })).toBeVisible();
  await page.getByLabel('가져오면서 타임라인에 연속 배치').check();
  await page.getByLabel('미디어 파일 선택').setInputFiles(
    fixtures.map((f: { name: string; mimeType: string; bytes: number[] }) => ({
      name: f.name,
      mimeType: f.mimeType,
      buffer: Buffer.from(f.bytes),
    })),
  );
  await expect(page.locator('.asset-card')).toHaveCount(4);
  await expect(page.locator('.import-progress')).toHaveCount(0);
  await page.getByRole('button', { name: '재생 (Space)', exact: true }).click();
  await expect(page.locator('.current-time')).not.toHaveValue('00:00:00:00');
  await page.getByRole('button', { name: '일시정지 (Space)', exact: true }).click();
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /제목 추가/ }).click();
  await page.getByLabel('텍스트 내용').fill('배포된 CyanCut\n실제 영상 내보내기');
  await page.getByLabel('텍스트 내용').press('Tab');
  await page.screenshot({ path: 'artifacts/production-editor.png' });
  const report: Record<string, unknown> = {};
  for (const preset of ['mp4', 'mp4-portrait', 'webm', 'wav', 'mp3']) {
    const format = preset === 'mp4-portrait' ? 'mp4' : preset;
    if (preset === 'mp4-portrait') {
      await page.getByRole('region', { name: '편집 타임라인', exact: true }).focus();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '9:16', exact: true }).click();
      await expect
        .poll(async () => (await page.getByLabel('프로젝트 합성 영상').boundingBox())?.width ?? 0)
        .toBeGreaterThan(100);
      await expect(page.locator('.preview-error')).toHaveCount(0);
    }
    await page.getByRole('button', { name: '내보내기', exact: true }).click();
    await expect(page.getByLabel('파일 형식')).toBeEnabled();
    await page.getByLabel('파일 형식').selectOption(format);
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
    if (format === 'mp4' || format === 'webm') {
      const player = page.locator('.output-player');
      await expect
        .poll(() => player.evaluate((v: HTMLVideoElement) => v.readyState))
        .toBeGreaterThanOrEqual(2);
      const metadata = await player.evaluate(async (v: HTMLVideoElement) => {
        await v.play();
        return { width: v.videoWidth, height: v.videoHeight, duration: v.duration };
      });
      expect(metadata.width).toBe(preset === 'mp4' ? 1280 : 720);
      expect(metadata.height).toBe(preset === 'mp4' ? 720 : 1280);
      await expect
        .poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime))
        .toBeGreaterThan(0.1);
      report[preset] = metadata;
    }
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: '파일 다운로드', exact: true }).click();
    const file = `artifacts/production${fallback ? '-fallback' : ''}-${preset}.${format}`;
    await (await waiting).saveAs(file);
    await page.getByRole('button', { name: '편집으로 돌아가기', exact: true }).click();
    const bytes = Array.from(await fs.readFile(file));
    report[preset] = {
      ...((report[preset] as object) ?? {}),
      ...(await fixturePage.evaluate(async (bytes) => {
        const url = '/node_modules/mediabunny/dist/modules/src/index.js';
        const { Input, BufferSource, ALL_FORMATS, AudioSampleSink } = await import(
          /* @vite-ignore */ url
        );
        const input = new Input({
          source: new BufferSource(new Uint8Array(bytes)),
          formats: ALL_FORMATS,
        });
        try {
          const v = await input.getPrimaryVideoTrack(),
            a = await input.getPrimaryAudioTrack();
          let hasAudioEnergy = false;
          if (a) {
            for await (const sample of new AudioSampleSink(a).samples(0, 1)) {
              const energy = new Float32Array(sample.numberOfFrames);
              sample.copyTo(energy, { format: 'f32-planar', planeIndex: 0 });
              hasAudioEnergy ||= energy.some((n: number) => Math.abs(n) > 0.01);
              sample.close();
            }
          }
          return {
            videoCodec: v?.codec,
            audioCodec: a?.codec,
            hasAudioEnergy,
            bytes: bytes.length,
          };
        } finally {
          input.dispose();
        }
      }, bytes)),
    };
    expect((report[preset] as { hasAudioEnergy: boolean }).hasAudioEnergy).toBe(true);
  }
  await fs.writeFile(
    `artifacts/production${fallback ? '-fallback' : ''}-verification.json`,
    JSON.stringify(
      { url: process.env.PRODUCTION_URL, aacFallbackInjected: fallback, outputs: report, errors },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
  await fixturePage.close();
});
