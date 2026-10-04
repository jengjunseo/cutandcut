import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';

async function title(page: Page) {
  await page.goto('/');
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  if (await page.locator('.mobile-navigation').isVisible())
    await page
      .locator('.mobile-navigation')
      .getByRole('button', { name: '미디어', exact: true })
      .click();
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /제목 추가/ }).click();
}

test('editing regression: released pointer capture cannot resurrect a deleted track', async ({
  page,
}) => {
  await title(page);
  const clip = page.locator('.timeline-clip.text');
  const b = (await clip.boundingBox())!;
  await page.mouse.move(b.x + 50, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 100, b.y + 20);
  await clip.evaluate((el) => el.releasePointerCapture(1));
  await page.mouse.move(100, 100);
  await page.mouse.up();
  await page.getByRole('button', { name: '텍스트 · 이미지 트랙 삭제', exact: true }).click();
  await expect(page.locator('.timeline-clip')).toHaveCount(0);
  await expect(page.locator('.track-row')).toHaveCount(3);
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  await page.reload();
  await expect(page.locator('.track-row')).toHaveCount(3);
});

test('editing regression: copy and paste work with a Korean keyboard layout', async ({ page }) => {
  await title(page);
  await page.locator('.timeline-clip.text').click({ position: { x: 50, y: 20 } });
  await page
    .locator('.timeline-clip.text')
    .dispatchEvent('keydown', { key: 'ㅊ', code: 'KeyC', ctrlKey: true });
  await page.getByLabel('재생헤드 타임코드').fill('5');
  await page.getByLabel('재생헤드 타임코드').press('Enter');
  await page.getByRole('region', { name: '편집 타임라인', exact: true }).focus();
  await page
    .getByRole('region', { name: '편집 타임라인', exact: true })
    .dispatchEvent('keydown', { key: 'ㅍ', code: 'KeyV', ctrlKey: true });
  await expect(page.locator('.timeline-clip.text')).toHaveCount(2);
});

test('editing regression: track deletion survives an unchanged property field blur', async ({
  page,
}) => {
  await title(page);
  await page.getByRole('spinbutton', { name: '시작 (초)', exact: true }).focus();
  await page.getByRole('button', { name: '텍스트 · 이미지 트랙 삭제', exact: true }).click();
  await expect(page.locator('.timeline-clip')).toHaveCount(0);
  await expect(page.locator('.track-row')).toHaveCount(3);
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
});

test('Shotcut: physical S/X/Z, clipboard buttons and undo preserve actual edits', async ({
  page,
}) => {
  await title(page);
  await page.getByLabel('재생헤드 타임코드').fill('2');
  await page.getByLabel('재생헤드 타임코드').press('Enter');
  const timeline = page.getByRole('region', { name: '편집 타임라인', exact: true });
  await timeline.focus();
  await timeline.dispatchEvent('keydown', { key: 'ㄴ', code: 'KeyS' });
  await expect(page.locator('.timeline-clip.text')).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: '스냅 (Ctrl/Cmd+P)', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await timeline.dispatchEvent('keydown', { key: 'ㅌ', code: 'KeyX' });
  await expect(page.locator('.timeline-clip.text')).toHaveCount(1);
  await expect(page.locator('.timeline-clip.text')).toHaveAttribute(
    'aria-label',
    /시작 0.00초 · 길이 3.00초/,
  );
  await page.keyboard.press('Control+z');
  await expect(page.locator('.timeline-clip.text')).toHaveCount(2);
  await page.keyboard.press('Control+y');
  await expect(page.locator('.timeline-clip.text')).toHaveCount(1);
  await page.locator('.timeline-clip.text').click({ position: { x: 50, y: 20 } });
  await page.getByRole('button', { name: '복사 (C / Ctrl/Cmd+C)', exact: true }).click();
  await page.getByLabel('재생헤드 타임코드').fill('3');
  await page.getByLabel('재생헤드 타임코드').press('Enter');
  await page.getByRole('button', { name: '붙여넣기 (Ctrl/Cmd+V)', exact: true }).click();
  await expect(page.locator('.timeline-clip.text')).toHaveCount(2);
  await page.keyboard.press('z');
  await expect(page.locator('.timeline-clip.text')).toHaveCount(1);
  await expect(page.locator('.timeline-clip.text')).toHaveAttribute('aria-label', /길이 3.00초/);
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
});

test('Shotcut: track keys, scoped trims, input protection and paste menu are consistent', async ({
  page,
}) => {
  await title(page);
  const timeline = page.getByRole('region', { name: '편집 타임라인', exact: true });
  await timeline.focus();
  await page.keyboard.press('Control+i');
  await expect(page.locator('.track-row')).toHaveCount(5);
  await page.keyboard.press('Control+l');
  await expect(page.locator('.track-active')).toHaveClass(/track-locked/);
  await page.keyboard.press('Control+l');
  await page.keyboard.press('Control+Alt+u');
  await expect(page.locator('.track-row')).toHaveCount(4);
  await page.locator('.timeline-clip.text').click({ position: { x: 50, y: 20 } });
  await page.keyboard.press('c');
  await page.getByLabel('재생헤드 타임코드').fill('2');
  await page.getByLabel('재생헤드 타임코드').press('Enter');
  await timeline.focus();
  await page.keyboard.press('i');
  await expect(page.getByRole('spinbutton', { name: '시작 (초)', exact: true })).toHaveValue('2');
  await expect(page.getByRole('spinbutton', { name: '길이 (초)', exact: true })).toHaveValue('3');
  await page.getByLabel('텍스트 내용').fill('s x z c 한글');
  await page
    .getByLabel('텍스트 내용')
    .dispatchEvent('keydown', { key: 'ㄴ', code: 'KeyS', isComposing: true });
  await page.getByLabel('텍스트 내용').press('Tab');
  await expect(page.locator('.timeline-clip.text')).toHaveCount(1);
  await page.getByRole('button', { name: '붙여넣기 방식', exact: true }).click();
  await expect(page.getByRole('button', { name: '삽입 (V)', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: '끝에 추가 (A)', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.timeline-clip.text')).toHaveCount(2);
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
});

test('Shotcut: linked S/X/C/V edits persist and produce a real playable MP4', async ({ page }) => {
  await page.goto('/');
  const fixture = await page.evaluate(async () => {
    const url = '/tests/fixtures.browser.ts';
    return (await import(/* @vite-ignore */ url)).makeFixtures().then((rows: any[]) => rows[0]);
  });
  await page.getByLabel('가져오면서 타임라인에 연속 배치').check();
  await page.getByLabel('미디어 파일 선택').setInputFiles({
    name: fixture.name,
    mimeType: fixture.mimeType,
    buffer: Buffer.from(fixture.bytes),
  });
  await expect(page.locator('.timeline-clip')).toHaveCount(2);
  await expect(page.locator('.import-progress')).toHaveCount(0);
  await page.locator('.timeline-clip.video').click({ position: { x: 50, y: 20 } });
  await page.getByLabel('재생헤드 타임코드').fill('1');
  await page.getByLabel('재생헤드 타임코드').press('Enter');
  const timeline = page.getByRole('region', { name: '편집 타임라인', exact: true });
  await timeline.focus();
  await page.keyboard.press('s');
  await expect(page.locator('.timeline-clip')).toHaveCount(4);
  await page.keyboard.press('x');
  await expect(page.locator('.timeline-clip')).toHaveCount(2);
  await page.locator('.timeline-clip.video').click({ position: { x: 50, y: 20 } });
  await page.keyboard.press('c');
  await page.keyboard.press('End');
  await page.keyboard.press('v');
  await expect(page.locator('.timeline-clip')).toHaveCount(4);
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  await page.reload();
  await expect(page.locator('.timeline-clip')).toHaveCount(4);
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
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 다운로드', exact: true }).click();
  const file = await (await wait).path();
  const bytes = Array.from(await fs.readFile(file!));
  const report = await page.evaluate(async (bytes) => {
    const url = '/node_modules/mediabunny/dist/modules/src/index.js';
    const { Input, ALL_FORMATS, BufferSource, AudioSampleSink } = await import(
      /* @vite-ignore */ url
    );
    const input = new Input({
      source: new BufferSource(new Uint8Array(bytes)),
      formats: ALL_FORMATS,
    });
    try {
      const audio = await input.getPrimaryAudioTrack();
      let energy = false;
      for await (const sample of new AudioSampleSink(audio!).samples(0, 1)) {
        const data = new Float32Array(sample.numberOfFrames);
        sample.copyTo(data, { format: 'f32-planar', planeIndex: 0 });
        energy ||= data.some((n: number) => Math.abs(n) > 0.01);
        sample.close();
      }
      return { energy, audioCodec: audio?.codec, userAgent: navigator.userAgent };
    } finally {
      input.dispose();
    }
  }, bytes);
  expect(report.energy).toBe(true);
  expect(report.audioCodec).toBe('aac');
  await fs.writeFile(
    'artifacts/shortcuts-output.json',
    JSON.stringify({ ...metadata, ...report, bytes: bytes.length }, null, 2),
  );
});

test('Shotcut: expanded shortcut help stays readable at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto('/');
  await page.getByRole('button', { name: '프로젝트 메뉴', exact: true }).click();
  await page.getByRole('button', { name: '단축키 도움말', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '키보드 단축키' });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(dialog.getByText('Shotcut 공식 단축키', { exact: true })).toHaveAttribute(
    'href',
    'https://shotcut.org/howtos/keyboard-shortcuts/',
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: '프로젝트 메뉴', exact: true })).toBeFocused();
});

test('Shotcut: clipboard tools remain reachable on a compact touch screen', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 760 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await title(page);
  for (const label of ['복사 (C / Ctrl/Cmd+C)', '붙여넣기 (Ctrl/Cmd+V)', '스냅 (Ctrl/Cmd+P)']) {
    const box = (await page.getByRole('button', { name: label, exact: true }).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(321);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button', { name: '복사 (C / Ctrl/Cmd+C)', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '붙여넣기 (Ctrl/Cmd+V)', exact: true }),
  ).toBeEnabled();
  await context.close();
});
