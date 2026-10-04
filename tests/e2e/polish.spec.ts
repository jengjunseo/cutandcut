import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';

async function importVideo(page: Page, insert = false) {
  const sample = await page.evaluate(async () => {
    const url = '/tests/fixtures.browser.ts';
    const mod = await import(/* @vite-ignore */ url);
    return (await mod.makeFixtures())[0];
  });
  if (insert) await page.getByLabel('가져오면서 타임라인에 연속 배치').check();
  await page.getByLabel('미디어 파일 선택').setInputFiles({
    name: sample.name,
    mimeType: sample.mimeType,
    buffer: Buffer.from(sample.bytes),
  });
  await expect(page.locator('.asset-card')).toHaveCount(1);
  await expect(page.locator('.import-progress')).toHaveCount(0);
}

test('polish: one file action, accurate imported empty state and existing insertion undo', async ({
  page,
}) => {
  await page.goto('/');
  const start = page.getByRole('button', { name: '파일 선택', exact: true });
  await expect(start).toHaveCount(1);
  let chooserCount = 0;
  page.on('filechooser', () => chooserCount++);
  const chooser = page.waitForEvent('filechooser');
  await start.press('Space');
  await chooser;
  expect(chooserCount).toBe(1);
  await importVideo(page);
  await expect(page.locator('.timeline-clip')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '파일 선택', exact: true })).toHaveCount(0);
  await expect(page.locator('.start-canvas')).toContainText('아직 타임라인에 클립이 없습니다');
  await page.screenshot({ path: 'artifacts/polish/06-after-import.png' });
  await page.getByRole('button', { name: '선택한 미디어 추가', exact: true }).press('Enter');
  await expect(page.locator('.timeline-clip')).toHaveCount(2);
  await page.getByRole('button', { name: '실행 취소 (Ctrl/Cmd+Z)', exact: true }).click();
  await expect(page.locator('.timeline-clip')).toHaveCount(0);
  await page.getByRole('button', { name: '보관함에서 배치하기', exact: true }).click();
  const plus = page.getByRole('button', { name: 'first.mp4 타임라인에 추가', exact: true });
  await expect(plus).toBeInViewport();
  await plus.click();
  await expect(page.locator('.timeline-clip')).toHaveCount(2);
});

test('polish: project and track popovers share keyboard dismissal without editing', async ({
  page,
}) => {
  await page.goto('/');
  const project = page.getByRole('button', { name: '프로젝트 메뉴', exact: true });
  await project.click();
  await expect(project).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByRole('button', { name: '최근 프로젝트 · 저장소', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('End');
  await expect(
    page.getByRole('button', { name: '사용하지 않는 원본 정리', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('b');
  await expect(page.getByRole('button', { name: '선택 도구', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(project).toBeFocused();
  await expect(project).toHaveAttribute('aria-expanded', 'false');
  const track = page.getByRole('button', { name: '트랙', exact: true });
  await track.click();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#track-menu button').last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.locator('#track-menu button').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(track).toBeFocused();
  await expect(page.locator('.track-row')).toHaveCount(4);
  await project.click();
  await page.getByLabel('프로젝트 이름', { exact: true }).click();
  await expect(project).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('프로젝트 이름', { exact: true })).toBeFocused();
});

test('polish: touch layouts retain readable export, save feedback and portrait preview', async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  const results = [];
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('.save-state')).toBeVisible();
    const bounds = await page.locator('.app-header').evaluate((el) => {
      const head = el.getBoundingClientRect(),
        output = el.querySelector('.export-button')!.getBoundingClientRect();
      return {
        width: window.innerWidth,
        header: head.toJSON(),
        output: output.toJSON(),
        overflowing: el.scrollWidth > el.clientWidth,
      };
    });
    expect(bounds.overflowing).toBe(false);
    expect(bounds.output.right).toBeLessThanOrEqual(width);
    expect(bounds.output.bottom).toBeLessThanOrEqual(bounds.header.bottom);
    expect(bounds.output.height).toBeGreaterThanOrEqual(44);
    const nav = page.locator('.mobile-navigation');
    await nav.getByRole('button', { name: '속성', exact: true }).click();
    await expect(nav.getByRole('button', { name: '속성', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: '9:16', exact: true }).click();
    await nav.getByRole('button', { name: '미리보기', exact: true }).click();
    const preview = await page.locator('.canvas-wrap').boundingBox();
    expect(preview!.width).toBeGreaterThan(0);
    expect(preview!.height).toBeGreaterThan(0);
    expect(preview!.width / preview!.height).toBeCloseTo(9 / 16, 2);
    const transport = await page
      .locator('.transport')
      .evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(transport).toBe(true);
    results.push({ width, header: bounds, preview });
    await page.screenshot({ path: `artifacts/polish/07-after-touch-${width}.png` });
  }
  await page.getByRole('button', { name: '프로젝트 메뉴', exact: true }).click();
  await page.getByRole('button', { name: '단축키 도움말', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '키보드 단축키', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '프로젝트 메뉴', exact: true })).toBeFocused();
  await fs.writeFile('artifacts/polish/layout.json', JSON.stringify(results, null, 2));
  await context.close();
});

test('polish: recent projects distinguish loading, failure and confirmed empty list', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  await page.evaluate(() => {
    const get = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (...args) {
      const request = get.apply(this, args);
      if (this.name === 'projects')
        Object.defineProperty(request, 'onsuccess', {
          set(handler) {
            request.addEventListener('success', (e) =>
              setTimeout(() => handler.call(request, e), 1500),
            );
          },
        });
      return request;
    };
  });
  async function openRecent() {
    await page.getByRole('button', { name: '프로젝트 메뉴', exact: true }).click();
    await page.getByRole('button', { name: '최근 프로젝트 · 저장소', exact: true }).click();
  }
  await openRecent();
  const dialog = page.getByRole('dialog', { name: '최근 프로젝트', exact: true });
  await expect(dialog).toContainText('저장된 프로젝트를 불러오는 중');
  await expect(dialog).not.toContainText('저장된 프로젝트가 없습니다');
  await expect(dialog.locator('.recent-list button')).toHaveCount(1);
  await dialog.getByRole('button', { name: '최근 프로젝트 닫기', exact: true }).click();
  await page.evaluate(async () => {
    const url = '/src/storage.ts';
    await (await import(/* @vite-ignore */ url)).recentProjects();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('cyancut-local', 2);
      request.onsuccess = () => {
        const tx = request.result.transaction('projects', 'readwrite');
        tx.objectStore('projects').clear();
        tx.oncomplete = () => {
          request.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await openRecent();
  await expect(dialog).toContainText('편집을 시작하면 이 기기에 자동 저장됩니다');
  await dialog.getByRole('button', { name: '최근 프로젝트 닫기', exact: true }).click();
  await page.evaluate(() => {
    const get = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (...args) {
      if (this.name === 'projects') throw new DOMException('목록 읽기 실패 주입', 'UnknownError');
      return get.apply(this, args);
    };
  });
  await openRecent();
  await expect(dialog.getByRole('alert')).toContainText('프로젝트 목록을 불러오지 못했습니다');
  await expect(dialog).not.toContainText('저장된 프로젝트가 없습니다');
  await page.screenshot({ path: 'artifacts/polish/08-after-recent-error.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: '프로젝트 메뉴', exact: true })).toBeFocused();
});

test('polish: export keyboard flow and actual audio output keep primary actions reachable', async ({
  page,
}) => {
  await page.goto('/');
  await importVideo(page, true);
  await page.setViewportSize({ width: 390, height: 720 });
  const open = page.getByRole('button', { name: '내보내기', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog', { name: '내보내기', exact: true });
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await dialog.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: '내보내기', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '내보내기 닫기', exact: true })).toBeFocused();
  await page.getByLabel('파일 형식').selectOption('wav');
  const details = dialog.locator('.export-preflight summary');
  await details.focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '돌아가기', exact: true })).toBeFocused();
  await page.screenshot({ path: 'artifacts/polish/09-after-export-settings.png' });
  await dialog.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByText('내보내기가 완료됐습니다.', { exact: true })).toBeVisible();
  const download = page.getByRole('button', { name: '파일 다운로드', exact: true });
  await expect(download).toBeFocused();
  await expect(download).toBeInViewport();
  await page.screenshot({ path: 'artifacts/polish/10-after-export-done.png' });
  const wait = page.waitForEvent('download');
  await download.press('Enter');
  const file = await (await wait).path(),
    bytes = await fs.readFile(file!);
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.length).toBeGreaterThan(100_000);
  await page.getByRole('button', { name: '편집으로 돌아가기', exact: true }).click();
  await expect(open).toBeFocused();
  await expect(page.locator('.timeline-clip')).toHaveCount(2);
});

test('polish: long failed filenames expose a readable retry while preserving the edit', async ({
  page,
}) => {
  await page.goto('/');
  await importVideo(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator('.mobile-navigation')
    .getByRole('button', { name: '미디어', exact: true })
    .click();
  await page.getByLabel('미디어 파일 선택').setInputFiles({
    name: '손상된_파일_'.repeat(30) + '.avi',
    mimeType: 'video/x-msvideo',
    buffer: Buffer.from('not media'),
  });
  await expect(page.locator('.import-error-row')).toHaveCount(1);
  await expect(page.locator('.import-errors')).toHaveAttribute('open', '');
  await expect(page.locator('.import-error-row .secondary')).toBeVisible();
  const width = await page
    .locator('.import-error-row')
    .evaluate((el) => ({ visible: el.clientWidth, contents: el.scrollWidth }));
  expect(width.contents).toBeLessThanOrEqual(width.visible);
  const toast = await page.locator('.toast').boundingBox();
  expect(toast!.height).toBeLessThanOrEqual(844 / 4);
  await expect(page.locator('.import-error-row > strong')).toHaveAttribute(
    'title',
    '손상된_파일_'.repeat(30) + '.avi',
  );
  await page.locator('.import-error-row .secondary').scrollIntoViewIfNeeded();
  await expect(page.locator('.timeline-clip')).toHaveCount(2);
  await page.screenshot({ path: 'artifacts/polish/11-after-import-error.png' });
});
