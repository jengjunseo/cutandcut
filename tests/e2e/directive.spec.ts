import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { pixelsPerSecond } from './workspace-helpers';
test('directive P0: focused Korean text is live, saved and undoable as one typing session', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /자막 추가/ }).click();
  const input = page.getByLabel('텍스트 내용', { exact: true });
  await expect(input).toHaveValue('');
  await input.fill('아베무지카 오늘도');
  await input.press('End');
  await input.pressSequentially(' 라이브');
  await expect(input).toBeFocused();
  await expect(page.locator('.timeline-clip.text').first()).toContainText(
    '아베무지카 오늘도 라이브',
  );
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  await page.getByRole('button', { name: '실행 취소 (Ctrl/Cmd+Z)', exact: true }).click();
  await expect(input).toHaveValue('');
  await page.getByRole('button', { name: '다시 실행 (Ctrl/Cmd+Shift+Z)', exact: true }).click();
  await expect(input).toHaveValue('아베무지카 오늘도 라이브');
  await page.reload();
  await page.getByLabel('속성에서 클립 선택').selectOption({ label: '텍스트 · 0.00초 (text)' });
  await expect(input).toHaveValue('아베무지카 오늘도 라이브');
  await input.fill('');
  await input.dispatchEvent('compositionstart');
  await input.fill('한글 조합 👩‍💻\n마지막 글자');
  await input.dispatchEvent('compositionend', { data: '자' });
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByLabel('파일 형식').selectOption('mp4');
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByText('내보내기가 완료됐습니다.')).toBeVisible({ timeout: 120000 });
  const videoDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 다운로드', exact: true }).click();
  const video = await videoDownload;
  await video.saveAs('artifacts/directive-live-text.mp4');
  await page.getByRole('button', { name: '편집으로 돌아가기', exact: true }).click();
  await page.getByRole('region', { name: '편집 타임라인', exact: true }).focus();
  const downloading = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const p = JSON.parse(await fs.readFile((await (await downloading).path())!, 'utf8'));
  expect(p.clips[0].text.text).toBe('한글 조합 👩‍💻\n마지막 글자');
  expect(p.editRevision).toBeGreaterThan(0);
  const bytes = Array.from(await fs.readFile((await video.path())!));
  const decoded = await page.evaluate(
    async ({ p, bytes }) => {
      const url = '/tests/directive-media.browser.ts';
      return (await import(/* @vite-ignore */ url)).compareOutput(p, bytes, [], [0, 0.5]);
    },
    { p, bytes },
  );
  for (const frame of decoded) {
    expect(frame.ink).toBeGreaterThan(1000);
    expect(frame.retainedInk).toBeGreaterThan(0.9);
    expect(frame.mae).toBeLessThan(3);
  }
});

test('directive: pointer media placement, linked audio, scroll and cancellation are atomic', async ({
  page,
}) => {
  await page.goto('/');
  const fixtures = await page.evaluate(async () => {
    const url = '/tests/fixtures.browser.ts';
    return (await import(/* @vite-ignore */ url)).makeFixtures();
  });
  await page.getByLabel('미디어 파일 선택').setInputFiles(
    fixtures.map((f: { name: string; mimeType: string; bytes: number[] }) => ({
      name: f.name,
      mimeType: f.mimeType,
      buffer: Buffer.from(f.bytes),
    })),
  );
  await expect(page.locator('.asset-card')).toHaveCount(4);
  await expect(page.locator('.import-progress')).toHaveCount(0);
  const first = page.locator('.asset-card').first();
  await expect(first).toBeInViewport();
  const range = page.getByLabel('타임라인 표시 범위').filter({ visible: true });
  await range.selectOption('15');
  const drag = async (name: string, row: number, time: number) => {
    const handle = page.getByRole('button', {
      name: `${name} 끌어서 배치 · Enter는 재생헤드에 추가`,
      exact: true,
    });
    await handle.scrollIntoViewIfNeeded();
    const lane = page.locator('.track-lane').nth(row);
    await lane.scrollIntoViewIfNeeded();
    const a = (await handle.boundingBox())!,
      b = (await lane.boundingBox())!,
      scale = await pixelsPerSecond(page);
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + Math.max(2, time * scale), b.y + b.height / 2, { steps: 15 });
    await page.mouse.up();
  };
  await drag('first.mp4', 1, 1.0);
  await expect(page.locator('.timeline-clip.video')).toHaveCount(1);
  await expect(page.locator('.timeline-clip.audio')).toHaveCount(1);
  await expect(page.getByLabel('프로젝트 이름', { exact: true })).toHaveValue('first');
  await expect(range).toHaveValue('15');
  await drag('overlay.png', 0, 0);
  await expect(page.locator('.timeline-clip.image')).toHaveCount(1);
  await drag('music.wav', 3, 2);
  await expect(page.locator('.timeline-clip.audio')).toHaveCount(2);
  await page.getByRole('button', { name: '실행 취소 (Ctrl/Cmd+Z)', exact: true }).click();
  await expect(page.locator('.timeline-clip.audio')).toHaveCount(1);
  const handle = page.getByRole('button', {
    name: 'first.mp4 끌어서 배치 · Enter는 재생헤드에 추가',
    exact: true,
  });
  await handle.scrollIntoViewIfNeeded();
  const a = (await handle.boundingBox())!;
  await page.mouse.move(a.x + 10, a.y + 10);
  await page.mouse.down();
  await page.mouse.move(1000, 650, { steps: 10 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.timeline-clip.video')).toHaveCount(1);
  await page.getByRole('button', { name: '영상 1 잠금', exact: true }).click();
  await drag('first.mp4', 1, 3);
  await expect(page.locator('.timeline-clip.video')).toHaveCount(1);
  await expect(page.locator('.toast')).toContainText('잠긴');
});

test('directive: centered transitions at 24/30/60fps match decoded MP4 frames', async ({
  page,
}) => {
  test.setTimeout(300000);
  await page.goto('/');
  const records = await page.evaluate(async () => {
    const a = '/tests/fixtures.browser.ts',
      b = '/tests/directive-media.browser.ts';
    const fixtures = await (await import(/* @vite-ignore */ a)).makeFixtures();
    return (await import(/* @vite-ignore */ b)).transitionMatrix(fixtures);
  });
  for (const r of records)
    for (const frame of r.errors)
      expect(frame.mae, `${r.kind} ${r.fps}fps @${frame.time}`).toBeLessThan(4);
  await fs.writeFile('artifacts/directive-transitions.json', JSON.stringify(records, null, 2));
});

test('directive: six styled Korean presets use real fonts in landscape and portrait MP4', async ({
  page,
}) => {
  test.setTimeout(240000);
  await page.goto('/');
  const results = [];
  for (const [width, height] of [
    [1280, 720],
    [720, 1280],
    [1920, 1080],
    [1080, 1920],
  ]) {
    const result = await page.evaluate(
      async ({ width, height }) => {
        const url = '/tests/directive-media.browser.ts';
        return (await import(/* @vite-ignore */ url)).presetMatrix(width, height);
      },
      { width, height },
    );
    for (const f of result.errors) {
      expect(f.mae).toBeLessThan(4);
      expect(f.retainedInk).toBeGreaterThan(0.85);
      expect(f.ink).toBeGreaterThan(300);
    }
    await fs.writeFile(
      `artifacts/directive-presets-${width}x${height}.mp4`,
      new Uint8Array(result.bytes),
    );
    results.push({ width, height, errors: result.errors });
  }
  await fs.writeFile('artifacts/directive-presets.json', JSON.stringify(results, null, 2));
});

test('directive: automatic zoom does not change on typing, presets and panel collapse remain usable', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /자막 추가/ }).click();
  const range = page.getByLabel('타임라인 표시 범위').filter({ visible: true });
  await range.selectOption('5');
  const before = await page.locator('.timeline-clip.text').boundingBox();
  await page.getByLabel('텍스트 내용', { exact: true }).fill('타이핑 뒤에도 선택한 배율 유지');
  await expect(range).toHaveValue('5');
  const view = page.locator('.preview-options > summary');
  await view.focus();
  await view.press('Space');
  await expect(page.locator('.preview-options')).toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: '재생 (Space)', exact: true })).toBeVisible();
  await view.press('Escape');
  await expect(view).toBeFocused();
  await expect(page.locator('.preview-options')).not.toHaveAttribute('open', '');
  const after = await page.locator('.timeline-clip.text').boundingBox();
  expect(Math.abs(after!.width - before!.width)).toBeLessThan(2);
  const canvas = await page.locator('.preview-area').boundingBox();
  await page.getByRole('button', { name: '미디어 패널', exact: true }).click();
  await page.getByRole('button', { name: '속성 패널', exact: true }).click();
  await expect
    .poll(async () => (await page.locator('.preview-area').boundingBox())!.width)
    .toBeGreaterThan(canvas!.width);
  await page.getByRole('button', { name: '속성 패널', exact: true }).click();
  await page.getByRole('region', { name: '편집 타임라인', exact: true }).focus();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '9:16', exact: true }).click();
  await page.locator('.timeline-clip.text').click();
  await page.getByLabel('텍스트 스타일 프리셋').selectOption('box');
  await page.getByText('세부 스타일 · 프리셋 관리', { exact: true }).click();
  await expect(
    page.getByRole('spinbutton', { name: '자동 줄바꿈 폭 (px) · 0은 수동 줄바꿈', exact: true }),
  ).toHaveValue('864');
  await page.getByLabel('프리셋 이름', { exact: true }).fill('내 라이브 자막');
  await page.getByRole('button', { name: '현재 스타일 저장', exact: true }).click();
  await page.getByRole('button', { name: '프리셋 삭제', exact: true }).click();
  await expect(page.getByLabel('텍스트 내용', { exact: true })).toHaveValue(
    '타이핑 뒤에도 선택한 배율 유지',
  );
  await expect(page.getByLabel('배경 박스', { exact: true })).toBeChecked();
});
