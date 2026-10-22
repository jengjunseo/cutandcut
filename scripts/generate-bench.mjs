import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const browser = await chromium.launch({ channel: process.env.TEST_CHANNEL ?? 'chrome' });
try {
  const page = await browser.newPage();
  await page.goto(process.env.FIXTURE_URL ?? 'http://localhost:5174');
  await fs.mkdir('artifacts/bench-inputs', { recursive: true });
  for (const [id, width, height, seconds] of [
    ['A', 1920, 1080, 300],
    ['B', 1080, 1920, 300],
    ['C', 3840, 2160, 60],
  ]) {
    const bytes = await page.evaluate(
      async ({ width, height, seconds }) => {
        const url = '/tests/benchmark.browser.ts';
        return (await import(/* @vite-ignore */ url)).generateBenchmark(width, height, seconds);
      },
      { width, height, seconds },
    );
    const path = `artifacts/bench-inputs/synthetic-${id}.mp4`;
    await fs.writeFile(path, new Uint8Array(bytes));
    console.log(
      JSON.stringify({
        id,
        width,
        height,
        seconds,
        bytes: bytes.length,
        path,
        scope:
          'Synthetic low-complexity moving blocks and tone, SDR AVC/AAC 30fps; not phone/camera footage',
      }),
    );
  }
} finally {
  await browser.close();
}
