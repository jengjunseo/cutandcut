import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
async function fixtures(page: Page) {
  return page.evaluate(async () => {
    const url = '/tests/fixtures.browser.ts';
    const mod = await import(/* @vite-ignore */ url);
    return mod.makeFixtures();
  });
}
async function importSamples(page: Page) {
  const samples = await fixtures(page);
  await page
    .getByLabel('미디어 파일 선택')
    .setInputFiles(
      samples.map((f: { name: string; mimeType: string; bytes: number[] }) => ({
        name: f.name,
        mimeType: f.mimeType,
        buffer: Buffer.from(f.bytes),
      })),
    );
  await expect(page.locator('.asset-card')).toHaveCount(4);
  await expect(page.locator('.import-progress')).toHaveCount(0);
  return samples;
}
async function setNumber(page: Page, label: string, value: string) {
  const field = page.getByRole('spinbutton', { name: label, exact: true });
  await field.fill(value);
  await field.press('Enter');
}
async function saveJSON(page: Page) {
  await page.getByRole('button', { name: '프로젝트 메뉴', exact: true }).click();
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: '프로젝트 파일 저장', exact: true }).click();
  const file = await (await wait).path();
  return JSON.parse(await fs.readFile(file!, 'utf8'));
}
async function exportFile(page: Page, format: 'mp4' | 'webm' | 'wav' | 'mp3', dest: string) {
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByLabel('파일 형식').selectOption(format);
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect
    .poll(
      async () => {
        if (await page.getByRole('dialog').locator('.warning').count())
          throw new Error(await page.getByRole('dialog').locator('.warning').innerText());
        return await page.getByText('내보내기가 완료됐습니다.').isVisible();
      },
      { timeout: 120000 },
    )
    .toBe(true);
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 다운로드', exact: true }).click();
  await (await wait).saveAs(dest);
  await page.getByRole('button', { name: '편집으로 돌아가기', exact: true }).click();
}
async function inspectOutput(page: Page, file: string) {
  const bytes = Array.from(await fs.readFile(file));
  return page.evaluate(async (bytes) => {
    const url = '/node_modules/mediabunny/dist/modules/src/index.js';
    const { Input, BufferSource, ALL_FORMATS, CanvasSink, AudioSampleSink } = await import(
      /* @vite-ignore */ url
    );
    const input = new Input({
      source: new BufferSource(new Uint8Array(bytes)),
      formats: ALL_FORMATS,
    });
    try {
      const video = await input.getPrimaryVideoTrack(),
        audio = await input.getPrimaryAudioTrack(),
        length = await input.computeDuration();
      const pixels: number[][] = [];
      if (video) {
        const sink = new CanvasSink(video, { poolSize: 1 });
        for (const t of [0.25, 1.25, 2.25]) {
          const frame = await sink.getCanvas(t);
          const canvas = frame.canvas;
          pixels.push(
            Array.from(
              canvas
                .getContext('2d')
                .getImageData(Math.round(canvas.width * 0.1), Math.round(canvas.height * 0.5), 1, 1)
                .data,
            ),
          );
        }
      }
      let energy = 0,
        samples = 0;
      if (audio) {
        for await (const sample of new AudioSampleSink(audio).samples()) {
          const data = new Float32Array(sample.numberOfFrames);
          sample.copyTo(data, { planeIndex: 0, format: 'f32-planar' });
          for (let i = 0; i < data.length; i += 16) {
            energy += data[i] * data[i];
            samples++;
          }
          sample.close();
        }
      }
      return {
        container: (await input.getFormat()).name,
        width: video?.displayWidth,
        height: video?.displayHeight,
        videoCodec: video?.codec,
        audioCodec: audio?.codec,
        length,
        rms: Math.sqrt(energy / Math.max(1, samples)),
        pixels,
      };
    } finally {
      input.dispose();
    }
  }, bytes);
}
test('real local editing, linked cuts, layers, Korean, audio, outputs and recovery', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const uploads: string[] = [];
  page.on('request', (r) => {
    if (['POST', 'PUT'].includes(r.method()) && r.url().startsWith('http')) uploads.push(r.url());
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '파일 선택', exact: true })).toBeVisible();
  const samples = await importSamples(page);
  await expect(page.getByLabel('프로젝트 합성 영상')).toBeVisible();
  await page.screenshot({ path: 'artifacts/imported.png' });
  await page.locator('.timeline-clip.video').filter({ hasText: 'first.mp4' }).click();
  const ruler = await page.locator('.ruler').boundingBox();
  await page.mouse.click(ruler!.x + 44, ruler!.y + 15);
  await page.keyboard.press('Control+b');
  await expect(page.locator('.timeline-clip.video')).toHaveCount(3);
  await expect(page.locator('.timeline-clip.audio')).toHaveCount(4);
  await page.locator('.timeline-clip.video[aria-label*="시작 0.00초"]').click();
  await setNumber(page, '길이 (초)', '0.8');
  await page.locator('.timeline-clip.video').filter({ hasText: 'second.mp4' }).click();
  await setNumber(page, '시작 (초)', '0');
  await page
    .locator('.timeline-clip.video[aria-label*="시작 0.00초"]')
    .filter({ hasText: 'first.mp4' })
    .focus();
  await page.keyboard.press('Enter');
  await setNumber(page, '시작 (초)', '2');
  await page
    .locator('.timeline-clip.video[aria-label*="시작 1.00초"]')
    .filter({ hasText: 'first.mp4' })
    .focus();
  await page.keyboard.press('Enter');
  await setNumber(page, '시작 (초)', '2.8');
  await page.getByRole('button', { name: '전환', exact: true }).click();
  await page.getByRole('button', { name: '크로스 디졸브', exact: true }).click();
  await expect(page.locator('.transition-marker')).toHaveCount(1);
  await page.locator('.timeline-clip.image').click();
  await setNumber(page, '크기 (%)', '30');
  await setNumber(page, '가로 위치 (%)', '80');
  await setNumber(page, '세로 위치 (%)', '20');
  await setNumber(page, '길이 (초)', '1.5');
  // Seek to zero before adding Korean caption on the same upper visual track.
  await page.mouse.click(ruler!.x + 1, ruler!.y + 15);
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /제목 추가/ }).click();
  await page.getByLabel('텍스트 내용').fill('한글 편집 테스트\nCyanCut');
  await page.getByLabel('텍스트 내용').press('Tab');
  await setNumber(page, '길이 (초)', '6');
  await page.locator('.timeline-clip.audio').filter({ hasText: 'music.wav' }).click();
  await setNumber(page, '페이드 인 (초)', '0.5');
  await setNumber(page, '페이드 아웃 (초)', '1');
  await page.getByRole('slider', { name: /볼륨/ }).press('Home');
  for (let i = 0; i < 40; i++) await page.getByRole('slider', { name: /볼륨/ }).press('ArrowRight');
  await page.getByRole('slider', { name: /볼륨/ }).press('ArrowRight');
  await page.getByRole('slider', { name: /볼륨/ }).press('Tab');
  await page.getByRole('button', { name: '실행 취소 (Ctrl/Cmd+Z)', exact: true }).click();
  await page.getByRole('button', { name: '다시 실행 (Ctrl/Cmd+Shift+Z)', exact: true }).click();
  const before = await saveJSON(page);
  expect(before.clips.filter((c: Record<string, unknown>) => c.kind === 'video')).toHaveLength(3);
  expect(before.clips.find((c: { kind: string }) => c.kind === 'text').text.text).toContain('한글');
  expect(before.clips.some((c: { transition?: unknown }) => c.transition)).toBe(true);
  await page.screenshot({ path: 'artifacts/edited.png' });
  await page.getByRole('region', { name: '편집 타임라인', exact: true }).focus();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '16:9', exact: true }).click();
  await fs.mkdir('artifacts', { recursive: true });
  await exportFile(page, 'mp4', 'artifacts/output-16x9.mp4');
  const landscape = await inspectOutput(page, 'artifacts/output-16x9.mp4');
  expect(landscape.width).toBe(1280);
  expect(landscape.height).toBe(720);
  expect(landscape.videoCodec).toBe('avc');
  expect(landscape.audioCodec).toBe('aac');
  expect(landscape.length).toBeCloseTo(6, 1);
  expect(landscape.rms).toBeGreaterThan(0.02);
  const parity = await page.evaluate(
    async (args) => {
      const url = '/tests/e2e/parity.browser.ts';
      return (await import(/* @vite-ignore */ url)).compareOutput(args.project, args.bytes);
    },
    {
      project: await saveJSON(page),
      bytes: Array.from(await fs.readFile('artifacts/output-16x9.mp4')),
    },
  );
  for (const frame of parity) expect(frame.mae).toBeLessThan(15);
  expect(parity[1].color[2]).toBeGreaterThan(parity[1].color[0]);
  expect(parity[2].color[0]).toBeGreaterThan(parity[2].color[2]);
  await page.getByRole('button', { name: '9:16', exact: true }).click();
  await exportFile(page, 'mp4', 'artifacts/output-9x16.mp4');
  const portrait = await inspectOutput(page, 'artifacts/output-9x16.mp4');
  expect(portrait.width).toBe(720);
  expect(portrait.height).toBe(1280);
  expect(portrait.length).toBeCloseTo(6, 1);
  await exportFile(page, 'webm', 'artifacts/output.webm');
  const webm = await inspectOutput(page, 'artifacts/output.webm');
  expect(webm.audioCodec).toBe('opus');
  expect(['vp9', 'vp8']).toContain(webm.videoCodec);
  await exportFile(page, 'wav', 'artifacts/output.wav');
  const wav = await inspectOutput(page, 'artifacts/output.wav');
  expect(wav.rms).toBeGreaterThan(0.02);
  await exportFile(page, 'mp3', 'artifacts/output.mp3');
  const mp3 = await inspectOutput(page, 'artifacts/output.mp3');
  expect(mp3.audioCodec).toBe('mp3');
  expect(mp3.rms).toBeGreaterThan(0.02);
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  const saved = await saveJSON(page);
  await page.reload();
  await expect(page.locator('.asset-card')).toHaveCount(4);
  await expect(page.locator('.missing-banner')).toHaveCount(0);
  const restored = await saveJSON(page);
  expect(restored.clips).toEqual(saved.clips);
  expect(restored.width).toBe(saved.width);
  // Invalid input keeps the project. Cancelling export also keeps its snapshot.
  await page
    .getByLabel('미디어 파일 선택')
    .setInputFiles({
      name: 'broken.avi',
      mimeType: 'video/x-msvideo',
      buffer: Buffer.from('invalid input'),
    });
  await expect(page.locator('.toast')).toContainText('분석');
  await expect(page.locator('.asset-card')).toHaveCount(4);
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await page.getByRole('button', { name: '내보내기 취소', exact: true }).click();
  await expect(page.getByText('내보내기를 취소했습니다. 프로젝트는 유지됩니다.')).toBeVisible();
  await page.getByRole('button', { name: '돌아가기', exact: true }).click();
  expect((await saveJSON(page)).clips).toEqual(saved.clips);
  const audioCuts = await page.evaluate(
    async (bytes) => {
      const url = '/tests/e2e/parity.browser.ts';
      return (await import(/* @vite-ignore */ url)).audioCuts(bytes);
    },
    Array.from(await fs.readFile('artifacts/output-16x9.mp4')),
  );
  for (const f of audioCuts) {
    const expected = f.time < 2 ? 2 : f.time < 3.8 ? 1 : -1;
    for (const index of [1, 2])
      expect(f.amplitudes[index]).toBeCloseTo(expected === index ? 0.12 : 0, 2);
  }
  expect(audioCuts[6].amplitudes[0]).toBeCloseTo(0.15 * 0.41, 2);
  const fadeRatio = audioCuts[7].amplitudes[0] / audioCuts[6].amplitudes[0];
  expect(fadeRatio).toBeGreaterThan(0.15);
  expect(fadeRatio).toBeLessThan(0.4);
  await fs.writeFile(
    'artifacts/audio-sync-verification.json',
    JSON.stringify({ audioCuts, fadeRatio }, null, 2),
  );
  // Lose a stored original, reload, and reconnect the same real file.
  await page.evaluate(async (assetId) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('cyancut-local', 1);
      req.onsuccess = () => {
        const db = req.result,
          tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').delete(assetId);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, saved.assets[0].id);
  await page.reload();
  await expect(page.locator('.missing-banner')).toContainText('원본 1개');
  const f = samples[0];
  await page
    .getByLabel('미디어 파일 선택')
    .setInputFiles({ name: f.name, mimeType: f.mimeType, buffer: Buffer.from(f.bytes) });
  await expect(page.locator('.missing-banner')).toHaveCount(0);
  expect((await saveJSON(page)).clips).toEqual(saved.clips);
  await fs.writeFile(
    'artifacts/verification.json',
    JSON.stringify(
      { landscape, portrait, webm, wav, mp3, parity, consoleErrors: errors, uploads },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
  expect(uploads).toEqual([]);
});
test('mobile layout, IME-safe input and truthful saving failure', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '속성', exact: true }).click();
  await expect(page.getByRole('button', { name: '9:16', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '9:16', exact: true }).click();
  await page.getByRole('button', { name: '미디어', exact: true }).first().click();
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /제목 추가/ }).click();
  const text = page.getByLabel('텍스트 내용');
  await text.fill('한글');
  await text.dispatchEvent('compositionstart');
  await text.press('b');
  await text.dispatchEvent('compositionend');
  await text.press('Tab');
  expect(await page.locator('.timeline-clip.text').count()).toBe(1);
  await page.screenshot({ path: 'artifacts/mobile.png' });
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'project') throw new DOMException('test quota', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await page.getByLabel('프로젝트 이름').fill('저장 실패 검증');
  await page.getByLabel('프로젝트 이름').press('Tab');
  await expect(page.locator('.save-state')).toContainText('저장 실패');
  await expect(page.locator('.toast')).toContainText('자동 저장에 실패');
  await expect(page.locator('.timeline-clip.text')).toHaveCount(1);
});
