import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';

async function importVideo(page: Page) {
  const sample = await page.evaluate(async () => {
    const url = '/tests/fixtures.browser.ts';
    return (await import(/* @vite-ignore */ url))
      .makeFixtures()
      .then((rows: { name: string; mimeType: string; bytes: number[] }[]) => rows[0]);
  });
  await page.getByLabel('가져오면서 타임라인에 연속 배치').check();
  await page.getByLabel('미디어 파일 선택').setInputFiles({
    name: sample.name,
    mimeType: sample.mimeType,
    buffer: Buffer.from(sample.bytes),
  });
  await expect(page.locator('.timeline-clip')).toHaveCount(2);
  await expect(page.locator('.import-progress')).toHaveCount(0);
}
test('refactor: synchronous preview Worker failure is contained', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.Worker = new Proxy(window.Worker, {
      construct() {
        throw new Error('Worker 시작 실패 주입');
      },
    });
  });
  await page.goto('/');
  await expect(page.locator('.preview-error')).toContainText('Worker 시작 실패 주입');
  await expect(page.getByRole('button', { name: '파일 선택', exact: true })).toBeVisible();
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  expect(errors).toEqual([]);
});
test('refactor: export construction/send failures release Worker and allow real WAV retry', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await importVideo(page);
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByLabel('파일 형식').selectOption('wav');
  await page.evaluate(() => {
    const state = { mode: 'construct', terminated: 0 };
    Object.assign(window, { refactorWorker: state });
    window.Worker = new Proxy(window.Worker, {
      construct(target, args) {
        if (state.mode === 'construct') throw new Error('출력 Worker 시작 실패 주입');
        return Reflect.construct(target, args);
      },
    });
    const send = Worker.prototype.postMessage,
      stop = Worker.prototype.terminate;
    Worker.prototype.postMessage = function (data, options) {
      if (state.mode === 'send' && data.type === 'export')
        throw new DOMException('출력 전송 실패 주입', 'DataCloneError');
      return send.call(this, data, Array.isArray(options) ? { transfer: options } : options);
    };
    Worker.prototype.terminate = function () {
      state.terminated++;
      stop.call(this);
    };
  });
  const dialog = page.getByRole('dialog', { name: '내보내기', exact: true });
  await dialog.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(dialog.locator('.export-error')).toContainText('시작 실패 주입');
  await page.evaluate(
    () =>
      ((window as unknown as { refactorWorker: { mode: string } }).refactorWorker.mode = 'send'),
  );
  await dialog.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(dialog.locator('.export-error')).toContainText('전송 실패 주입');
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { refactorWorker: { terminated: number } }).refactorWorker.terminated,
    ),
  ).toBe(1);
  await page.evaluate(
    () => ((window as unknown as { refactorWorker: { mode: string } }).refactorWorker.mode = 'ok'),
  );
  await dialog.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByText('내보내기가 완료됐습니다.', { exact: true })).toBeVisible();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 다운로드', exact: true }).click();
  const bytes = await fs.readFile((await (await waiting).path())!);
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.length).toBeGreaterThan(100_000);
  await page.getByRole('button', { name: '편집으로 돌아가기', exact: true }).click();
  await expect(page.locator('.timeline-clip')).toHaveCount(2);
  expect(errors).toEqual([]);
});
test('refactor: custom canvas ratio remains saveable and survives recovery', async ({ page }) => {
  await page.goto('/');
  for (const name of ['가로 (px)', '세로 (px)']) {
    const field = page.getByRole('spinbutton', { name, exact: true });
    await field.fill('1920');
    await field.press('Enter');
  }
  await page.getByRole('button', { name: '16:9', exact: true }).click();
  await expect(page.locator('.preview-meta')).toContainText('1920 × 1080');
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  await page.reload();
  await expect(page.locator('.preview-meta')).toContainText('1920 × 1080');
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
});
test('refactor: linked locks cover preview transforms and solo-aware export preflight', async ({
  page,
}) => {
  await page.goto('/');
  await importVideo(page);
  await page.locator('.timeline-clip.video').click();
  await page.getByRole('button', { name: '원본 오디오 잠금', exact: true }).click();
  await expect(page.locator('.visual-selection')).toHaveClass(/selection-locked/);
  await expect(page.getByRole('button', { name: '클립 크기 조절 핸들', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: '크롭 핸들', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '텍스트 · 이미지 단독 재생', exact: true }).click();
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.locator('.export-preflight summary').click();
  await expect(page.locator('.export-preflight')).toContainText('영상 레이어가 없는 구간');
});
test('refactor: scene changes release inactive decoders before cache admission', async ({
  page,
}) => {
  await page.goto('/');
  const colors = await page.evaluate(async () => {
    const fixtureUrl = '/tests/fixtures.browser.ts',
      engineUrl = '/src/engine.ts',
      modelUrl = '/src/model.ts',
      mediaUrl = '/src/media.ts',
      renderUrl = '/src/render.ts';
    const { makeFixtures } = await import(/* @vite-ignore */ fixtureUrl),
      { inspect } = await import(/* @vite-ignore */ engineUrl),
      { emptyProject, addAsset, tick } = await import(/* @vite-ignore */ modelUrl),
      { MediaPool } = await import(/* @vite-ignore */ mediaUrl),
      { Renderer } = await import(/* @vite-ignore */ renderUrl);
    const samples = await makeFixtures(),
      pool = new MediaPool();
    const video = new File([new Uint8Array(samples[0].bytes)], samples[0].name, {
        type: samples[0].mimeType,
      }),
      image = new File([new Uint8Array(samples[2].bytes)], samples[2].name, {
        type: samples[2].mimeType,
      }),
      source = await inspect(video),
      overlay = await inspect(image);
    let p = { ...emptyProject(), width: 320, height: 180 };
    for (let i = 0; i < 12; i++) {
      const asset = { ...source, id: `source-${i}`, hasAudio: false };
      p = addAsset(p, asset, 0);
      pool.register(asset.id, video);
    }
    p = { ...p, clips: p.clips.map((c: { duration: number }) => ({ ...c, duration: tick(0.1) })) };
    p = addAsset(p, overlay, tick(0.1));
    pool.register(overlay.id, image);
    const renderer = new Renderer(pool, new OffscreenCanvas(320, 180));
    try {
      await renderer.render(p, 0);
      const beforePins = pool.pins.size;
      await renderer.render(p, tick(0.2));
      return {
        beforePins,
        afterPins: pool.pins.size,
        resources: pool.resources.size,
        pixel: Array.from(renderer.canvas.getContext('2d').getImageData(40, 90, 1, 1).data),
      };
    } finally {
      await renderer.close();
      pool.close();
    }
  });
  expect(colors.beforePins).toBe(12);
  expect(colors.afterPins).toBe(0);
  expect(colors.resources).toBeLessThanOrEqual(12);
  expect(colors.pixel[0]).toBeGreaterThan(200);
  expect(colors.pixel[1]).toBeGreaterThan(150);
  expect(colors.pixel[2]).toBeLessThan(100);
});
test('refactor: quick drag commits its final pointer position in one undo step', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /제목 추가/ }).click();
  const clip = page.locator('.timeline-clip.text'),
    box = (await clip.boundingBox())!;
  const zoom = Number(await page.getByLabel('타임라인 확대', { exact: true }).inputValue());
  await page.mouse.move(box.x + 50, box.y + 20);
  await page.mouse.down();
  await clip.evaluate(
    (el, point) => {
      // Deliver both events before the next animation frame, as a fast final motion can do.
      el.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 1,
          clientX: point.x,
          clientY: point.y,
          buttons: 1,
        }),
      );
      el.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 1,
          clientX: point.x,
          clientY: point.y,
          buttons: 0,
        }),
      );
    },
    { x: box.x + 50 + zoom, y: box.y + 20 },
  );
  await page.mouse.up();
  await expect(page.getByRole('spinbutton', { name: '시작 (초)', exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: '실행 취소 (Ctrl/Cmd+Z)', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '시작 (초)', exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: '다시 실행 (Ctrl/Cmd+Shift+Z)', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '시작 (초)', exact: true })).toHaveValue('1');
});
test('refactor: transition drops use the same undo path and reject unknown kinds', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /제목 추가/ }).click();
  await page.getByLabel('재생헤드 타임코드').fill('5');
  await page.getByLabel('재생헤드 타임코드').press('Enter');
  await page.getByRole('button', { name: /제목 추가/ }).click();
  await page.getByRole('button', { name: '전환', exact: true }).click();
  const target = page.locator('.timeline-clip.text[aria-label*="시작 5.00초"]');
  const invalid = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.setData('application/cyancut-transition', 'unknown');
    return data;
  });
  await target.dispatchEvent('drop', { dataTransfer: invalid });
  await expect(page.locator('.transition-marker')).toHaveCount(0);
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  const valid = await page.evaluateHandle(() => new DataTransfer());
  await page
    .getByRole('button', { name: '검정으로 페이드', exact: true })
    .dispatchEvent('dragstart', { dataTransfer: valid });
  await target.dispatchEvent('drop', { dataTransfer: valid });
  await expect(page.locator('.transition-marker')).toHaveCount(1);
  await page.getByRole('button', { name: '실행 취소 (Ctrl/Cmd+Z)', exact: true }).click();
  await expect(page.locator('.transition-marker')).toHaveCount(0);
  await page.getByRole('button', { name: '다시 실행 (Ctrl/Cmd+Shift+Z)', exact: true }).click();
  await expect(page.locator('.transition-marker')).toHaveCount(1);
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
});
