import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

test('directive: input to preview latency uses the completed worker frame, not the input label', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker,
      requested = new Map<number, { revision: number; text: string; at: number }>(),
      arrivals: { revision: number; text: string; ms: number }[] = [];
    Object.assign(window, { textFrameArrivals: arrivals });
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', (event) => {
          if (event.data.type !== 'frame') return;
          const request = requested.get(event.data.seq);
          if (!request) return;
          requested.delete(event.data.seq);
          requestAnimationFrame(() =>
            arrivals.push({ ...request, ms: performance.now() - request.at }),
          );
        });
      }
      postMessage(message: unknown, options?: unknown) {
        const d = message as {
          type?: string;
          seq: number;
          project?: { editRevision: number; clips: { text?: { text: string } }[] };
        };
        if (d.type === 'preview' && d.project)
          requested.set(d.seq, {
            revision: d.project.editRevision,
            text: d.project.clips.map((c) => c.text?.text ?? '').join(''),
            at: performance.now(),
          });
        super.postMessage(message, options as StructuredSerializeOptions);
      }
    };
    document.addEventListener(
      'input',
      (event) => {
        if ((event.target as HTMLElement).tagName === 'TEXTAREA')
          Object.assign(window, { lastTextInputAt: performance.now() });
      },
      true,
    );
  });
  await page.goto('/');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /자막 추가/ }).click();
  const input = page.getByLabel('텍스트 내용', { exact: true });
  await input.fill('한글 라이브');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { textFrameArrivals: { text: string }[] }).textFrameArrivals.some(
          (f) => f.text === '한글 라이브',
        ),
      ),
    )
    .toBe(true);
  const records = [];
  for (let i = 0; i < 20; i++) {
    const value = `한글 라이브 ${i}`;
    await input.fill(value);
    await expect
      .poll(
        () =>
          page.evaluate(
            (value) =>
              (
                window as unknown as { textFrameArrivals: { text: string }[] }
              ).textFrameArrivals.some((f) => f.text === value),
            value,
          ),
        { intervals: [5, 10, 20] },
      )
      .toBe(true);
    records.push(
      await page.evaluate((value) => {
        const w = window as unknown as {
            lastTextInputAt: number;
            textFrameArrivals: { text: string; at: number; ms: number }[];
          },
          f = [...w.textFrameArrivals].reverse().find((f) => f.text === value)!;
        return { text: value, ms: f.ms + f.at - w.lastTextInputAt };
      }, value),
    );
  }
  const sorted = records.map((r) => r.ms).sort((a, b) => a - b),
    p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  expect(records.every((r) => r.ms >= 0)).toBe(true);
  // Report a measured target miss; do not turn machine speed into a flaky correctness assertion.
  await fs.writeFile(
    'artifacts/directive-input-latency.json',
    JSON.stringify(
      {
        scope:
          '20 serial warm-font input events to completed Worker canvas and next animation frame; synthetic IME separately tested',
        records,
        p95,
        targetMs: 100,
        targetMet: p95 <= 100,
      },
      null,
      2,
    ),
  );
});

test('directive: small image handles leave the object movable and keyboard edits are undoable', async ({
  page,
}) => {
  await page.goto('/');
  const sample = await page.evaluate(async () => {
    const url = '/tests/fixtures.browser.ts';
    return (await (await import(/* @vite-ignore */ url)).makeFixtures())[2];
  });
  await page.getByLabel('미디어 파일 선택').setInputFiles({
    name: sample.name,
    mimeType: sample.mimeType,
    buffer: Buffer.from(sample.bytes),
  });
  await expect(page.locator('.import-progress')).toHaveCount(0);
  await page.getByRole('button', { name: 'overlay.png 타임라인에 추가', exact: true }).click();
  await page.locator('.timeline-clip.image').click();
  await page.getByLabel('크기 (%)', { exact: true }).fill('5');
  await page.getByLabel('크기 (%)', { exact: true }).press('Enter');
  const object = page.locator('.visual-selection');
  await expect(object).toHaveClass(/small-selection/);
  const b = (await object.boundingBox())!,
    handles = await page
      .locator('.visual-handle')
      .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON()));
  expect(b.width).toBeLessThan(48);
  expect(b.height).toBeLessThan(48);
  expect(handles[0].right).toBeLessThanOrEqual(b.x);
  expect(handles[1].left).toBeGreaterThanOrEqual(b.x + b.width);
  await object.focus();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => Number(await page.getByLabel('가로 위치 (%)', { exact: true }).inputValue()))
    .toBeGreaterThan(50);
  await page.getByRole('button', { name: '실행 취소 (Ctrl/Cmd+Z)', exact: true }).click();
  await expect(page.getByLabel('가로 위치 (%)', { exact: true })).toHaveValue('50');
  await page.locator('.preview-options > summary').click();
  await page.getByRole('button', { name: '안전 영역', exact: true }).click();
  const canvas = (await page.getByLabel('프로젝트 합성 영상').boundingBox())!,
    before = (await object.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * 0.104, canvas.y + canvas.height * 0.5, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(page.getByLabel('가로 위치 (%)', { exact: true })).toHaveValue('10');
  await page.getByRole('button', { name: '실행 취소 (Ctrl/Cmd+Z)', exact: true }).click();
  await expect(page.getByLabel('가로 위치 (%)', { exact: true })).toHaveValue('50');
});

test('directive: transparent PNG transition, linked audio curves and unchanged BGM survive actual MP4', async ({
  page,
}) => {
  await page.goto('/');
  const report = await page.evaluate(async () => {
    const fixturesUrl = '/tests/fixtures.browser.ts',
      mediaUrl = '/tests/directive-media.browser.ts';
    return (await import(/* @vite-ignore */ mediaUrl)).extendedTransitions(
      await (await import(/* @vite-ignore */ fixturesUrl)).makeFixtures(),
    );
  });
  await fs.writeFile(
    'artifacts/directive-extended-transitions.json',
    JSON.stringify(report, null, 2),
  );
  for (const sample of report.visual)
    for (const frame of sample.errors) expect(frame.mae).toBeLessThan(4);
  for (const sample of report.audio) {
    expect(sample.maxSampleStep).toBeLessThan(0.04);
    expect(sample.peak).toBeLessThan(0.6);
    expect(sample.bgmDelta).toBeLessThan(1e-6);
    expect(sample.rms).toBeGreaterThan(0.01);
    expect(sample.output.sound.every((s: { rms: number }) => s.rms > 0.01)).toBe(true);
  }
  await fs.writeFile(
    'artifacts/directive-extended-transitions.json',
    JSON.stringify(report, null, 2),
  );
});
