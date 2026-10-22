import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

test('stability: unreadable analysis messages release queue slots and the next real import succeeds', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const fixtureUrl = '/tests/fixtures.browser.ts',
      engineUrl = '/src/engine.ts';
    const source = (await (await import(/* @vite-ignore */ fixtureUrl)).makeFixtures())[0];
    const { inspect } = await import(/* @vite-ignore */ engineUrl);
    const file = new File([new Uint8Array(source.bytes)], source.name, { type: source.mimeType });
    const send = Worker.prototype.postMessage;
    let failures = 0;
    Worker.prototype.postMessage = function (data, options) {
      if (data.type === 'probe' && failures++ < 2) {
        setTimeout(() => this.onmessageerror?.call(this, new MessageEvent('messageerror')), 0);
        return;
      }
      return send.call(this, data, Array.isArray(options) ? { transfer: options } : options);
    };
    try {
      const results = await Promise.allSettled([inspect(file), inspect(file), inspect(file)]);
      return results.map((r) =>
        r.status === 'fulfilled'
          ? { status: r.status, codec: r.value.videoCodec }
          : { status: r.status, code: r.reason.code },
      );
    } finally {
      Worker.prototype.postMessage = send;
    }
  });
  expect(result).toEqual([
    { status: 'rejected', code: 'WORKER_MESSAGE' },
    { status: 'rejected', code: 'WORKER_MESSAGE' },
    { status: 'fulfilled', codec: 'avc' },
  ]);
});

test('stability: rotated 4K 60fps SDR input survives linked split, reload and 1080p30 MP4 export', async ({
  page,
}) => {
  await page.goto('/');
  const fixture = await page.evaluate(async () => {
    const url = '/tests/e2e/stability.browser.ts';
    return (await import(/* @vite-ignore */ url)).rotated4k60();
  });
  await page.getByLabel('가져오면서 타임라인에 연속 배치').check();
  await page.getByLabel('미디어 파일 선택').setInputFiles({
    name: fixture.name,
    mimeType: fixture.mimeType,
    buffer: Buffer.from(fixture.bytes),
  });
  await expect(page.locator('.timeline-clip')).toHaveCount(2);
  await expect(page.locator('.import-progress')).toHaveCount(0);
  await page.getByRole('button', { name: '9:16', exact: true }).click();
  await page.locator('.current-time').fill('1');
  await page.locator('.current-time').press('Enter');
  await page.locator('.timeline-clip.video').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('s');
  await expect(page.locator('.timeline-clip')).toHaveCount(4);
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  await page.reload();
  await expect(page.locator('.timeline-clip')).toHaveCount(4);
  await expect(page.locator('.canvas-wrap')).toHaveAttribute('aria-busy', 'false');
  const previewColors = await page.locator('.canvas-wrap canvas').evaluate((c: HTMLCanvasElement) =>
    [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ].map(([x, y]) =>
      Array.from(
        c.getContext('2d')!.getImageData(Math.round(c.width * x), Math.round(c.height * y), 1, 1)
          .data,
      ),
    ),
  );
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByLabel('파일 형식').selectOption('mp4');
  const started = Date.now();
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByText('내보내기가 완료됐습니다.')).toBeVisible({ timeout: 120000 });
  const exportMs = Date.now() - started;
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 다운로드', exact: true }).click();
  const bytes = Array.from(await fs.readFile((await (await waiting).path())!));
  const result = await page.evaluate(async (bytes) => {
    const url = '/tests/e2e/stability.browser.ts';
    return (await import(/* @vite-ignore */ url)).analyzeRotated(bytes);
  }, bytes);
  expect([result.width, result.height]).toEqual([1080, 1920]);
  expect(result.codec).toBe('avc');
  expect(result.audioCodec).toBe('aac');
  expect(result.duration).toBeGreaterThanOrEqual(2);
  expect(result.duration).toBeLessThan(2.06);
  expect(Math.abs(result.videoDuration - result.audioDuration)).toBeLessThan(1 / 30);
  expect(result.rms).toBeGreaterThan(0.05);
  const expected = [
    [50, 50, 200],
    [200, 50, 50],
    [200, 200, 50],
    [50, 200, 50],
  ];
  for (const colors of [
    previewColors,
    ...result.frames.map((f: { colors: number[][] }) => f.colors),
  ])
    colors.forEach((color: number[], i: number) =>
      expected[i].forEach((value, c) => expect(Math.abs(color[c] - value)).toBeLessThan(12)),
    );
  for (const frame of result.frames)
    expect(frame.timestamp).toBeCloseTo(Math.floor(frame.timestamp * 30 + 0.0001) / 30, 5);
  await fs.writeFile(
    'artifacts/stability-4k60.json',
    JSON.stringify(
      {
        scope: 'Synthetic 2-second SDR AVC/AAC; not a camera/phone/HDR or sustained-load test',
        input: { width: 3840, height: 2160, fps: 60, rotation: 90 },
        exportMs,
        bytes: bytes.length,
        previewColors,
        ...result,
      },
      null,
      2,
    ),
  );
});

test('stability: a failed obsolete preview cannot strand the newest real frame', async ({
  page,
}) => {
  await page.route('**/src/engine.worker.ts?worker_file*', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const marker = 'await renderer.render(p, data.time);';
    expect(body).toContain(marker);
    await route.fulfill({
      response,
      body: body.replace(
        marker,
        `if(data.seq === 101) { await new Promise(r => setTimeout(r, 150)); throw new Error('obsolete decode failure'); }\n${marker}`,
      ),
    });
  });
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const fixtureUrl = '/tests/fixtures.browser.ts',
      engineUrl = '/src/engine.ts',
      modelUrl = '/src/model.ts';
    const samples = await (await import(/* @vite-ignore */ fixtureUrl)).makeFixtures();
    const engine = await import(/* @vite-ignore */ engineUrl),
      model = await import(/* @vite-ignore */ modelUrl);
    const source = samples[0];
    const file = new File([new Uint8Array(source.bytes)], source.name, { type: source.mimeType });
    const asset = await engine.inspect(file);
    const project = model.addAsset(model.emptyProject(), asset, 0);
    const worker: Worker = engine.createEngine();
    return new Promise<{ errors: number[]; frame: number; pixel: number[] }>((resolve, reject) => {
      const errors: number[] = [];
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error('newest frame stranded after old failure'));
      }, 4000);
      worker.onmessage = (event) => {
        const d = event.data;
        if (d.type === 'preview-error') errors.push(d.seq);
        if (d.type === 'frame') {
          const canvas = new OffscreenCanvas(d.bitmap.width, d.bitmap.height);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(d.bitmap, 0, 0);
          d.bitmap.close();
          const pixel = Array.from(ctx.getImageData(20, 20, 1, 1).data);
          clearTimeout(timeout);
          worker.terminate();
          resolve({ errors, frame: d.seq, pixel });
        }
      };
      worker.postMessage({ type: 'file', id: asset.id, file });
      worker.postMessage({ type: 'preview', project, time: 0, width: 320, seq: 101 });
      setTimeout(
        () => worker.postMessage({ type: 'preview', project, time: 500000, width: 320, seq: 102 }),
        60,
      );
    });
  });
  expect(result.errors).toEqual([101]);
  expect(result.frame).toBe(102);
  expect(result.pixel[0]).toBeGreaterThan(result.pixel[2] + 100);
});

test('stability: stalled export and message decoding failure release the worker and preserve a real retry', async ({
  page,
}) => {
  await page.goto('/');
  const source = await page.evaluate(async () => {
    const url = '/tests/fixtures.browser.ts';
    return (await (await import(/* @vite-ignore */ url)).makeFixtures())[0];
  });
  await page.getByLabel('가져오면서 타임라인에 연속 배치').check();
  await page.getByLabel('미디어 파일 선택').setInputFiles({
    name: source.name,
    mimeType: source.mimeType,
    buffer: Buffer.from(source.bytes),
  });
  await expect(page.locator('.timeline-clip')).toHaveCount(2);
  await expect(page.locator('.import-progress')).toHaveCount(0);
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByLabel('파일 형식').selectOption('wav');
  await page.clock.install();
  await page.evaluate(() => {
    const state = { mode: 'hang', terminated: 0 };
    Object.assign(window, { stabilityExport: state });
    const send = Worker.prototype.postMessage,
      stop = Worker.prototype.terminate;
    Worker.prototype.postMessage = function (data, options) {
      if (data.type === 'export' && state.mode !== 'normal') {
        if (state.mode === 'clone')
          this.onmessageerror?.call(this, new MessageEvent('messageerror'));
        return;
      }
      return send.call(this, data, Array.isArray(options) ? { transfer: options } : options);
    };
    Worker.prototype.terminate = function () {
      state.terminated++;
      stop.call(this);
    };
  });
  const dialog = page.getByRole('dialog', { name: '내보내기', exact: true });
  await dialog.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.clock.fastForward(121000);
  await expect(dialog.locator('.export-error')).toContainText('120초');
  await page.evaluate(
    () =>
      ((window as unknown as { stabilityExport: { mode: string } }).stabilityExport.mode = 'clone'),
  );
  await dialog.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(dialog.locator('.export-error')).toContainText('결과를 읽지 못');
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { stabilityExport: { terminated: number } }).stabilityExport
          .terminated,
    ),
  ).toBe(2);
  await page.evaluate(
    () =>
      ((window as unknown as { stabilityExport: { mode: string } }).stabilityExport.mode =
        'normal'),
  );
  await dialog.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByText('내보내기가 완료됐습니다.')).toBeVisible();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 다운로드', exact: true }).click();
  const bytes = await fs.readFile((await (await waiting).path())!);
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.length).toBeGreaterThan(100000);
  await page.getByRole('button', { name: '편집으로 돌아가기', exact: true }).click();
  await expect(page.locator('.timeline-clip')).toHaveCount(2);
});
