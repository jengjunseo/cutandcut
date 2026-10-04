import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import type { Project } from '../../src/model';

async function projectFile(page: Page): Promise<Project> {
  await page.getByRole('region', { name: '편집 타임라인', exact: true }).focus();
  const waiting = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const file = await (await waiting).path();
  return JSON.parse(await fs.readFile(file!, 'utf8'));
}

async function seek(page: Page, time: string) {
  await page.getByLabel('재생헤드 타임코드').fill(time);
  await page.getByLabel('재생헤드 타임코드').press('Enter');
  await page.getByRole('region', { name: '편집 타임라인', exact: true }).focus();
}

test('caption paste: keyboard, button and V preserve underlying media, undo, recovery and MP4', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const analyzer = await context.newPage();
  await analyzer.goto('http://localhost:5174');
  const fixture = await analyzer.evaluate(async () => {
    const url = '/tests/fixtures.browser.ts';
    return (await import(/* @vite-ignore */ url)).makeFixtures().then((rows: any[]) => rows[0]);
  });
  await page.goto('/');
  await page.getByLabel('가져오면서 타임라인에 연속 배치').check();
  await page.getByLabel('미디어 파일 선택').setInputFiles({
    name: fixture.name,
    mimeType: fixture.mimeType,
    buffer: Buffer.from(fixture.bytes),
  });
  await expect(page.locator('.timeline-clip')).toHaveCount(2);
  await expect(page.locator('.import-progress')).toHaveCount(0);
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /자막 추가/ }).click();
  await page.getByLabel('텍스트 내용').fill('복사해도 영상은 그대로\n한글 두 줄 자막');
  await page.getByLabel('텍스트 내용').press('Tab');
  await page.getByRole('spinbutton', { name: '길이 (초)', exact: true }).fill('0.5');
  await page.getByRole('spinbutton', { name: '길이 (초)', exact: true }).press('Tab');
  const before = await projectFile(page);
  const media = before.clips.filter((c) => c.kind !== 'text');
  await page.locator('.timeline-clip.text').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('Control+c');
  await page.locator('.timeline-clip.video').click({ position: { x: 50, y: 20 } });
  await seek(page, '0.2');
  await page.keyboard.press('Control+v');
  await expect(page.locator('.timeline-clip.text')).toHaveCount(2);
  await seek(page, '1');
  await page.getByRole('button', { name: '붙여넣기 (Ctrl/Cmd+V)', exact: true }).click();
  await expect(page.locator('.timeline-clip.text')).toHaveCount(3);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.timeline-clip.text')).toHaveCount(2);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.timeline-clip.text')).toHaveCount(3);
  await seek(page, '1.5');
  await page.keyboard.press('v');
  await expect(page.locator('.timeline-clip.text')).toHaveCount(4);
  const after = await projectFile(page);
  expect(after.clips.filter((c) => c.kind !== 'text')).toEqual(media);
  expect(after.clips.filter((c) => before.clips.some((original) => original.id === c.id))).toEqual(
    before.clips,
  );
  expect(after.clips.filter((c) => c.kind === 'text').map((c) => c.start)).toEqual([
    0, 200000, 1000000, 1500000,
  ]);
  const captions = after.clips.filter((c) => c.kind === 'text');
  expect(captions[1].trackId).not.toBe(captions[0].trackId);
  expect(captions[1].trackId).not.toBe(media.find((c) => c.kind === 'video')!.trackId);
  expect(
    after.clips
      .filter((c) => c.kind === 'text')
      .every((c) => c.text?.text === before.clips.find((c) => c.kind === 'text')!.text!.text),
  ).toBe(true);
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  await page.reload();
  await expect(page.locator('.timeline-clip.text')).toHaveCount(4);
  const restored = await projectFile(page);
  expect(restored.clips).toEqual(after.clips);
  await expect(page.locator('.timeline-clip.video')).toHaveCount(1);
  await expect(page.locator('.timeline-clip.audio')).toHaveCount(1);
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByLabel('파일 형식').selectOption('mp4');
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByText('내보내기가 완료됐습니다.')).toBeVisible();
  await expect
    .poll(() => page.locator('.output-player').evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  const metadata = await page.locator('.output-player').evaluate((v: HTMLVideoElement) => ({
    width: v.videoWidth,
    height: v.videoHeight,
    duration: v.duration,
  }));
  expect(metadata.duration).toBeCloseTo(2, 1);
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 다운로드', exact: true }).click();
  const file = await (await waiting).path();
  const bytes = Array.from(await fs.readFile(file!));
  const analysis = await analyzer.evaluate(async (bytes) => {
    const url = '/node_modules/mediabunny/dist/modules/src/index.js';
    const { Input, ALL_FORMATS, BufferSource, AudioSampleSink, CanvasSink } = await import(
      /* @vite-ignore */ url
    );
    const input = new Input({
      source: new BufferSource(new Uint8Array(bytes)),
      formats: ALL_FORMATS,
    });
    try {
      const audio = await input.getPrimaryAudioTrack();
      const video = await input.getPrimaryVideoTrack();
      const frames = new CanvasSink(video!, { poolSize: 1 });
      const pixels: number[][] = [];
      for (const time of [0.25, 0.75, 1.25, 1.75]) {
        const frame = (await frames.getCanvas(time))!;
        const data: Uint8ClampedArray = frame.canvas
          .getContext('2d')!
          .getImageData(10, 10, 1, 1).data;
        pixels.push(Array.from(data));
      }
      let energy = false;
      for await (const sample of new AudioSampleSink(audio!).samples(1, 1.5)) {
        const data = new Float32Array(sample.numberOfFrames);
        sample.copyTo(data, { format: 'f32-planar', planeIndex: 0 });
        energy ||= data.some((n: number) => Math.abs(n) > 0.01);
        sample.close();
      }
      return { energy, audioCodec: audio?.codec, pixels, userAgent: navigator.userAgent };
    } finally {
      input.dispose();
    }
  }, bytes);
  expect(analysis.energy).toBe(true);
  expect(analysis.audioCodec).toBe('aac');
  for (const pixel of analysis.pixels) {
    expect(pixel[0]).toBeGreaterThan(150);
    expect(pixel[0] - pixel[1]).toBeGreaterThan(80);
  }
  expect(errors).toEqual([]);
  await fs.mkdir('artifacts', { recursive: true });
  await fs.writeFile(
    'artifacts/caption-paste-output.json',
    JSON.stringify(
      {
        ...metadata,
        ...analysis,
        bytes: bytes.length,
        mediaUnchanged: true,
        captions: 4,
        errors,
      },
      null,
      2,
    ),
  );
  await analyzer.close();
});
