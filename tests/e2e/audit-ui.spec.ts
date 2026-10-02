import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
async function saved(page: Page) {
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  return page.evaluate(async () => {
    const url = '/src/storage.ts';
    return (await import(/* @vite-ignore */ url)).restoreProject();
  });
}
test('crop handles, flip, quality, marquee, locking, solo, normalization and stored-media copies', async ({
  page,
}) => {
  await page.goto('/');
  const fixtures = await page.evaluate(async () => {
    const url = '/tests/fixtures.browser.ts';
    return (await import(/* @vite-ignore */ url)).makeFixtures();
  });
  await page.getByLabel('미디어 파일 선택').setInputFiles(
    fixtures.slice(0, 3).map((f: { name: string; mimeType: string; bytes: number[] }) => ({
      name: f.name,
      mimeType: f.mimeType,
      buffer: Buffer.from(f.bytes),
    })),
  );
  await expect(page.locator('.import-progress')).toHaveCount(0);
  await page
    .getByRole('button', { name: '선택한 미디어 추가 · 영상은 연속 배치', exact: true })
    .click();
  await page.getByLabel('프로젝트 이름').fill('감사 원본');
  await page.getByLabel('프로젝트 이름').press('Enter');
  await page.locator('.timeline-clip.image').click();
  await page.getByRole('button', { name: '안전 영역', exact: true }).click();
  await expect(page.getByLabel('10% 자막 안전 영역')).toBeVisible();
  await page.getByRole('button', { name: '크롭 핸들', exact: true }).click();
  const handle = (await page
    .getByRole('button', { name: '왼쪽 위 크롭 핸들', exact: true })
    .boundingBox())!;
  await page.mouse.move(handle.x + 10, handle.y + 10);
  await page.mouse.down();
  await page.mouse.move(handle.x + 50, handle.y + 30, { steps: 5 });
  await page.mouse.up();
  const cropped = await saved(page);
  expect(cropped.clips.find((c: { kind: string }) => c.kind === 'image').crop.left).toBeGreaterThan(
    0,
  );
  await page.getByRole('button', { name: '실행 취소 (Ctrl/Cmd+Z)', exact: true }).click();
  expect(
    (await saved(page)).clips.find((c: { kind: string }) => c.kind === 'image').crop,
  ).toBeUndefined();
  await page.getByRole('button', { name: '다시 실행 (Ctrl/Cmd+Shift+Z)', exact: true }).click();
  await page.getByRole('button', { name: '좌우 반전', exact: true }).click();
  await expect(page.getByRole('button', { name: '좌우 반전', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByLabel('미리보기 품질').selectOption('0.25');
  await expect
    .poll(() => page.getByLabel('프로젝트 합성 영상').evaluate((c: HTMLCanvasElement) => c.width))
    .toBeLessThan(300);
  expect((await saved(page)).width).toBe(1280);
  await page.locator('.timeline-clip.video').first().click();
  await page.getByLabel('클립 속도').selectOption('2');
  const fast = await saved(page);
  const pair = fast.clips.filter((c: { assetId: string }) => c.assetId === fast.assets[0].id);
  expect(pair.every((c: { speed: number }) => c.speed === 2)).toBe(true);
  expect(pair[0].duration).toBe(pair[1].duration);
  await page.getByRole('button', { name: '원본 오디오 잠금', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '삭제 · 빈 공간 유지 (Delete)', exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel('클립 속도')).toBeDisabled();
  await page.getByRole('button', { name: '원본 오디오 잠금 해제', exact: true }).click();
  const hit = (await page
    .getByRole('button', { name: '원본 오디오 단독 재생', exact: true })
    .boundingBox())!;
  expect(hit.width).toBeGreaterThanOrEqual(32);
  expect(hit.height).toBeGreaterThanOrEqual(32);
  await page.getByRole('button', { name: '원본 오디오 단독 재생', exact: true }).click();
  expect(
    (await saved(page)).tracks.find((t: { name: string }) => t.name === '원본 오디오').solo,
  ).toBe(true);
  await page.getByRole('button', { name: '프로젝트 메뉴', exact: true }).click();
  await page.getByRole('button', { name: '전체 음량 검사 · 피크 정규화', exact: true }).click();
  await expect(page.locator('.processing-status')).toHaveCount(0);
  await expect.poll(async () => (await saved(page)).masterVolume).toBe(4);
  // Draw a box across both visual rows, starting in a genuinely empty part of the top layer.
  await page.getByRole('separator', { name: '타임라인 높이' }).focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowUp');
  const lanes = page.locator('.track-lane');
  await lanes.first().scrollIntoViewIfNeeded();
  const top = (await lanes.first().boundingBox())!,
    second = (await lanes.nth(1).boundingBox())!,
    zoom = Number(await page.getByLabel('타임라인 확대', { exact: true }).inputValue());
  await page.mouse.move(top.x + 5.5 * zoom, top.y + 50);
  await page.mouse.down();
  await page.mouse.move(top.x + 20, second.y + second.height - 5, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.clip-selected')).toHaveCount(3);
  await page.getByRole('button', { name: '선택 클립 그룹화', exact: true }).click();
  expect(new Set((await saved(page)).clips.map((c: { groupId: string }) => c.groupId)).size).toBe(
    1,
  );
  const pngWait = page.waitForEvent('download');
  await page.getByRole('button', { name: '정지 프레임', exact: true }).click();
  await (await pngWait).saveAs('artifacts/audit-freeze.png');
  await expect(page.locator('.asset-card')).toHaveCount(4);
  await page.getByRole('button', { name: '프로젝트 메뉴', exact: true }).click();
  await page.getByRole('button', { name: '프로젝트 복제', exact: true }).click();
  await expect(page.getByLabel('프로젝트 이름')).toHaveValue('감사 원본 복사본');
  await saved(page);
  await page.getByRole('button', { name: '프로젝트 메뉴', exact: true }).click();
  await page.getByRole('button', { name: '사용하지 않는 원본 정리', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('모든 프로젝트');
  await page.getByRole('button', { name: '프로젝트 메뉴', exact: true }).click();
  await page.getByRole('button', { name: '최근 프로젝트 · 저장소', exact: true }).click();
  await page
    .locator('.recent-list button')
    .filter({ has: page.getByText('감사 원본', { exact: true }) })
    .click();
  await expect(page.getByLabel('프로젝트 이름')).toHaveValue('감사 원본');
  await saved(page);
  await page.reload();
  await expect(page.getByLabel('프로젝트 이름')).toHaveValue('감사 원본');
  await expect(page.locator('.asset-card')).toHaveCount(4);
  await expect(page.locator('.missing-banner')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/audit-tools.png' });
  await fs.writeFile('artifacts/audit-tools.json', JSON.stringify(await saved(page), null, 2));
});
test('IndexedDB v1 upgrades without losing the recent project or its local original', async ({
  page,
}) => {
  await page.route('http://localhost:5174/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Migration fixture</title>',
    }),
  );
  await page.goto('/');
  await page.evaluate(async () => {
    const modelUrl = '/src/model.ts',
      fixtureUrl = '/tests/fixtures.browser.ts',
      engineUrl = '/src/engine.ts';
    const { emptyProject, addAsset } = await import(/* @vite-ignore */ modelUrl),
      { makeFixtures } = await import(/* @vite-ignore */ fixtureUrl),
      { inspect } = await import(/* @vite-ignore */ engineUrl);
    const f = (await makeFixtures())[0],
      file = new File([new Uint8Array(f.bytes)], f.name, { type: f.mimeType }),
      a = await inspect(file);
    a.stored = true;
    const p = addAsset(emptyProject(), a, 0);
    p.name = '이전 버전 복구';
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open('cyancut-local', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('project');
        r.result.createObjectStore('files');
      };
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const tx = r.result.transaction(['project', 'files'], 'readwrite');
        tx.objectStore('project').put(p, 'recent');
        tx.objectStore('files').put(file, a.id);
        tx.oncomplete = () => {
          r.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.unroute('http://localhost:5174/');
  await page.reload();
  await expect(page.getByLabel('프로젝트 이름')).toHaveValue('이전 버전 복구');
  await expect(page.locator('.timeline-clip.video')).toHaveCount(1);
  await expect(page.locator('.missing-banner')).toHaveCount(0);
  await saved(page);
  await page.getByRole('button', { name: '프로젝트 메뉴', exact: true }).click();
  await page.getByRole('button', { name: '최근 프로젝트 · 저장소', exact: true }).click();
  await expect(page.locator('.recent-list button')).toHaveCount(1);
});
test('touch track controls have at least 44px hit areas and readable notices', async ({
  browser,
}) => {
  const context = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 768, height: 1024 },
    }),
    page = await context.newPage();
  try {
    await page.goto('http://localhost:5174');
    await expect(page.locator('.output-support')).toContainText('MP4');
    const controls = await page.locator('.track-controls .icon-button').evaluateAll((nodes) =>
      nodes.map((n) => ({
        width: n.getBoundingClientRect().width,
        height: n.getBoundingClientRect().height,
      })),
    );
    for (const box of controls) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const fonts = await page
      .locator('.save-option,.small-note,.output-support')
      .evaluateAll((nodes) => nodes.map((n) => parseFloat(getComputedStyle(n).fontSize)));
    for (const font of fonts) expect(font).toBeGreaterThanOrEqual(12);
    await fs.writeFile(
      'artifacts/touch-hit-areas.json',
      JSON.stringify({ controls, fonts }, null, 2),
    );
  } finally {
    await context.close();
  }
});
