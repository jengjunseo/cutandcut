import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

test('encoded-byte guard aborts early, preserves the project and allows a fresh retry', async ({
  page,
}) => {
  test.skip(!!process.env.TEST_URL, 'Fault injection uses the local Worker source.');
  await page.goto('/');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /제목 추가/ }).click();
  await page.getByRole('region', { name: '편집 타임라인', exact: true }).focus();
  const beforeDownload = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const before = JSON.parse(await fs.readFile((await (await beforeDownload).path())!, 'utf8'));
  let injected = 0;
  await page.route('**/src/engine.worker.ts?*', async (route) => {
    const response = await route.fetch();
    const original = await response.text();
    const body = original.replace('encodedBytes >= EXPORT_MAX_BYTES', 'encodedBytes >= 4096');
    if (body !== original) injected++;
    await route.fulfill({ response, body });
  });
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByLabel('파일 형식').selectOption('wav');
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.locator('.export-error')).toContainText('실제 출력이 1GiB를 초과');
  expect(injected).toBeGreaterThan(0);
  await page.unroute('**/src/engine.worker.ts?*');
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByText('내보내기가 완료됐습니다.')).toBeVisible();
  await page.getByRole('button', { name: '편집으로 돌아가기', exact: true }).click();
  await page.getByRole('region', { name: '편집 타임라인', exact: true }).focus();
  const afterDownload = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const after = JSON.parse(await fs.readFile((await (await afterDownload).path())!, 'utf8'));
  expect(after).toEqual(before);
});
