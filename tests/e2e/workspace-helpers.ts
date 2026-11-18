import type { Page } from '@playwright/test';
export async function closeMobilePanel(page: Page) {
  const close = page.locator('.mobile-sheet:not([hidden]) .sheet-heading > button');
  if (await close.isVisible()) await close.click();
}
export async function libraryOptions(page: Page) {
  const panel = page.locator('.library-import-options');
  if (!(await panel.isVisible())) {
    if (await page.locator('.mobile-dock').isVisible())
      await page
        .locator('.mobile-dock')
        .getByRole('button', { name: '미디어', exact: true })
        .click();
    else if (
      (await page
        .getByRole('button', { name: '미디어 패널', exact: true })
        .getAttribute('aria-pressed')) === 'false'
    )
      await page.getByRole('button', { name: '미디어 패널', exact: true }).click();
  }
  if (!(await panel.evaluate((e) => (e as HTMLDetailsElement).open)))
    await panel.locator(':scope > summary').click();
}
export async function viewOptions(page: Page) {
  const panel = page.locator('.preview-options');
  if (!(await panel.evaluate((e) => (e as HTMLDetailsElement).open)))
    await panel.locator(':scope > summary').click();
}
export async function precisionOptions(page: Page) {
  const panel = page.locator('.precision-menu');
  if (!(await panel.isVisible()) && (await page.locator('.mobile-dock').isVisible()))
    await page.locator('.mobile-dock').getByRole('button', { name: '더보기', exact: true }).click();
  if (!(await panel.evaluate((e) => (e as HTMLDetailsElement).open)))
    await panel.locator(':scope > summary').click();
}
export async function pixelsPerSecond(page: Page) {
  return page.locator('.ruler-tick').evaluateAll((nodes) => {
    for (const node of nodes) {
      const parts = (node.textContent ?? '').trim().split(':').map(Number),
        seconds = (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
      if (seconds > 0) return parseFloat((node as HTMLElement).style.left) / seconds;
    }
    throw new Error('No timeline ruler interval');
  });
}
