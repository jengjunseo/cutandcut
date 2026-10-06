import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import type { Project } from '../../src/model';

async function saved(page: Page): Promise<Project> {
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  await page.getByRole('region', { name: '편집 타임라인', exact: true }).focus();
  const waiting = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  return JSON.parse(await fs.readFile((await (await waiting).path())!, 'utf8'));
}

async function importVideos(page: Page) {
  const analyzer = await page.context().newPage();
  await analyzer.goto('http://localhost:5174');
  const samples = await analyzer.evaluate(async () => {
    const url = '/tests/fixtures.browser.ts';
    return (await import(/* @vite-ignore */ url)).makeFixtures();
  });
  await analyzer.close();
  await page.goto('/');
  await page.getByLabel('가져오면서 타임라인에 연속 배치').check();
  await page.getByLabel('미디어 파일 선택').setInputFiles(
    samples.slice(0, 2).map((s: { name: string; mimeType: string; bytes: number[] }) => ({
      name: s.name,
      mimeType: s.mimeType,
      buffer: Buffer.from(s.bytes),
    })),
  );
  await expect(page.locator('.timeline-clip.video')).toHaveCount(2);
  await expect(page.locator('.import-progress')).toHaveCount(0);
  return samples;
}

for (const pair of [false, true])
  test(`track move: ${pair ? 'selected video/audio pair' : 'pure vertical drag'} can overlay another visual track`, async ({
    page,
  }) => {
    await importVideos(page);
    const before = await saved(page);
    const video = before.clips.find((c) => c.kind === 'video')!;
    const audio = before.clips.find((c) => c.kind === 'audio' && c.linkId === video.linkId)!;
    const clip = page.locator('.timeline-clip.video').first();
    await clip.click({ position: { x: 45, y: 20 } });
    if (pair)
      await page
        .locator('.timeline-clip.audio')
        .first()
        .click({ position: { x: 45, y: 20 }, modifiers: ['Shift'] });
    await expect(page.locator('.clip-selected')).toHaveCount(pair ? 2 : 1);
    await page.locator('.timeline-scroll').evaluate((el) => {
      el.scrollTop = 0;
    });
    const from = (await clip.boundingBox())!;
    const to = (await page.locator('.track-row').first().boundingBox())!;
    await page.mouse.move(from.x + 45, from.y + 20);
    await page.mouse.down();
    await page.mouse.move(from.x + 45 + (pair ? 10 : 0), to.y + 30, { steps: 6 });
    await expect(page.locator('.drop-ghost')).toHaveCount(1);
    await expect(page.locator('.drop-ghost')).toContainText('놓으면 이 위치로 배치');
    await page.mouse.up();
    const after = await saved(page);
    expect(after.clips.find((c) => c.id === video.id)!.trackId).toBe(before.tracks[0].id);
    expect(after.clips.find((c) => c.id === audio.id)!.trackId).toBe(audio.trackId);
    expect(after.clips.find((c) => c.id === audio.id)!.start).toBe(
      after.clips.find((c) => c.id === video.id)!.start,
    );
    await page.keyboard.press('Control+z');
    expect((await saved(page)).clips).toEqual(before.clips);
    await page.keyboard.press('Control+Shift+z');
    expect((await saved(page)).clips).toEqual(after.clips);
  });

test('track drag: stationary pointer does not repeatedly re-render the whole preview', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /제목 추가/ }).click();
  const clip = page.locator('.timeline-clip.text');
  const box = (await clip.boundingBox())!;
  await page.evaluate(() => {
    const send = Worker.prototype.postMessage;
    const audit = { requests: 0 };
    Object.assign(window, { dragAudit: audit });
    Worker.prototype.postMessage = function (data, options) {
      if (data.type === 'preview') audit.requests++;
      return send.call(this, data, Array.isArray(options) ? { transfer: options } : options);
    };
  });
  await page.mouse.move(box.x + 60, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 20, { steps: 4 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const next = () => (++frames >= 6 ? resolve() : requestAnimationFrame(next));
        requestAnimationFrame(next);
      }),
  );
  const first = await page.evaluate(
    () => (window as unknown as { dragAudit: { requests: number } }).dragAudit.requests,
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const next = () => (++frames >= 24 ? resolve() : requestAnimationFrame(next));
        requestAnimationFrame(next);
      }),
  );
  const last = await page.evaluate(
    () => (window as unknown as { dragAudit: { requests: number } }).dragAudit.requests,
  );
  await page.mouse.up();
  expect(last - first).toBeLessThanOrEqual(1);
  await fs.mkdir('artifacts', { recursive: true });
  await fs.writeFile(
    'artifacts/drag-performance.json',
    JSON.stringify({ stationaryFrames: 24, additionalPreviewRequests: last - first }, null, 2),
  );
});

test('1080p overlapping tracks: preview, actual MP4, linked sound and recovery agree', async ({
  page,
}) => {
  await importVideos(page);
  await expect(page.locator('.preview-meta')).toContainText('1920 × 1080');
  await page.locator('.timeline-clip.video').nth(1).click();
  const start = page.getByRole('spinbutton', { name: '시작 (초)', exact: true });
  await start.fill('0');
  await start.press('Enter');
  const clip = page.locator('.timeline-clip.video').filter({ hasText: 'second.mp4' });
  const from = (await clip.boundingBox())!;
  const to = (await page.locator('.track-row').first().boundingBox())!;
  await page.mouse.move(from.x + 45, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(from.x + 45, to.y + 30, { steps: 6 });
  await expect(page.locator('.drop-ghost')).toHaveCount(1);
  await page.mouse.up();
  const project = await saved(page);
  const videos = project.clips.filter((c) => c.kind === 'video');
  expect(new Set(videos.map((c) => c.trackId)).size).toBe(2);
  expect(videos.every((c) => c.start === 0)).toBe(true);
  expect(videos.find((c) => c.trackId === project.tracks[0].id)!.name).toBe('second.mp4');
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  await page.reload();
  expect((await saved(page)).clips).toEqual(project.clips);
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByLabel('파일 형식').selectOption('mp4');
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByText('내보내기가 완료됐습니다.')).toBeVisible({ timeout: 120000 });
  await fs.mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/track-output-player.png' });
  const inspectPlayer = () =>
    page.locator('.output-player').evaluate(async (v: HTMLVideoElement) => {
      if (v.readyState < 2)
        await new Promise<void>((resolve) =>
          v.addEventListener('loadeddata', () => resolve(), { once: true }),
        );
      const frame = new Promise<void>((resolve) => v.requestVideoFrameCallback(() => resolve()));
      const sought = new Promise<void>((resolve) =>
        v.addEventListener('seeked', () => resolve(), { once: true }),
      );
      v.currentTime = 0.5;
      await Promise.all([frame, sought]);
      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(v, 0, 0);
      return {
        width: v.videoWidth,
        height: v.videoHeight,
        duration: v.duration,
        pixel: Array.from(ctx.getImageData(10, 10, 1, 1).data),
        centerPixel: Array.from(
          ctx.getImageData(Math.round(v.videoWidth * 0.7), Math.round(v.videoHeight * 0.5), 1, 1)
            .data,
        ),
      };
    });
  const metadata = await inspectPlayer();
  expect(metadata.width).toBe(1920);
  expect(metadata.height).toBe(1080);
  await fs.writeFile(
    'artifacts/track-overlay-debug.json',
    JSON.stringify({ metadata, project }, null, 2),
  );
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 다운로드', exact: true }).click();
  await fs.mkdir('artifacts', { recursive: true });
  await (await waiting).saveAs('artifacts/track-overlay-1080.mp4');
  expect(metadata.centerPixel[2] - metadata.centerPixel[0]).toBeGreaterThan(100);
  const analyzer = await page.context().newPage();
  await analyzer.goto('http://localhost:5174');
  const audio = await analyzer.evaluate(
    async (bytes) => {
      const url = '/tests/e2e/parity.browser.ts';
      return (await import(/* @vite-ignore */ url)).audioCuts(bytes);
    },
    Array.from(await fs.readFile('artifacts/track-overlay-1080.mp4')),
  );
  expect(audio[0].amplitudes[1]).toBeGreaterThan(0.08);
  expect(audio[0].amplitudes[2]).toBeGreaterThan(0.08);
  await analyzer.close();
  await page.getByRole('button', { name: '편집으로 돌아가기', exact: true }).click();
  await page.getByRole('button', { name: '9:16', exact: true }).click();
  await expect(page.locator('.preview-meta')).toContainText('1080 × 1920');
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByLabel('파일 형식').selectOption('mp4');
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByText('내보내기가 완료됐습니다.')).toBeVisible({ timeout: 120000 });
  const portrait = await inspectPlayer();
  expect(portrait.width).toBe(1080);
  expect(portrait.height).toBe(1920);
  expect(portrait.centerPixel[2] - portrait.centerPixel[0]).toBeGreaterThan(100);
  const portraitDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 다운로드', exact: true }).click();
  await (await portraitDownload).saveAs('artifacts/track-overlay-portrait-1080.mp4');
  await fs.writeFile(
    'artifacts/track-overlay.json',
    JSON.stringify({ ...metadata, audio, portrait }, null, 2),
  );
});

test('capacity: a six-minute timeline can export an actual PCM WAV', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /제목 추가/ }).click();
  const length = page.getByRole('spinbutton', { name: '길이 (초)', exact: true });
  await length.fill('360');
  await length.press('Enter');
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByLabel('파일 형식').selectOption('wav');
  await expect(page.locator('.export-note').first()).toContainText('30분·1GiB');
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByText('내보내기가 완료됐습니다.')).toBeVisible({ timeout: 120000 });
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 다운로드', exact: true }).click();
  const download = await waiting;
  const file = (await download.path())!;
  const handle = await fs.open(file, 'r');
  const header = Buffer.alloc(256);
  await handle.read(header, 0, 256, 0);
  await handle.close();
  expect(header.toString('ascii', 0, 4)).toBe('RIFF');
  expect(header.toString('ascii', 8, 12)).toBe('WAVE');
  const dataAt = header.indexOf('data');
  const byteLength = header.readUInt32LE(dataAt + 4);
  expect(byteLength / (48000 * 2 * 2)).toBe(360);
  await fs.mkdir('artifacts', { recursive: true });
  await download.saveAs('artifacts/six-minutes.wav');
  await fs.writeFile(
    'artifacts/capacity.json',
    JSON.stringify(
      {
        seconds: 360,
        sampleRate: 48000,
        channels: 2,
        pcmBytes: byteLength,
        bytes: (await fs.stat(file)).size,
      },
      null,
      2,
    ),
  );
});

test('track drop rejects locked and incompatible layers without a partial time edit', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /제목 추가/ }).click();
  await page.getByRole('button', { name: '영상 1 잠금', exact: true }).click();
  const resizer = page.getByRole('separator', { name: '타임라인 높이', exact: true });
  for (let i = 0; i < 8; i++) await resizer.press('ArrowUp');
  const before = await saved(page);
  for (const [row, reason] of [
    [1, '대상 트랙이 잠겨'],
    [2, '영상은 시각 트랙'],
  ] as const) {
    await page.locator('.timeline-scroll').evaluate((el) => {
      el.scrollTop = 0;
    });
    const from = (await page.locator('.timeline-clip.text').boundingBox())!;
    const to = (await page.locator('.track-row').nth(row).boundingBox())!;
    await page.mouse.move(from.x + 50, from.y + 20);
    await page.mouse.down();
    await page.mouse.move(from.x + 65, to.y + 30, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('.toast')).toContainText(reason);
    expect((await saved(page)).clips).toEqual(before.clips);
  }
});

test('original reconnection: quota failure preserves edits and a later real save restores media', async ({
  page,
}) => {
  const samples = await importVideos(page);
  const before = await saved(page);
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('cyancut-local', 2);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('files', 'readwrite');
          tx.objectStore('files').clear();
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
  );
  await page.reload();
  await page.evaluate(() => {
    navigator.storage.estimate = async () => ({ quota: 1, usage: 1 });
  });
  const sample = samples[0];
  const original = {
    name: sample.name,
    mimeType: sample.mimeType,
    buffer: Buffer.from(sample.bytes),
  };
  await page.getByLabel('미디어 파일 선택').setInputFiles(original);
  await expect(page.locator('.import-progress')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('다시 열 때 원본 재연결이 필요');
  const failed = await saved(page);
  expect(failed.clips).toEqual(before.clips);
  expect(failed.assets.find((a) => a.name === sample.name)!.stored).toBe(false);
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  await page.reload();
  await page.getByLabel('미디어 파일 선택').setInputFiles(original);
  await expect(page.locator('.import-progress')).toHaveCount(0);
  const recovered = await saved(page);
  expect(recovered.clips).toEqual(before.clips);
  expect(recovered.assets.find((a) => a.name === sample.name)!.stored).toBe(true);
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  await page.reload();
  expect((await saved(page)).clips).toEqual(before.clips);
});

test.describe('mobile vertical track move', () => {
  test.use({ hasTouch: true, isMobile: true });
  test('a selected video moves upward by touch and keeps its linked audio', async ({ page }) => {
    await importVideos(page);
    const before = await saved(page);
    await page.getByRole('button', { name: '프로젝트 메뉴', exact: true }).click();
    await page.getByRole('button', { name: '앱 설정 · UI 모드', exact: true }).click();
    await page.getByRole('radio', { name: /모바일 모드/ }).check();
    await page.getByRole('button', { name: '편집 계속하기', exact: true }).click();
    await page.setViewportSize({ width: 768, height: 1024 });
    const resize = page.getByRole('separator', { name: '타임라인 높이', exact: true });
    for (let i = 0; i < 7; i++) await resize.press('ArrowUp');
    const clip = page.locator('.timeline-clip.video').first();
    await clip.tap();
    await expect(clip).toHaveClass(/clip-selected/);
    await page.locator('.timeline-scroll').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const from = (await clip.boundingBox())!;
    const to = (await page.locator('.track-row').first().boundingBox())!;
    const session = await page.context().newCDPSession(page);
    try {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: from.x + 45, y: from.y + 20, id: 1 }],
      });
      for (let i = 1; i <= 6; i++) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            { x: from.x + 45, y: from.y + 20 + ((to.y + 30 - from.y - 20) * i) / 6, id: 1 },
          ],
        });
        await page.evaluate(() => new Promise(requestAnimationFrame));
      }
      await expect(page.locator('.drop-ghost')).toHaveCount(1);
      await page.screenshot({ path: 'artifacts/track-touch-ghost.png' });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await session
        .send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
        .catch(() => {});
      await session.detach();
    }
    const after = await saved(page);
    const video = before.clips.find((c) => c.kind === 'video')!;
    expect(after.clips.find((c) => c.id === video.id)!.trackId).toBe(before.tracks[0].id);
    expect(after.clips.filter((c) => c.kind === 'audio')).toEqual(
      before.clips.filter((c) => c.kind === 'audio'),
    );
    await page.getByRole('button', { name: '실행 취소 (Ctrl/Cmd+Z)', exact: true }).tap();
    expect((await saved(page)).clips).toEqual(before.clips);
  });
});
