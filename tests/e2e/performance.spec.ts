import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import type { Project } from '../../src/model';

// Opt-in real-file harness. Never silently substitute synthetic media for missing camera files.
for (const scenario of [
  { id: 'A', variable: 'BENCH_INPUT_A', width: 1920, height: 1080, seconds: 300 },
  { id: 'B', variable: 'BENCH_INPUT_B', width: 1080, height: 1920, seconds: 300 },
  { id: 'C', variable: 'BENCH_INPUT_C', width: 3840, height: 2160, seconds: 60 },
]) {
  test(`media benchmark ${scenario.id}: import, scrub, 1080p export`, async ({ page }) => {
    const path = process.env[scenario.variable];
    test.skip(
      !path,
      `Set ${scenario.variable} to the real input file; no result is claimed without it.`,
    );
    test.setTimeout(30 * 60 * 1000);
    await fs.access(path!);
    await page.goto('/');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.name)); // No raw error text in report.
    if (scenario.id === 'B') await page.getByRole('button', { name: '9:16', exact: true }).click();
    await page.getByLabel('가져오면서 타임라인에 연속 배치').check();
    const cdp = await page.context().newCDPSession(page);
    let peakMainJsHeapBytes = 0;
    const sampleHeap = async () => {
      const usage = await cdp.send('Runtime.getHeapUsage');
      peakMainJsHeapBytes = Math.max(peakMainJsHeapBytes, usage.usedSize);
    };
    const importStart = performance.now();
    await page.getByLabel('미디어 파일 선택').setInputFiles(path!);
    await expect(page.locator('.timeline-clip.video')).toHaveCount(1, { timeout: 120000 });
    await expect(page.locator('.import-progress')).toHaveCount(0, { timeout: 120000 });
    const importToTimelineMs = performance.now() - importStart;
    console.log(JSON.stringify({ scenario: scenario.id, phase: 'imported', importToTimelineMs }));
    await expect(page.locator('.save-state')).toContainText('기기에 자동 저장됨');
    await page.getByRole('region', { name: '편집 타임라인', exact: true }).focus();
    const waitingProject = page.waitForEvent('download');
    await page.keyboard.press('Control+s');
    const p: Project = JSON.parse(
      await fs.readFile((await (await waitingProject).path())!, 'utf8'),
    );
    const asset = p.assets.find((a) => a.kind === 'video')!;
    expect([asset.width, asset.height]).toEqual([scenario.width, scenario.height]);
    expect(Math.abs(asset.duration / 1e6 - scenario.seconds)).toBeLessThan(1);
    expect(asset.videoCodec).toBe('avc');
    await sampleHeap();
    await page.evaluate(() => {
      const audit = { sent: 0, received: 0, latest: 0, arrived: 0, samples: [] as number[] };
      Object.assign(window, { mediaBench: audit });
      const send = Worker.prototype.postMessage;
      const listening = new WeakSet<Worker>();
      Worker.prototype.postMessage = function (data, options) {
        if (data.type === 'preview') {
          if (!listening.has(this)) {
            listening.add(this);
            this.addEventListener('message', (e) => {
              if (e.data.type === 'frame' && e.data.seq === audit.latest) {
                audit.received++;
                audit.arrived = e.data.seq;
                audit.samples.push(performance.now() - audit.sent);
              }
            });
          }
          audit.sent = performance.now();
          audit.latest = data.seq;
        }
        return send.call(this, data, Array.isArray(options) ? { transfer: options } : options);
      };
    });
    for (const fraction of [0.8, 0.2, 0.65, 0.1, 0.9, 0.4]) {
      await page.locator('.current-time').fill(String(scenario.seconds * fraction));
      await page.locator('.current-time').press('Enter');
    }
    // aria-busy describes first-frame readiness; a prior frame can remain visible while seeking.
    // Wait for the actual latest Worker frame, not an already-false UI loading flag.
    await page.waitForFunction(
      () => {
        const audit = (window as unknown as { mediaBench: { latest: number; arrived: number } })
          .mediaBench;
        return audit.latest > 0 && audit.arrived === audit.latest;
      },
      undefined,
      { timeout: 30000 },
    );
    await expect(page.locator('.canvas-wrap')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.preview-error')).toHaveCount(0);
    await sampleHeap();
    const scrub = await page.evaluate(
      () =>
        (window as unknown as { mediaBench: { received: number; samples: number[] } }).mediaBench
          .samples,
    );
    expect(scrub.length).toBeGreaterThan(0);
    await page.getByRole('button', { name: '내보내기', exact: true }).click();
    await expect(page.getByLabel('파일 형식')).toBeEnabled();
    await page.getByLabel('파일 형식').selectOption('mp4');
    const dialog = page.getByRole('dialog', { name: '내보내기', exact: true });
    const exportStart = performance.now();
    console.log(JSON.stringify({ scenario: scenario.id, phase: 'export-start' }));
    await dialog.getByRole('button', { name: '내보내기', exact: true }).click();
    while (!(await page.getByText('내보내기가 완료됐습니다.').isVisible())) {
      if (await dialog.locator('.export-error').count())
        throw new Error('Benchmark export failed; inspect the local browser error.');
      if (performance.now() - exportStart > 25 * 60 * 1000)
        throw new Error('Benchmark export exceeded 25 minutes.');
      await sampleHeap();
      await page.waitForTimeout(500);
    }
    const exportMs = performance.now() - exportStart;
    console.log(JSON.stringify({ scenario: scenario.id, phase: 'export-complete', exportMs }));
    await expect
      .poll(() => dialog.locator('video').evaluate((v: HTMLVideoElement) => v.readyState))
      .toBeGreaterThanOrEqual(2);
    const result = await dialog.locator('video').evaluate((v: HTMLVideoElement) => ({
      width: v.videoWidth,
      height: v.videoHeight,
      duration: v.duration,
    }));
    expect([result.width, result.height]).toEqual(
      scenario.id === 'B' ? [1080, 1920] : [1920, 1080],
    );
    expect(Math.abs(result.duration - scenario.seconds)).toBeLessThan(1);
    const decodedSeeks = [];
    for (const fraction of [0.1, 0.5, 0.9]) {
      decodedSeeks.push(
        await dialog.locator('video').evaluate(async (v: HTMLVideoElement, fraction) => {
          v.pause();
          await new Promise<void>((resolve, reject) => {
            const done = () => {
              clearTimeout(timer);
              resolve();
            };
            const timer = setTimeout(() => {
              v.removeEventListener('seeked', done);
              reject(new Error('Native output seek timed out'));
            }, 15000);
            v.addEventListener('seeked', done, { once: true });
            v.currentTime = v.duration * fraction;
          });
          return { time: v.currentTime, readyState: v.readyState };
        }, fraction),
      );
    }
    for (const seek of decodedSeeks) expect(seek.readyState).toBeGreaterThanOrEqual(2);
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: '파일 다운로드', exact: true }).click();
    await fs.mkdir('artifacts', { recursive: true });
    const outputPath = `artifacts/benchmark-${scenario.id}.mp4`;
    await (await waiting).saveAs(outputPath);
    await fs.writeFile(
      `artifacts/benchmark-${scenario.id}.json`,
      JSON.stringify(
        {
          scenario: scenario.id,
          sourceKind:
            process.env.BENCH_SOURCE_KIND === 'synthetic'
              ? 'synthetic-low-complexity-animation'
              : 'user-supplied-unclassified',
          measuredAt: new Date().toISOString(),
          host: {
            platform: os.platform(),
            release: os.release(),
            cpu: os.cpus()[0]?.model,
            logicalCpus: os.cpus().length,
            memoryBytes: os.totalmem(),
          },
          userAgent: await page.evaluate(() => navigator.userAgent),
          hardwareEncoder: 'not observable; WebCodecs support does not prove hardware acceleration',
          input: {
            width: asset.width,
            height: asset.height,
            durationUs: asset.duration,
            videoCodec: asset.videoCodec,
            audioCodec: asset.audioCodec,
          },
          output: { ...result, fps: p.fps, bytes: (await fs.stat(outputPath)).size, decodedSeeks },
          importToTimelineMs,
          exportMs,
          realtimeMultiplier: result.duration / (exportMs / 1000),
          scrubResponseMs: scrub,
          peakMainJsHeapBytes,
          errors,
          scope:
            'One run, original storage enabled, six fast seeks. Heap sampled every 500ms during export: main realm JS only, excludes Worker, PCM, decoder and GPU memory. Scrub samples are latest requested frame arrivals, not all intermediate requests. Private names/paths/content omitted. No original upload.',
        },
        null,
        2,
      ),
    );
    expect(errors).toEqual([]);
  });
}
