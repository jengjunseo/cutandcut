import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
test('portrait preview stays visible across ratios, recovery and resizing; accessible export settings', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.output-support')).toContainText('MP4');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /제목 추가/ }).click();
  await page.getByLabel('텍스트 내용').fill('세로 미리보기\n구도와 자막');
  await page.getByLabel('텍스트 내용').press('Tab');
  await page.getByRole('spinbutton', { name: '길이 (초)', exact: true }).fill('2');
  await page.getByRole('spinbutton', { name: '길이 (초)', exact: true }).press('Enter');
  await page.getByRole('region', { name: '편집 타임라인', exact: true }).focus();
  await page.keyboard.press('Escape');
  const boxes = [];
  for (const ratio of ['16:9', '9:16', '1:1', '4:5', '4:3', '9:16']) {
    await page.getByRole('button', { name: ratio, exact: true }).click();
    await expect
      .poll(async () => {
        const b = await page.getByLabel('프로젝트 합성 영상').boundingBox();
        return b?.height ?? 0;
      })
      .toBeGreaterThan(100);
    const b = (await page.getByLabel('프로젝트 합성 영상').boundingBox())!;
    const [w, h] = ratio.split(':').map(Number);
    expect(b.width / b.height).toBeCloseTo(w / h, 2);
    boxes.push({ ratio, width: b.width, height: b.height });
  }
  await page.getByRole('separator', { name: '타임라인 높이' }).focus();
  await page.keyboard.press('ArrowUp');
  await expect
    .poll(async () => (await page.getByLabel('프로젝트 합성 영상').boundingBox())!.width)
    .toBeGreaterThan(100);
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  await page.reload();
  await expect(page.getByLabel('프로젝트 합성 영상')).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect
    .poll(async () => (await page.getByLabel('프로젝트 합성 영상').boundingBox())!.height)
    .toBeGreaterThan(100);
  await page.screenshot({ path: 'artifacts/audit-portrait.png' });
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByRole('radio', { name: '높음', exact: true }).check();
  await expect(page.getByRole('radio', { name: '높음', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '출력 설정 변경', exact: true }).click();
  await page.getByLabel('출력 해상도').selectOption('1080');
  await expect(page.locator('.export-summary')).toContainText('1080 × 1920');
  await page.getByLabel('출력 해상도').selectOption('720');
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByText('내보내기가 완료됐습니다.')).toBeVisible();
  const player = page.locator('.output-player');
  await expect
    .poll(() => player.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  const metadata = await player.evaluate((v: HTMLVideoElement) => ({
    width: v.videoWidth,
    height: v.videoHeight,
  }));
  expect(metadata).toEqual({ width: 720, height: 1280 });
  const box = (await player.boundingBox())!;
  expect(box.height).toBeGreaterThan(box.width);
  await fs.writeFile(
    'artifacts/audit-preview.json',
    JSON.stringify({ boxes, metadata, player: box }, null, 2),
  );
});
test('native AAC unavailable uses real local AAC fallback and library-only import is explicit', async ({
  page,
}) => {
  await page.route('**/src/engine.worker.ts?*', async (route) => {
    if (!route.request().url().includes('worker_file')) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      response,
      body: `const originalCheck=AudioEncoder.isConfigSupported.bind(AudioEncoder); AudioEncoder.isConfigSupported=async c=>c.codec.startsWith('mp4a')?{supported:false,config:c}:originalCheck(c);\n${body}`,
    });
  });
  await page.goto('/');
  await expect(page.locator('.output-support')).toContainText('로컬 AAC 대체 인코더');
  const fixture = await page.evaluate(async () => {
    const url = '/tests/fixtures.browser.ts';
    return (await import(/* @vite-ignore */ url)).makeFixtures();
  });
  await page.getByLabel('미디어 파일 선택').setInputFiles(
    fixture.slice(0, 3).map((f: { name: string; mimeType: string; bytes: number[] }) => ({
      name: f.name,
      mimeType: f.mimeType,
      buffer: Buffer.from(f.bytes),
    })),
  );
  await expect(page.locator('.asset-card')).toHaveCount(3);
  await expect(page.locator('.import-progress')).toHaveCount(0);
  await expect(page.locator('.timeline-clip')).toHaveCount(0);
  await page
    .getByRole('button', { name: '선택한 미디어 추가 · 영상은 연속 배치', exact: true })
    .click();
  await expect(page.locator('.timeline-clip.video')).toHaveCount(2);
  const zoom = Number(
    await page.getByRole('slider', { name: '타임라인 확대', exact: true }).inputValue(),
  );
  expect(zoom).toBeGreaterThan(44);
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toHaveValue('mp4');
  await expect(
    page.getByText(
      '브라우저 AAC 인코더 대신 기기 안에서 WASM AAC 인코더를 사용합니다. 원본은 업로드되지 않습니다.',
    ),
  ).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByText('내보내기가 완료됐습니다.')).toBeVisible();
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 다운로드', exact: true }).click();
  await (await wait).saveAs('artifacts/aac-fallback.mp4');
  const bytes = Array.from(await fs.readFile('artifacts/aac-fallback.mp4'));
  const result = await page.evaluate(async (bytes) => {
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
      let energy = 0;
      for await (const sample of new AudioSampleSink(a).samples(0, 1)) {
        const data = new Float32Array(sample.numberOfFrames);
        sample.copyTo(data, { planeIndex: 0, format: 'f32-planar' });
        for (const value of data) energy += value * value;
        sample.close();
      }
      return { video: v.codec, audio: a.codec, energy, length: await input.computeDuration() };
    } finally {
      input.dispose();
    }
  }, bytes);
  expect(result.video).toBe('avc');
  expect(result.audio).toBe('aac');
  expect(result.energy).toBeGreaterThan(10);
  await fs.writeFile('artifacts/aac-fallback.json', JSON.stringify(result, null, 2));
});
test('missing H264 encoder is disclosed before editing and WebM is an actual alternative', async ({
  page,
}) => {
  await page.route('**/src/engine.worker.ts?*', async (route) => {
    if (!route.request().url().includes('worker_file')) {
      await route.continue();
      return;
    }
    const response = await route.fetch(),
      body = await response.text();
    await route.fulfill({
      response,
      body: `const originalCheck=VideoEncoder.isConfigSupported.bind(VideoEncoder); VideoEncoder.isConfigSupported=async c=>c.codec.startsWith('avc')?{supported:false,config:c}:originalCheck(c);\n${body}`,
    });
  });
  await page.goto('/');
  await expect(page.locator('.output-support')).toContainText('MP4 영상 인코더 미지원');
  await expect(page.locator('.output-support')).toContainText('WebM으로 완성');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /제목 추가/ }).click();
  await page.getByRole('spinbutton', { name: '길이 (초)', exact: true }).fill('1');
  await page.getByRole('spinbutton', { name: '길이 (초)', exact: true }).press('Enter');
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toHaveValue('webm');
  await expect(page.getByLabel('파일 형식').locator('option[value="mp4"]')).toHaveAttribute(
    'disabled',
    '',
  );
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByText('내보내기가 완료됐습니다.')).toBeVisible();
  await expect
    .poll(() => page.locator('.output-player').evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2);
});
