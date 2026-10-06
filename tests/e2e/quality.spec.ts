import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
test('quality: project switches terminate waveforms after file import completes', async ({
  page,
}) => {
  await page.goto('/');
  const input = (await samples(page))[0];
  await page.evaluate(() => {
    const state = { posted: 0, terminated: 0 };
    Object.assign(window, { waveAudit: state });
    const waves = new WeakSet<Worker>(),
      send = Worker.prototype.postMessage,
      stop = Worker.prototype.terminate;
    Worker.prototype.postMessage = function (data, options) {
      const opts = Array.isArray(options) ? { transfer: options } : options;
      if (data.type === 'waveform') {
        waves.add(this);
        state.posted++;
        const worker = this;
        setTimeout(() => send.call(worker, data, opts), 3000);
      } else send.call(this, data, opts);
    };
    Worker.prototype.terminate = function () {
      if (waves.has(this)) state.terminated++;
      stop.call(this);
    };
  });
  await page.getByLabel('미디어 파일 선택').setInputFiles({
    name: input.name,
    mimeType: input.mimeType,
    buffer: Buffer.from(input.bytes),
  });
  await expect(page.locator('.asset-card')).toHaveCount(1);
  await expect(page.locator('.import-progress')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { waveAudit: { posted: number } }).waveAudit.posted,
      ),
    )
    .toBe(1);
  await menu(page, '새 프로젝트');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { waveAudit: { terminated: number } }).waveAudit.terminated,
      ),
    )
    .toBe(1);
  await expect(page.locator('.asset-card')).toHaveCount(0);
});
async function menu(page: Page, name: string) {
  await page.getByRole('button', { name: '프로젝트 메뉴', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}
async function samples(page: Page) {
  return page.evaluate(async () => {
    const url = '/tests/fixtures.browser.ts';
    return (await import(/* @vite-ignore */ url)).makeFixtures();
  });
}
test('quality: immediate new/JSON switches flush edits, reset history, and preserve on save failure', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /제목 추가/ }).click();
  await page.getByLabel('텍스트 내용').fill('전환 직전 마지막 편집');
  await page.getByLabel('텍스트 내용').press('Tab');
  await menu(page, '새 프로젝트');
  await expect(page.locator('.timeline-clip')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '실행 취소 (Ctrl/Cmd+Z)', exact: true }),
  ).toBeDisabled();
  const original = await page.evaluate(async () => {
    const url = '/src/storage.ts';
    return (await import(/* @vite-ignore */ url))
      .recentProjects()
      .then(
        (rows: { project: { clips: unknown[] } }[]) =>
          rows.find((r) => r.project.clips.length)?.project,
      );
  });
  expect(original.clips[0].text.text).toBe('전환 직전 마지막 편집');
  await page.getByLabel('프로젝트 파일 선택').setInputFiles({
    name: 'saved.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(original)),
  });
  await expect(page.locator('.timeline-clip')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: '실행 취소 (Ctrl/Cmd+Z)', exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'project') throw new DOMException('저장 실패 주입', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await menu(page, '새 프로젝트');
  await expect(page.locator('.save-state')).toContainText('전환 실패');
  await expect(page.locator('.timeline-clip')).toHaveCount(1);
  await page.locator('.timeline-clip').click();
  await expect(page.getByLabel('텍스트 내용')).toHaveValue('전환 직전 마지막 편집');
});
test('quality: delayed media analysis cannot enter another project', async ({ page }) => {
  await page.goto('/');
  const input = (await samples(page))[0];
  await page.evaluate(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (data, options) {
      const opts = Array.isArray(options) ? { transfer: options } : options;
      if (data.type === 'probe') {
        const worker = this;
        setTimeout(() => send.call(worker, data, opts), 2500);
      } else send.call(this, data, opts);
    };
  });
  await page.getByLabel('미디어 파일 선택').setInputFiles({
    name: input.name,
    mimeType: input.mimeType,
    buffer: Buffer.from(input.bytes),
  });
  await expect(page.locator('.import-progress')).toBeVisible();
  await menu(page, '새 프로젝트');
  await expect(page.locator('.import-progress')).toHaveCount(0);
  await page.waitForTimeout(3000);
  await expect(page.locator('.asset-card')).toHaveCount(0);
  await expect(page.locator('.timeline-clip')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.asset-card')).toHaveCount(0);
});
test('quality: failed MP3/AAC modules leave real WAV and WebM export usable', async ({ page }) => {
  await page.addInitScript(() => {
    const check = AudioEncoder.isConfigSupported.bind(AudioEncoder);
    AudioEncoder.isConfigSupported = async (c) =>
      c.codec.startsWith('mp4a') ? { supported: false, config: c } : check(c);
  });
  await page.route('**/src/engine.worker.ts?*', async (route) => {
    if (!route.request().url().includes('worker_file')) return route.continue();
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `const __check=AudioEncoder.isConfigSupported.bind(AudioEncoder);AudioEncoder.isConfigSupported=async c=>c.codec.startsWith('mp4a')?{supported:false,config:c}:__check(c);\n${await response.text()}`,
    });
  });
  await page.route(/mediabunny.*(?:mp3|aac)[-_]encoder/, (route) => route.abort('failed'));
  await page.goto('/');
  // Fixtures are built in another unmodified context so unavailable AAC is an output failure only.
  const fixturePage = await page.context().browser()!.newPage();
  await fixturePage.goto('http://localhost:5174');
  const input = (await samples(fixturePage)).find((f: { name: string }) => f.name === 'music.wav')!;
  await fixturePage.close();
  await page.getByLabel('가져오면서 타임라인에 연속 배치').check();
  await page.getByLabel('미디어 파일 선택').setInputFiles({
    name: input.name,
    mimeType: input.mimeType,
    buffer: Buffer.from(input.bytes),
  });
  await expect(page.locator('.import-progress')).toHaveCount(0);
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByLabel('파일 형식')).toBeEnabled();
  await page.getByLabel('파일 형식').selectOption('wav');
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByText('내보내기가 완료됐습니다.')).toBeVisible();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 다운로드', exact: true }).click();
  const bytes = await fs.readFile((await (await waiting).path())!);
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.length).toBeGreaterThan(48000 * 4);
  expect(bytes.some((v, i) => i > 44 && v !== 0)).toBe(true);
  await fs.writeFile('artifacts/quality-fallback.wav', bytes);
  await page.getByRole('button', { name: '편집으로 돌아가기', exact: true }).click();
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.getByLabel('파일 형식').selectOption('webm');
  await page.getByRole('dialog').getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByText('내보내기가 완료됐습니다.')).toBeVisible();
  await expect
    .poll(() => page.locator('.output-player').evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2);
});
test('quality: overlong real media and edits are rejected before corrupt persistence', async ({
  page,
}) => {
  await page.goto('/');
  const input = await page.evaluate(async () => {
    const url = '/tests/fixtures.browser.ts';
    return (await import(/* @vite-ignore */ url)).makeLongFixture();
  });
  await page.getByLabel('가져오면서 타임라인에 연속 배치').check();
  await page.getByLabel('미디어 파일 선택').setInputFiles({
    name: input.name,
    mimeType: input.mimeType,
    buffer: Buffer.from(input.bytes),
  });
  await expect(page.locator('.import-progress')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('60분');
  await expect(page.locator('.asset-card')).toHaveCount(0);
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /제목 추가/ }).click();
  await page.getByRole('spinbutton', { name: '시작 (초)', exact: true }).fill('3600');
  await page.getByRole('spinbutton', { name: '시작 (초)', exact: true }).press('Enter');
  await expect(page.getByRole('spinbutton', { name: '시작 (초)', exact: true })).toHaveValue('0');
  await page.getByRole('spinbutton', { name: '길이 (초)', exact: true }).fill('600');
  await page.getByRole('spinbutton', { name: '길이 (초)', exact: true }).press('Enter');
  await expect(page.getByRole('spinbutton', { name: '길이 (초)', exact: true })).toHaveValue('600');
  await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
  await page.reload();
  await expect(page.locator('.timeline-clip')).toHaveCount(1);
  await page.locator('.timeline-clip').click();
  await expect(page.getByRole('spinbutton', { name: '길이 (초)', exact: true })).toHaveValue('600');
});
test('quality: gap impact, caption output targets and export-only settings are explicit', async ({
  page,
}) => {
  await page.goto('/');
  const project = await page.evaluate(async () => {
    const url = '/src/model.ts';
    const m = await import(/* @vite-ignore */ url),
      p = m.emptyProject();
    const text = {
      text: '내용',
      size: 32,
      color: '#fff',
      bold: false,
      align: 'center',
      outline: 0,
      shadow: false,
      background: 'transparent',
    };
    const clip = (name: string, start: number, duration: number, track: number, role: string) => ({
      ...m.clipDefaults(),
      id: m.id(),
      kind: 'text',
      textRole: role,
      trackId: p.tracks[track].id,
      name,
      start: m.tick(start),
      duration: m.tick(duration),
      sourceIn: 0,
      text: { ...text, text: name },
    });
    p.clips = [
      clip('제목 앞', 0, 1, 0, 'title'),
      clip('제목 뒤', 2, 1, 0, 'title'),
      clip('관통 자막', 0, 3, 1, 'caption'),
    ];
    return p;
  });
  await page.getByLabel('프로젝트 파일 선택').setInputFiles({
    name: 'gap.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.locator('.timeline-clip')).toHaveCount(3);
  await page.locator('.timeline-clip').filter({ hasText: '제목 앞' }).click();
  await page.getByLabel('재생헤드 타임코드').fill('1.5');
  await page.getByLabel('재생헤드 타임코드').press('Enter');
  await page.getByRole('button', { name: '빈 구간 제거', exact: true }).click();
  const gap = page.getByRole('dialog', { name: '빈 구간 제거 영향' });
  await expect(gap).toContainText('1.000–2.000초');
  await expect(gap).toContainText('관통 자막');
  await gap.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.locator('.timeline-clip')).toHaveCount(3);
  await page.getByRole('button', { name: '자막', exact: true }).click();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'SRT 저장', exact: true }).click();
  const srt = await fs.readFile((await (await waiting).path())!, 'utf8');
  expect(srt).toContain('관통 자막');
  expect(srt).not.toContain('제목 앞');
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.getByRole('button', { name: '출력 설정 변경', exact: true }).click();
  await page.getByLabel('출력 화면 비율').selectOption('9:16');
  await expect(page.locator('.export-summary')).toContainText('1080 × 1920');
  await expect(page.locator('.export-note').first()).toContainText('17분 28초');
  await page.getByRole('radio', { name: '높음', exact: true }).check();
  await expect(page.locator('.export-note').first()).toContainText('8분 50초');
  await page.getByRole('button', { name: '돌아가기', exact: true }).click();
  await expect(page.locator('.preview-meta')).toContainText('1920 × 1080');
  await page.reload();
  await expect(page.locator('.preview-meta')).toContainText('1920 × 1080');
});
test('quality: portrait media preview survives mobile tabs and viewport resizing', async ({
  page,
}) => {
  await page.goto('/');
  const input = (await samples(page))[0];
  await page.setViewportSize({ width: 390, height: 844 });
  const navigation = page.locator('.mobile-navigation');
  await navigation.getByRole('button', { name: '미디어', exact: true }).click();
  await page.getByLabel('가져오면서 타임라인에 연속 배치').check();
  await page.getByLabel('미디어 파일 선택').setInputFiles({
    name: input.name,
    mimeType: input.mimeType,
    buffer: Buffer.from(input.bytes),
  });
  await expect(page.locator('.import-progress')).toHaveCount(0);
  await navigation.getByRole('button', { name: '속성', exact: true }).click();
  await page.getByRole('button', { name: '9:16', exact: true }).click();
  const sizes = [];
  for (const width of [390, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await navigation.getByRole('button', { name: '미디어', exact: true }).click();
    await navigation.getByRole('button', { name: '미리보기', exact: true }).click();
    const canvas = page.getByLabel('프로젝트 합성 영상');
    await expect.poll(async () => (await canvas.boundingBox())?.height ?? 0).toBeGreaterThan(20);
    const box = (await canvas.boundingBox())!;
    expect(box.width / box.height).toBeCloseTo(9 / 16, 2);
    sizes.push({ width, box });
    await expect
      .poll(() =>
        canvas.evaluate((c: HTMLCanvasElement) => {
          const rgb = c
            .getContext('2d')!
            .getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
          return rgb[0] - rgb[2];
        }),
      )
      .toBeGreaterThan(100);
  }
  await fs.writeFile('artifacts/quality-mobile-preview.json', JSON.stringify(sizes, null, 2));
});
