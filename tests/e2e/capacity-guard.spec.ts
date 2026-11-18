import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

test('actual output quota failure cleans temporary files, preserves the project and allows retry', async ({
  page,
}) => {
  test.skip(!!process.env.TEST_URL, 'Fault injection uses the local Worker source.');
  await page.goto('/');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /제목 추가/ }).click();
  await page.getByRole('spinbutton', { name: '길이 (초)', exact: true }).fill('8');
  await page.getByRole('spinbutton', { name: '길이 (초)', exact: true }).press('Enter');
  await page.getByRole('region', { name: '편집 타임라인', exact: true }).focus();
  const beforeDownload = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const before = JSON.parse(await fs.readFile((await (await beforeDownload).path())!, 'utf8'));
  let injected = 0;
  await page.route('**/src/export-output.ts*', async (route) => {
    const response = await route.fetch();
    const original = await response.text();
    const marker = 'async write(chunk) {';
    const changed = original.replace(
      marker,
      `${marker}\nif (++__writes === 2) throw new DOMException('Injected full disk', 'QuotaExceededError');`,
    );
    const body = changed === original ? original : `let __writes=0;\n${changed}`;
    if (body !== original) injected++;
    await route.fulfill({ response, body });
  });
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByLabel('파일 형식').selectOption('wav');
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.locator('.export-error')).toContainText('실제 저장 공간이 부족');
  expect(injected).toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const folder = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle('cyancut-export-temporary');
        let count = 0;
        for await (const _ of (folder as any).values()) count++;
        return count;
      }),
    )
    .toBe(0);
  await page.unroute('**/src/export-output.ts*');
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByText('내보내기가 완료됐습니다.')).toBeVisible();
  await page.getByRole('button', { name: '편집으로 돌아가기', exact: true }).click();
  await page.getByRole('region', { name: '편집 타임라인', exact: true }).focus();
  const afterDownload = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const after = JSON.parse(await fs.readFile((await (await afterDownload).path())!, 'utf8'));
  expect(after).toEqual(before);
});
