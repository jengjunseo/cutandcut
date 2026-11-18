import { test, expect } from '@playwright/test';

test('directive: missing font fails explicitly and manual font replacement preserves text and actual export', async ({
  page,
}) => {
  await page.route('**/nanum-gothic-*.woff2*', (route) =>
    route.request().resourceType() === 'font' ? route.abort('failed') : route.continue(),
  );
  await page.goto('/');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /자막 추가/ }).click();
  await page.getByRole('combobox', { name: '글꼴', exact: true }).selectOption('gothic');
  await page.getByLabel('텍스트 내용', { exact: true }).fill('글꼴 실패에도 마지막 글자 보존');
  await expect(page.locator('.preview-error')).toContainText('나눔고딕 글꼴 로딩에 실패');
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByLabel('파일 형식').selectOption('mp4');
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('나눔고딕 글꼴 로딩에 실패');
  await expect(page.getByText('내보내기가 완료됐습니다.')).toHaveCount(0);
  await page.getByRole('button', { name: '돌아가기', exact: true }).click();
  await expect(page.getByLabel('텍스트 내용', { exact: true })).toHaveValue(
    '글꼴 실패에도 마지막 글자 보존',
  );
  await page.getByRole('combobox', { name: '글꼴', exact: true }).selectOption('noto');
  await expect(page.locator('.preview-error')).toHaveCount(0);
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByLabel('파일 형식').selectOption('mp4');
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByText('내보내기가 완료됐습니다.')).toBeVisible({ timeout: 120000 });
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 다운로드', exact: true }).click();
  await (await wait).saveAs('artifacts/directive-font-retry.mp4');
});

test('directive: font module failure gives a Korean recovery action and preserves content', async ({
  page,
}) => {
  await page.route('**/src/font-gothic.ts*', (route) => route.abort('failed'));
  await page.goto('/');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /자막 추가/ }).click();
  await page.getByRole('combobox', { name: '글꼴', exact: true }).selectOption('gothic');
  await page.getByLabel('텍스트 내용', { exact: true }).fill('모듈 실패에도 보존');
  await expect(page.locator('.preview-error')).toContainText(
    '나눔고딕 글꼴 모듈을 불러오지 못했습니다',
  );
  await expect(page.getByLabel('텍스트 내용', { exact: true })).toHaveValue('모듈 실패에도 보존');
  await page.getByRole('combobox', { name: '글꼴', exact: true }).selectOption('noto');
  await expect(page.locator('.preview-error')).toHaveCount(0);
});
