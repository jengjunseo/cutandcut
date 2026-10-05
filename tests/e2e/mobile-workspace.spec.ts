import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import type { Project } from '../../src/model';

async function number(page: Page, label: string, value: string) {
  const field = page.getByRole('spinbutton', { name: label, exact: true });
  await field.fill(value);
  await field.press('Enter');
}

async function properties(page: Page, id: string) {
  await page.locator('.mobile-dock').getByRole('button', { name: '속성', exact: true }).tap();
  await page.getByLabel('속성에서 클립 선택').selectOption(id);
}

async function more(page: Page, name: string) {
  await page.locator('.mobile-dock').getByRole('button', { name: '더보기', exact: true }).tap();
  await page.getByRole('button', { name, exact: true }).tap();
  await closePanel(page);
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('mobile real files: cuts, layers, transition, music, caption paste, recovery and portrait MP4', async ({
  page,
  context,
}) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const analyzer = await context.newPage();
  await analyzer.goto('http://localhost:5174');
  const samples = await analyzer.evaluate(async () => {
    const url = '/tests/fixtures.browser.ts';
    return (await import(/* @vite-ignore */ url)).makeFixtures();
  });
  await mobileMode(page);
  await page.locator('.mobile-dock').getByRole('button', { name: '미디어', exact: true }).tap();
  await page.getByLabel('가져오면서 타임라인에 연속 배치').check();
  await page.getByLabel('미디어 파일 선택').setInputFiles(
    samples.map((sample: { name: string; mimeType: string; bytes: number[] }) => ({
      name: sample.name,
      mimeType: sample.mimeType,
      buffer: Buffer.from(sample.bytes),
    })),
  );
  await expect(page.locator('.asset-card')).toHaveCount(4);
  await expect(page.locator('.import-progress')).toHaveCount(0);
  await closePanel(page);
  let project = await projectFile(page);
  await properties(page, project.clips.find((c) => c.kind === 'video')!.id);
  await closePanel(page);
  await seek(page, '1');
  await page
    .locator('.mobile-clip-actions')
    .getByRole('button', { name: '분할', exact: true })
    .tap();
  await expect(page.locator('.timeline-clip.video')).toHaveCount(3);
  await page.getByRole('button', { name: '실행 취소 (Ctrl/Cmd+Z)', exact: true }).tap();
  await expect(page.locator('.timeline-clip.video')).toHaveCount(2);
  await page.getByRole('button', { name: '다시 실행 (Ctrl/Cmd+Shift+Z)', exact: true }).tap();
  project = await projectFile(page);
  await properties(
    page,
    project.clips.find((c) => c.kind === 'video' && c.name === 'first.mp4' && c.start === 1000000)!
      .id,
  );
  await closePanel(page);
  await page.locator('.mobile-dock').getByRole('button', { name: '미디어', exact: true }).tap();
  await page.locator('.library-tabs').getByRole('button', { name: '전환', exact: true }).tap();
  await page.getByRole('spinbutton', { name: '전환 길이 (초)', exact: true }).fill('0.3');
  await page.getByRole('button', { name: '크로스 디졸브', exact: true }).tap();
  await closePanel(page);
  await properties(page, project.clips.find((c) => c.kind === 'image')!.id);
  await number(page, '크기 (%)', '30');
  await number(page, '가로 위치 (%)', '70');
  await number(page, '세로 위치 (%)', '30');
  await closePanel(page);
  await properties(
    page,
    project.clips.find((c) => c.kind === 'audio' && c.name === 'music.wav')!.id,
  );
  const volume = page.getByRole('slider', { name: /볼륨/ });
  await volume.scrollIntoViewIfNeeded();
  const slider = (await volume.boundingBox())!;
  await touchDrag(
    page,
    { x: slider.x + slider.width * 0.5, y: slider.y + slider.height / 2 },
    { x: slider.x + slider.width * 0.3, y: slider.y + slider.height / 2 },
  );
  await number(page, '페이드 인 (초)', '0.3');
  await number(page, '페이드 아웃 (초)', '0.3');
  await closePanel(page);
  await seek(page, '1');
  await page.locator('.mobile-dock').getByRole('button', { name: '텍스트', exact: true }).tap();
  await page.getByRole('button', { name: /자막 추가/ }).tap();
  await page.getByLabel('텍스트 내용').fill('모바일로 완성\n영상은 그대로');
  await number(page, '길이 (초)', '2');
  await closePanel(page);
  const beforePaste = await projectFile(page);
  await more(page, '복사 (C / Ctrl/Cmd+C)');
  await seek(page, '3');
  await more(page, '붙여넣기 (Ctrl/Cmd+V)');
  await expect(page.locator('.timeline-clip.text')).toHaveCount(2);
  await page.getByRole('button', { name: '실행 취소 (Ctrl/Cmd+Z)', exact: true }).tap();
  await expect(page.locator('.timeline-clip.text')).toHaveCount(1);
  await page.getByRole('button', { name: '다시 실행 (Ctrl/Cmd+Shift+Z)', exact: true }).tap();
  await expect(page.locator('.timeline-clip.text')).toHaveCount(2);
  await page.locator('.mobile-dock').getByRole('button', { name: '화면', exact: true }).tap();
  await page.getByRole('button', { name: '9:16', exact: true }).tap();
  await closePanel(page);
  project = await projectFile(page);
  expect(project.clips.filter((c) => c.kind !== 'text')).toEqual(
    beforePaste.clips.filter((c) => c.kind !== 'text'),
  );
  expect(project.clips.some((c) => c.transition?.kind === 'dissolve')).toBe(true);
  const music = project.clips.find((c) => c.name === 'music.wav')!;
  expect(music.volume).toBeLessThan(0.8);
  expect(music.fadeIn).toBe(300000);
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  await page.reload();
  await expect(page.locator('.timeline-clip.text')).toHaveCount(2);
  expect((await projectFile(page)).clips).toEqual(project.clips);
  await seek(page, '1.5');
  await expect
    .poll(async () => (await page.getByLabel('프로젝트 합성 영상').boundingBox())?.height ?? 0)
    .toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/mobile/editing.png' });
  await page.getByRole('button', { name: '내보내기', exact: true }).tap();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByLabel('파일 형식').selectOption('mp4');
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).tap();
  await expect(page.getByText('내보내기가 완료됐습니다.')).toBeVisible({ timeout: 120000 });
  await expect
    .poll(() => page.locator('.output-player').evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  const metadata = await page.locator('.output-player').evaluate((v: HTMLVideoElement) => ({
    width: v.videoWidth,
    height: v.videoHeight,
    duration: v.duration,
  }));
  expect(metadata.width).toBe(720);
  expect(metadata.height).toBe(1280);
  expect(metadata.duration).toBeCloseTo(6, 1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 다운로드', exact: true }).tap();
  const bytes = Array.from(await fs.readFile((await (await download).path())!));
  const analysis = await analyzer.evaluate(
    async ({ bytes, project, samples }) => {
      const engineUrl = '/src/engine.ts',
        parityUrl = '/tests/e2e/parity.browser.ts';
      const { files } = await import(/* @vite-ignore */ engineUrl);
      for (const asset of project.assets) {
        const sample = samples.find((s: { name: string }) => s.name === asset.name)!;
        files.set(
          asset.id,
          new File([new Uint8Array(sample.bytes)], sample.name, { type: sample.mimeType }),
        );
      }
      const { compareOutput, audioCuts } = await import(/* @vite-ignore */ parityUrl);
      return {
        frames: await compareOutput(project, bytes),
        audio: await audioCuts(bytes),
        userAgent: navigator.userAgent,
      };
    },
    { bytes, project, samples },
  );
  for (const frame of analysis.frames) expect(frame.mae).toBeLessThan(15);
  expect(
    analysis.audio.some((a: { amplitudes: number[] }) => a.amplitudes.some((v) => v > 0.01)),
  ).toBe(true);
  expect(errors).toEqual([]);
  await fs.mkdir('artifacts/mobile', { recursive: true });
  await fs.writeFile(
    'artifacts/mobile/output.json',
    JSON.stringify(
      { ...metadata, ...analysis, bytes: bytes.length, errors, captionPastePreservesMedia: true },
      null,
      2,
    ),
  );
  await analyzer.close();
});

async function mobileMode(page: Page) {
  await page.goto('/');
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  await page.getByRole('button', { name: '프로젝트 메뉴', exact: true }).click();
  await page.getByRole('button', { name: '앱 설정 · UI 모드', exact: true }).click();
  await page.getByRole('radio', { name: /모바일 모드/ }).check();
  await page.getByRole('button', { name: '편집 계속하기', exact: true }).click();
  await expect(page.locator('.app')).toHaveClass(/ui-mobile/);
}

async function projectFile(page: Page): Promise<Project> {
  const close = page.locator('.mobile-sheet:not([hidden]) .sheet-heading > button');
  if (await close.count()) await close.first().click();
  await page.getByRole('region', { name: '편집 타임라인', exact: true }).focus();
  const waiting = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  return JSON.parse(await fs.readFile((await (await waiting).path())!, 'utf8'));
}

async function closePanel(page: Page) {
  const close = page.locator('.mobile-sheet:not([hidden]) .sheet-heading > button');
  if (await close.count()) await close.first().tap();
}

async function seek(page: Page, time: string) {
  await page.getByLabel('재생헤드 타임코드').fill(time);
  await page.getByLabel('재생헤드 타임코드').press('Enter');
}

async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...from, id: 1 }],
    });
    for (let i = 1; i <= 6; i++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6, id: 1 },
        ],
      });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session
      .send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
      .catch(() => {});
    await session.detach();
  }
}

test('mobile mode: opt-in, persistent preference, preview and responsive tool panels', async ({
  page,
}) => {
  await mobileMode(page);
  await expect(page.locator('.mobile-dock > button')).toHaveCount(5);
  await page.reload();
  await expect(page.locator('.app')).toHaveClass(/ui-mobile/);
  await page.locator('.mobile-dock').getByRole('button', { name: '텍스트', exact: true }).tap();
  await page.getByRole('button', { name: /제목 추가/ }).tap();
  // Close the add panel if it is still open.
  const close = page.getByRole('button', { name: '추가 도구 닫기', exact: true });
  if (await close.isVisible()) await close.tap();
  const properties = page.getByRole('button', { name: '클립 속성 닫기', exact: true });
  if (await properties.isVisible()) await properties.tap();
  const report = [];
  for (const size of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 844, height: 390 },
    { width: 390, height: 360 },
  ]) {
    await page.setViewportSize(size);
    if (size.width >= 900 && size.height >= 600)
      await expect(page.locator('.app')).toHaveClass(/mobile-tablet/);
    else await expect(page.locator('.app')).not.toHaveClass(/mobile-tablet/);
    await page.locator('.mobile-dock').getByRole('button', { name: '화면', exact: true }).tap();
    await page.getByRole('button', { name: '9:16', exact: true }).tap();
    await expect
      .poll(async () => (await page.getByLabel('프로젝트 합성 영상').boundingBox())?.height ?? 0)
      .toBeGreaterThan(size.height >= 500 ? 100 : 0);
    await expect(page.locator('.preview-loading')).toHaveCount(0);
    const box = (await page.getByLabel('프로젝트 합성 영상').boundingBox())!;
    const panel = (await page.locator('.mobile-sheet:not([hidden])').boundingBox())!;
    expect(box.width).toBeGreaterThan(0);
    expect(box.width / box.height).toBeCloseTo(9 / 16, 1);
    if (size.height >= 500 && size.width < 900)
      expect(box.y + box.height).toBeLessThanOrEqual(panel.y + 1);
    if (size.width >= 900 || (size.width >= 640 && size.height <= 540))
      expect(box.x + box.width).toBeLessThanOrEqual(panel.x + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await expect(page.getByRole('region', { name: '프로젝트 설정', exact: true })).toBeVisible();
    await page.screenshot({ path: `artifacts/mobile/layout-${size.width}-${size.height}.png` });
    await page.getByRole('button', { name: '프로젝트 설정 닫기', exact: true }).tap();
    for (const button of await page.locator('.mobile-dock > button').all()) {
      const b = (await button.boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.y + b.height).toBeLessThanOrEqual(size.height + 1);
    }
    report.push({ ...size, preview: box });
  }
  await fs.mkdir('artifacts/mobile', { recursive: true });
  await fs.writeFile('artifacts/mobile/layout.json', JSON.stringify(report, null, 2));
});

test('mobile mode: changing UI preserves project, clipboard and undo; storage failure is explicit', async ({
  page,
}) => {
  await mobileMode(page);
  await page.locator('.mobile-dock').getByRole('button', { name: '텍스트', exact: true }).tap();
  await page.getByRole('button', { name: /제목 추가/ }).tap();
  const close = page.getByRole('button', { name: '추가 도구 닫기', exact: true });
  if (await close.isVisible()) await close.tap();
  const before = await projectFile(page);
  await page.keyboard.press('Control+c');
  await page.getByRole('button', { name: '앱 설정 · UI 모드', exact: true }).tap();
  await page.getByRole('radio', { name: /기본 모드/ }).check();
  await page.getByRole('button', { name: '편집 계속하기', exact: true }).click();
  await expect(page.locator('.app')).toHaveClass(/ui-standard/);
  await expect(
    page.getByRole('button', { name: '붙여넣기 (Ctrl/Cmd+V)', exact: true }),
  ).toBeEnabled();
  expect((await projectFile(page)).clips).toEqual(before.clips);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.timeline-clip')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.timeline-clip')).toHaveCount(1);
  await page.getByRole('button', { name: '프로젝트 메뉴', exact: true }).click();
  await page.getByRole('button', { name: '앱 설정 · UI 모드', exact: true }).click();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('blocked', 'QuotaExceededError');
    };
  });
  await page.getByRole('radio', { name: /모바일 모드/ }).check();
  await expect(page.locator('.toast')).toContainText('기기에 저장하지 못했습니다');
  await page.getByRole('button', { name: '편집 계속하기', exact: true }).click();
  await expect(page.locator('.app')).toHaveClass(/ui-mobile/);
  expect((await projectFile(page)).clips).toEqual(before.clips);
});

test('mobile touch: navigation does not edit; moves, trims, groups and track controls remain atomic', async ({
  page,
}) => {
  await mobileMode(page);
  await page.locator('.mobile-dock').getByRole('button', { name: '텍스트', exact: true }).tap();
  await page.getByRole('button', { name: /제목 추가/ }).tap();
  await page.getByRole('spinbutton', { name: '길이 (초)', exact: true }).fill('1');
  await page.getByRole('spinbutton', { name: '길이 (초)', exact: true }).press('Enter');
  await closePanel(page);
  await page.locator('.mobile-dock').getByRole('button', { name: '더보기', exact: true }).tap();
  await page.getByRole('button', { name: '복사 (C / Ctrl/Cmd+C)', exact: true }).tap();
  await closePanel(page);
  for (const time of ['1', '2']) {
    await seek(page, time);
    await page.locator('.mobile-dock').getByRole('button', { name: '더보기', exact: true }).tap();
    await page.getByRole('button', { name: '붙여넣기 (Ctrl/Cmd+V)', exact: true }).tap();
    await closePanel(page);
  }
  await expect(page.locator('.timeline-clip.text')).toHaveCount(3);
  for (let i = 0; i < 6; i++)
    await page
      .locator('.mobile-timeline-bar')
      .getByRole('button', { name: '타임라인 확대 (+)', exact: true })
      .tap();
  const original = await projectFile(page);
  await page.locator('.timeline-scroll').evaluate((el) => (el.scrollLeft = 0));
  const first = page.locator('.timeline-clip.text').first();
  let b = (await first.boundingBox())!;
  await touchDrag(
    page,
    { x: b.x + b.width / 2, y: b.y + 30 },
    { x: b.x + b.width / 2 - 100, y: b.y + 30 },
  );
  await expect
    .poll(() => page.locator('.timeline-scroll').evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(10);
  expect((await projectFile(page)).clips).toEqual(original.clips);
  await page.locator('.timeline-scroll').evaluate((el) => (el.scrollLeft = 0));
  await first.tap();
  b = (await first.boundingBox())!;
  await touchDrag(
    page,
    { x: b.x + b.width / 2, y: b.y + 30 },
    { x: b.x + b.width / 2 + 30, y: b.y + 30 },
  );
  const moved = await projectFile(page);
  expect(moved.clips[0].start).toBeGreaterThan(original.clips[0].start);
  await page.getByRole('button', { name: '실행 취소 (Ctrl/Cmd+Z)', exact: true }).tap();
  expect((await projectFile(page)).clips).toEqual(original.clips);
  const handle = (await first.locator('.trim-start').boundingBox())!;
  await touchDrag(
    page,
    { x: handle.x + handle.width / 2, y: handle.y + 30 },
    { x: handle.x + handle.width / 2 + 18, y: handle.y + 30 },
  );
  const trimmed = await projectFile(page);
  expect(trimmed.clips[0].duration).toBeLessThan(original.clips[0].duration);
  expect(trimmed.clips[0].sourceIn).toBe(trimmed.clips[0].start);
  await page.getByRole('button', { name: '실행 취소 (Ctrl/Cmd+Z)', exact: true }).tap();
  expect((await projectFile(page)).clips).toEqual(original.clips);
  await page.getByRole('button', { name: '다중 선택', exact: true }).tap();
  await page.locator('.timeline-clip.text').nth(1).tap();
  await expect(page.locator('.timeline-clip.text[aria-pressed="true"]')).toHaveCount(2);
  await page.locator('.mobile-dock').getByRole('button', { name: '더보기', exact: true }).tap();
  await page.getByRole('button', { name: '선택 클립 그룹화', exact: true }).tap();
  await closePanel(page);
  const grouped = await projectFile(page);
  expect(grouped.clips[0].groupId).toBeTruthy();
  expect(grouped.clips[1].groupId).toBe(grouped.clips[0].groupId);
  await page.getByRole('button', { name: /텍스트 · 이미지 트랙 설정/, exact: true }).tap();
  await page
    .getByRole('dialog', { name: '트랙 설정', exact: true })
    .getByRole('button', { name: '잠금', exact: true })
    .tap();
  await closePanel(page);
  await expect(
    page.locator('.mobile-clip-actions').getByRole('button', { name: '삭제', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: /텍스트 · 이미지 트랙 설정/, exact: true }).tap();
  await page
    .getByRole('dialog', { name: '트랙 설정', exact: true })
    .getByRole('button', { name: '잠금 해제', exact: true })
    .tap();
  await page
    .getByRole('dialog', { name: '트랙 설정', exact: true })
    .getByRole('button', { name: '트랙 삭제', exact: true })
    .tap();
  await expect(page.locator('.timeline-clip')).toHaveCount(0);
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  await page.reload();
  await expect(page.locator('.track-row')).toHaveCount(3);
  await page.locator('.mobile-dock').getByRole('button', { name: '텍스트', exact: true }).tap();
  await page.getByRole('button', { name: /제목 추가/ }).tap();
  await closePanel(page);
  await more(page, '분할 도구 · 클릭한 위치에서 분할');
  const splitClip = (await page.locator('.timeline-clip.text').boundingBox())!;
  await page
    .locator('.timeline-clip.text')
    .tap({ position: { x: Math.min(100, splitClip.width / 2), y: 30 } });
  await expect(page.locator('.timeline-clip.text')).toHaveCount(2);
  await page.getByRole('button', { name: '실행 취소 (Ctrl/Cmd+Z)', exact: true }).tap();
  await expect(page.locator('.timeline-clip.text')).toHaveCount(1);
});

test('mobile input: IME, keyboard viewport, panel focus and subtitle edits survive context changes', async ({
  page,
}) => {
  await mobileMode(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.locator('.mobile-dock').getByRole('button', { name: '텍스트', exact: true }).tap();
  await page.getByRole('button', { name: /자막 추가/ }).tap();
  const text = page.getByLabel('텍스트 내용');
  await text.fill('조합 중인 한글');
  await text.dispatchEvent('compositionstart');
  await text.dispatchEvent('keydown', { key: 'ㄴ', code: 'KeyS', isComposing: true });
  await page.setViewportSize({ width: 1024, height: 460 });
  await expect(text).toBeFocused();
  await text.dispatchEvent('compositionend', { data: '한글' });
  await text.fill('화면을 바꿔도 입력은 유지');
  // Tap a clip with a pending text edit; selecting/dragging must not roll it back.
  await closePanel(page);
  const saved = await projectFile(page);
  expect(saved.clips).toHaveLength(1);
  expect(saved.clips[0].text?.text).toBe('화면을 바꿔도 입력은 유지');
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.locator('.mobile-dock').getByRole('button', { name: '텍스트', exact: true }).tap();
  await page.getByRole('button', { name: /제목 추가/ }).tap();
  await page.getByLabel('텍스트 내용').fill('터치 직전에도 글은 보존');
  await page.locator('.timeline-clip.text').first().tap();
  const tapped = await projectFile(page);
  expect(tapped.clips[1].text?.text).toBe('터치 직전에도 글은 보존');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-dock').getByRole('button', { name: '더보기', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '편집 도구', exact: true });
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '편집 도구 닫기', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(
    page.locator('.mobile-dock').getByRole('button', { name: '더보기', exact: true }),
  ).toBeFocused();
  await expect(page.locator('.timeline-clip')).toHaveCount(2);
});

test('mobile advanced tools: placement menu, track creation, precision, captions and panel shortcuts are reachable', async ({
  page,
}) => {
  await mobileMode(page);
  await page.locator('.mobile-dock').getByRole('button', { name: '텍스트', exact: true }).tap();
  await page.getByRole('button', { name: /제목 추가/ }).tap();
  await number(page, '길이 (초)', '1');
  await closePanel(page);
  await more(page, '복사 (C / Ctrl/Cmd+C)');
  await page.locator('.mobile-dock').getByRole('button', { name: '더보기', exact: true }).tap();
  await page.getByRole('button', { name: '붙여넣기 방식', exact: true }).tap();
  await page.getByRole('button', { name: '끝에 추가 (A)', exact: true }).tap();
  await expect(page.locator('.timeline-clip.text')).toHaveCount(2);
  await page
    .getByRole('dialog', { name: '편집 도구', exact: true })
    .getByRole('button', { name: '트랙', exact: true })
    .tap();
  await page.getByRole('button', { name: '영상 · 이미지 · 텍스트', exact: true }).tap();
  await expect(page.locator('.track-row')).toHaveCount(5);
  await page.getByRole('button', { name: '구간 시작 I', exact: true }).tap();
  await page.getByRole('button', { name: '다음 경계', exact: true }).tap();
  await page.getByRole('button', { name: '구간 끝 O', exact: true }).tap();
  await closePanel(page);
  expect((await projectFile(page)).workRange).toEqual({ start: 0, end: 1000000 });
  await page.getByRole('region', { name: '편집 타임라인', exact: true }).focus();
  await page.keyboard.press('Control+2');
  await expect(page.getByRole('region', { name: '클립 속성', exact: true })).toBeVisible();
  await closePanel(page);
  await page.getByRole('region', { name: '편집 타임라인', exact: true }).focus();
  await page.keyboard.press('Control+4');
  await expect(page.getByRole('region', { name: '추가 도구', exact: true })).toBeVisible();
  await page.locator('.library-tabs').getByRole('button', { name: '자막', exact: true }).tap();
  await page.getByLabel('자막 파일 선택').setInputFiles({
    name: 'mobile.srt',
    mimeType: 'text/plain',
    buffer: Buffer.from('1\n00:00:02,000 --> 00:00:03,000\n좁은 화면에서도 자막 목록\n'),
  });
  await expect(page.locator('.caption-row')).toHaveCount(3);
  const row = page.locator('.caption-row').last();
  await row.getByRole('textbox').fill('한글 목록에서 수정');
  await row.getByRole('textbox').press('Tab');
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'SRT 저장', exact: true }).tap();
  expect(await fs.readFile((await (await wait).path())!, 'utf8')).toContain('한글 목록에서 수정');
  await closePanel(page);
  await page.locator('.mobile-dock').getByRole('button', { name: '미디어', exact: true }).tap();
  await page.keyboard.press('Control+5');
  await expect(page.getByRole('region', { name: '편집 타임라인', exact: true })).toBeFocused();
  await expect(page.getByRole('region', { name: '추가 도구', exact: true })).toHaveCount(0);
  await page.locator('.preview-options > summary').tap();
  await page.getByLabel('미리보기 품질').selectOption('0.5');
  await page.getByRole('button', { name: '안전 영역', exact: true }).tap();
  await page.keyboard.press('Escape');
  expect((await projectFile(page)).safeArea).toBe(true);
});
