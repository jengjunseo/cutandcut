import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

test('temporary housekeeping preserves a result held by another dialog', async ({ page }) => {
  test.skip(!!process.env.TEST_URL, 'Imports the local storage helper.');
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const url = '/src/export-files.ts';
    const { exportFolder, holdExportFile, pruneExportFiles } = await import(/* @vite-ignore */ url);
    const folder = await exportFolder(true);
    const held = crypto.randomUUID(),
      abandoned = crypto.randomUUID();
    for (const id of [held, abandoned]) {
      const stream = await (await folder.getFileHandle(id, { create: true })).createWritable();
      await stream.write('result');
      await stream.close();
    }
    const release = await holdExportFile(held);
    const now = Date.now;
    Date.now = () => now() + 48 * 3600_000;
    try {
      await pruneExportFiles();
      const preserved = await (await folder.getFileHandle(held)).getFile();
      const removed = await folder.getFileHandle(abandoned).then(
        () => false,
        () => true,
      );
      return { preserved: await preserved.text(), removed };
    } finally {
      Date.now = now;
      release();
      await folder.removeEntry(held);
    }
  });
  expect(result).toEqual({ preserved: 'result', removed: true });
});

test('large destination cancellation leaves its existing file and project intact', async ({
  page,
}) => {
  test.skip(!!process.env.TEST_URL, 'Uses a real local OPFS handle as a picker destination.');
  await page.addInitScript(() => {
    (window as any).showSaveFilePicker = async () => {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle('destination-cancel.wav', { create: true });
      const writable = await handle.createWritable();
      await writable.write('keep existing file');
      await writable.close();
      return handle;
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /제목 추가/ }).click();
  await page.getByRole('spinbutton', { name: '길이 (초)', exact: true }).fill('2000');
  await page.getByRole('spinbutton', { name: '길이 (초)', exact: true }).press('Enter');
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByLabel('파일 형식').selectOption('wav');
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.locator('.export-progress strong')).toContainText('오디오 믹싱');
  await page.getByRole('button', { name: '내보내기 취소', exact: true }).click();
  await expect(page.locator('.export-cancelled')).toContainText('프로젝트는 유지');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        return (await (await root.getFileHandle('destination-cancel.wav')).getFile()).text();
      }),
    )
    .toBe('keep existing file');
  await page.getByRole('button', { name: '돌아가기', exact: true }).click();
  await expect(page.locator('.timeline-clip.text')).toHaveCount(1);
  await expect(page.getByRole('spinbutton', { name: '길이 (초)', exact: true })).toHaveValue(
    '2000',
  );
});

test('save picker dismissal can retry without starting an output worker', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).showSaveFilePicker = async () => {
      throw new DOMException('User cancelled', 'AbortError');
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /제목 추가/ }).click();
  await page.getByRole('spinbutton', { name: '길이 (초)', exact: true }).fill('2000');
  await page.getByRole('spinbutton', { name: '길이 (초)', exact: true }).press('Enter');
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByLabel('파일 형식').selectOption('wav');
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
    await expect(page.locator('.export-cancelled')).toContainText('프로젝트는 유지');
  }
});

test('94-minute PCM output exceeds 1GiB and is a playable, seekable file', async () => {
  test.skip(
    process.env.RUN_LARGE_EXPORT !== '1',
    'Opt in: writes a real >1GiB output and download.',
  );
  test.setTimeout(600_000);
  const disk = await fs.statfs('.');
  expect(disk.bavail * disk.bsize).toBeGreaterThan(4 * 1024 ** 3);
  await fs.mkdir('artifacts', { recursive: true });
  // A regular temporary profile uses disk-backed OPFS; private contexts may have a smaller real quota.
  const profile = await fs.mkdtemp(path.resolve('artifacts/large-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: process.env.TEST_CHANNEL ?? 'chrome',
    headless: true,
    acceptDownloads: true,
    baseURL: process.env.TEST_URL ?? 'http://localhost:5174',
  });
  const page = await context.newPage();
  try {
    await page.addInitScript(() => {
      (window as any).showSaveFilePicker = async () => {
        return (await navigator.storage.getDirectory()).getFileHandle('large-direct.wav', {
          create: true,
        });
      };
    });
    await page.goto('/');
    await page.getByRole('button', { name: '텍스트', exact: true }).click();
    await page.getByRole('button', { name: /제목 추가/ }).click();
    await page.getByRole('spinbutton', { name: '길이 (초)', exact: true }).fill('5640');
    await page.getByRole('spinbutton', { name: '길이 (초)', exact: true }).press('Enter');
    await page.getByRole('button', { name: '내보내기', exact: true }).click();
    await expect(page.getByLabel('파일 형식')).toBeEnabled();
    await page.getByLabel('파일 형식').selectOption('wav');
    await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
    await expect(page.locator('.export-success, .export-error')).toBeVisible({ timeout: 480_000 });
    expect(await page.locator('.export-error').allTextContents()).toEqual([]);
    console.log('94-minute export completed; checking playback and download');
    await expect(page.getByText('선택한 위치에 저장했습니다.', { exact: false })).toBeVisible();
    const result = await page.evaluate(async () => {
      const file = await (
        await (await navigator.storage.getDirectory()).getFileHandle('large-direct.wav')
      ).getFile();
      const audio = document.createElement('audio');
      const url = URL.createObjectURL(file);
      try {
        audio.src = url;
        await new Promise<void>((resolve, reject) => {
          audio.onloadedmetadata = () => resolve();
          audio.onerror = () => reject(new Error('WAV metadata failed'));
        });
        const duration = audio.duration;
        for (const t of [2820, 5639]) {
          const seeking = new Promise<void>((resolve, reject) => {
            audio.onseeked = () => resolve();
            audio.onerror = () => reject(new Error('WAV seek failed'));
          });
          audio.currentTime = t;
          await seeking;
        }
        return {
          bytes: file.size,
          duration,
          seek: audio.currentTime,
          userAgent: navigator.userAgent,
          storage: await navigator.storage.estimate(),
          profile: 'persistent-test-profile',
        };
      } finally {
        audio.removeAttribute('src');
        audio.load();
        URL.revokeObjectURL(url);
      }
    });
    expect(result.bytes).toBeGreaterThan(1024 ** 3);
    expect(result.duration).toBeCloseTo(5640, 2);
    expect(result.seek).toBe(5639);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: '파일 다운로드', exact: true }).click();
    const download = await downloading;
    const path = (await download.path())!;
    expect((await fs.stat(path)).size).toBe(result.bytes);
    const handle = await fs.open(path, 'r');
    try {
      const header = Buffer.alloc(256);
      await handle.read(header, 0, header.length, 0);
      expect(header.toString('ascii', 0, 4)).toBe('RIFF');
      expect(header.toString('ascii', 8, 12)).toBe('WAVE');
      expect(header.readUInt32LE(header.indexOf('data') + 4)).toBe(5640 * 48000 * 4);
    } finally {
      await handle.close();
    }
    await fs.mkdir('artifacts', { recursive: true });
    await download.saveAs('artifacts/94-minutes-over-1GiB.wav');
    await fs.writeFile('artifacts/unbounded-output.json', JSON.stringify(result, null, 2));
  } finally {
    await context.close();
    // Only this freshly-created, task-owned profile under artifacts is eligible for recursive removal.
    if (
      path.dirname(profile) !== path.resolve('artifacts') ||
      !path.basename(profile).startsWith('large-profile-')
    )
      throw new Error('Unexpected test profile path');
    await fs.rm(profile, { recursive: true, force: true });
  }
});
