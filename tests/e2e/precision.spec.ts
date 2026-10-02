import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
test('speed, pitch preservation, mix normalization, freeze and absolute-time range export', async ({
  page,
}) => {
  await page.goto('/');
  const speed = await page.evaluate(async () => {
    const url = '/tests/audit.browser.ts';
    return (await import(/* @vite-ignore */ url)).verifySpeed();
  });
  for (const result of speed.results) {
    expect(result.length).toBeCloseTo(speed.sourceDuration / result.speed, 3);
    expect(result.frequency).toBeCloseTo(result.preservePitch ? 440 : 880, -1);
    expect(result.rms).toBeGreaterThan(0.05);
  }
  expect(speed.analysis.peak).toBeGreaterThan(1);
  expect(speed.cancelled).toBe('AbortError');
  expect(speed.analysis.clippedSamples).toBeGreaterThan(0);
  expect(speed.normalized.peak).toBeCloseTo(0.95, 2);
  expect(speed.image.width).toBe(1280);
  expect(speed.image.color[0] - speed.image.color[2]).toBeGreaterThan(100);
  const range = await page.evaluate(async () => {
    const url = '/tests/audit.browser.ts';
    return (await import(/* @vite-ignore */ url)).verifyRange();
  });
  expect(range.length).toBeCloseTo(2, 1);
  expect(range.pixels[0][0] - range.pixels[0][2]).toBeGreaterThan(100);
  expect(range.pixels[1][2] - range.pixels[1][0]).toBeGreaterThan(100);
  expect(range.audio.rms).toBeGreaterThan(0.05);
  await fs.writeFile('artifacts/range-1-3.mp4', Buffer.from(range.bytes));
  await fs.writeFile(
    'artifacts/precision.json',
    JSON.stringify({ speed, range: { ...range, bytes: undefined } }, null, 2),
  );
});
test('Korean caption list, range controls, project copies and recovery preserve originals', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '자막', exact: true }).click();
  await page.getByLabel('자막 파일 선택').setInputFiles({
    name: 'captions.srt',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      '1\n00:00:00,000 --> 00:00:01,500\n한글 첫 자막\n\n2\n00:00:01,500 --> 00:00:03,000\n두 번째\n두 줄',
    ),
  });
  await expect(page.locator('.caption-row')).toHaveCount(2);
  const first = page.locator('.caption-row').first();
  await first.getByRole('textbox').fill('입력 중에는 JKL · 한글 수정');
  await first.getByRole('textbox').press('Tab');
  await first.getByRole('spinbutton').last().fill('1.25');
  await first.getByRole('spinbutton').last().press('Tab');
  await first.getByRole('button').click();
  await page.getByRole('spinbutton', { name: '크기 (px)', exact: true }).fill('40');
  await page.getByRole('spinbutton', { name: '크기 (px)', exact: true }).press('Enter');
  await page.getByRole('button', { name: '선택 자막 스타일을 전체 적용', exact: true }).click();
  await page.getByRole('button', { name: '실행 취소 (Ctrl/Cmd+Z)', exact: true }).click();
  await page.getByRole('button', { name: '다시 실행 (Ctrl/Cmd+Shift+Z)', exact: true }).click();
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'VTT 저장', exact: true }).click();
  const vtt = await fs.readFile((await (await wait).path())!, 'utf8');
  expect(vtt).toContain('00:00:01.250');
  expect(vtt).toContain('입력 중에는 JKL');
  await page.getByLabel('재생헤드 타임코드').fill('00:00:01:00');
  await page.getByLabel('재생헤드 타임코드').press('Enter');
  await expect(page.getByLabel('재생헤드 타임코드')).toHaveValue('00:00:01:00');
  await page.getByRole('button', { name: '구간 시작 I', exact: true }).click();
  await page.getByLabel('재생헤드 타임코드').fill('2');
  await page.getByLabel('재생헤드 타임코드').press('Enter');
  await page.getByRole('button', { name: '구간 끝 O', exact: true }).click();
  await expect(page.locator('.range-highlight')).toBeVisible();
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.getByLabel('출력 범위').selectOption('range');
  await expect(page.locator('.export-summary')).toContainText('1.00초');
  await page.getByRole('button', { name: '돌아가기', exact: true }).click();
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  await page.getByRole('button', { name: '프로젝트 메뉴', exact: true }).click();
  await page.getByRole('button', { name: '프로젝트 복제', exact: true }).click();
  await expect(page.getByLabel('프로젝트 이름')).toHaveValue(/복사본/);
  await page.getByRole('button', { name: '프로젝트 메뉴', exact: true }).click();
  await page.getByRole('button', { name: '최근 프로젝트 · 저장소', exact: true }).click();
  await expect(page.locator('.recent-list button')).toHaveCount(2);
  await page.locator('.recent-list button').filter({ hasText: '복사본' }).count();
  await page
    .locator('.recent-list button')
    .filter({ has: page.getByText('이름 없는 프로젝트', { exact: true }) })
    .click();
  await expect(page.getByLabel('프로젝트 이름')).not.toHaveValue(/복사본/);
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  await page.reload();
  await expect(page.locator('.caption-row')).toHaveCount(0);
  await page.getByRole('button', { name: '자막', exact: true }).click();
  await expect(page.locator('.caption-row')).toHaveCount(2);
});
