import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const phase = process.env.CAPTURE_PHASE ?? 'before',
  url = process.env.CAPTURE_URL ?? 'http://localhost:5175';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url);
  await page.getByRole('button', { name: '텍스트', exact: true }).click();
  await page.getByRole('button', { name: /제목 추가/ }).click();
  await page.getByLabel('텍스트 내용', { exact: true }).fill('아베무지카 오늘도 라이브');
  await page.waitForTimeout(900);
  const inputState = {
    input: await page.getByLabel('텍스트 내용', { exact: true }).inputValue(),
    label: await page.locator('.timeline-clip.text').first().innerText(),
    save: await page.locator('.save-state').innerText(),
  };
  await page.getByLabel('텍스트 내용', { exact: true }).press('Tab');
  const records = [];
  await fs.mkdir('artifacts/directive-screens', { recursive: true });
  for (const [width, height] of [
    [1440, 900],
    [1363, 936],
    [1280, 720],
    [1024, 768],
    [768, 1024],
    [640, 800],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    const metrics = await page.evaluate(() => {
      const c = document.querySelector('.canvas-wrap')?.getBoundingClientRect();
      const rows = [...document.querySelectorAll('.track-row')].map((r) =>
        r.getBoundingClientRect(),
      );
      const t = document.querySelector('.timeline-scroll')?.getBoundingClientRect();
      return {
        preview: { width: c?.width, height: c?.height },
        visibleTracks: rows.filter((r) => t && r.top >= t.top && r.bottom <= t.bottom).length,
        overflow: document.documentElement.scrollWidth > innerWidth,
        toolbarHeights: [
          ...document.querySelectorAll('.panel-top,.precision-tools,.timeline-toolbar'),
        ]
          .filter((e) => e.getClientRects().length)
          .map((e) => e.getBoundingClientRect().height),
      };
    });
    records.push({ width, height, ...metrics });
    await page.screenshot({ path: `artifacts/directive-screens/${phase}-${width}x${height}.png` });
  }
  await fs.writeFile(
    `artifacts/directive-layout-${phase}.json`,
    JSON.stringify({ inputState, records }, null, 2),
  );
} finally {
  await browser.close();
}
