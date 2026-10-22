import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';

const url = process.env.BENCH_URL ?? 'http://localhost:5175';
const output = process.env.BENCH_REPORT ?? 'artifacts/startup-performance.json';
const browser = await chromium.launch({ channel: process.env.TEST_CHANNEL ?? 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
const resources = [],
  pending = [],
  errors = [];
context.on('requestfinished', (request) =>
  pending.push(
    (async () => {
      const response = await request.response();
      if (!response || !/^https?:/.test(request.url())) return;
      const path = new URL(request.url()).pathname;
      const group = /mediabunny-(mp3|aac)-encoder.*\.js$/.test(path)
        ? 'encoder-js-with-embedded-wasm'
        : /\.js$/.test(path)
          ? 'js'
          : /\.css$/.test(path)
            ? 'css'
            : /\.(woff2?|ttf|otf)$/.test(path)
              ? 'font'
              : /\.wasm$/.test(path)
                ? 'standalone-wasm'
                : 'other';
      const sizes = await request.sizes();
      resources.push({
        path,
        group,
        status: response.status(),
        // Playwright reports only ~113 bytes for some dedicated Worker bodies.
        // Keep these unknown rather than publishing an implausible wire total.
        reportedEncodedBodyBytes: /worker.*\.js$/i.test(path) ? null : sizes.responseBodySize,
        decodedBodyBytes: (await response.body()).byteLength,
        cacheControl: response.headers()['cache-control'] ?? null,
      });
    })(),
  ),
);
page.on('pageerror', (e) => errors.push(e.message));
try {
  await (
    await context.newCDPSession(page)
  ).send('Network.setCacheDisabled', { cacheDisabled: true });
  const started = performance.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '프로젝트 메뉴', exact: true }).click();
  await page.locator('.project-menu').waitFor({ state: 'visible' });
  const firstVerifiedActionMs = performance.now() - started;
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => !document.querySelector('.output-support')?.textContent?.includes('확인 중'),
  );
  const capabilityReadyMs = performance.now() - started;
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);
  await Promise.all(pending);
  const groups = {};
  for (const row of resources) {
    const group = (groups[row.group] ??= {
      requests: 0,
      reportedEncodedBodyBytes: 0,
      unknownEncodedRequests: 0,
      decodedBodyBytes: 0,
    });
    group.requests++;
    if (row.reportedEncodedBodyBytes === null) group.unknownEncodedRequests++;
    else group.reportedEncodedBodyBytes += row.reportedEncodedBodyBytes;
    group.decodedBodyBytes += row.decodedBodyBytes;
  }
  const report = {
    url,
    measuredAt: new Date().toISOString(),
    runtime: process.version,
    host: {
      platform: os.platform(),
      release: os.release(),
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      memoryBytes: os.totalmem(),
    },
    userAgent: await page.evaluate(() => navigator.userAgent),
    hardwareEncoder: 'not observable; not measured by this startup test',
    firstVerifiedActionMs,
    capabilityReadyMs,
    groups,
    resources,
    errors,
    scope:
      'Fresh context, cache disabled; first verified menu click, not standardized TTI. Worker decoded sizes included, Worker wire sizes unknown. Other wire sizes are Playwright-reported, not a packet capture. Encoders embed WASM in JS; byte categories do not double-count. No media uploaded.',
  };
  await fs.mkdir('artifacts', { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, firstVerifiedActionMs, capabilityReadyMs, groups, errors }));
  if (errors.length || resources.some((r) => r.status >= 400)) process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
