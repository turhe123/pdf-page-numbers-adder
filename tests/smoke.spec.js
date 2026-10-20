// smoke.spec.js — PDF Page Number Adder: the core action on the fictional 4 page thesis draft
// (tests/fixtures/thesis-draft.pdf, made by tests/make-fixtures.js). Covers every acceptance check in SPEC.md.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const fixture = (name) => path.join(__dirname, 'fixtures', name);
const THESIS = fixture('thesis-draft.pdf');

async function load(page, file = THESIS) {
  await page.goto('./');
  await page.setInputFiles('#file-input', file);
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#page-indicator')).toHaveText('Page 1 / 4');
}

async function applyAndDownload(page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#apply')]);
  expect(download.suggestedFilename()).toBe('thesis-draft_numbered.pdf');
  const bytes = fs.readFileSync(await download.path());
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  return bytes;
}

// Opens a PDF with the page's own pdf-lib and returns, per page, the decoded content streams and geometry.
async function inspect(page, bytes) {
  return page.evaluate(async (b64) => {
    const { PDFDocument, PDFArray, decodePDFRawStream } = window.PDFLib;
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const doc = await PDFDocument.load(raw);
    const text = (s) => new TextDecoder('latin1').decode(decodePDFRawStream(s).decode());
    return doc.getPages().map((p) => {
      const c = p.node.Contents();
      const streams = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
      return { content: streams.map(text).join('\n'), streams: streams.length, width: Math.round(p.getWidth()), height: Math.round(p.getHeight()) };
    });
  }, Buffer.from(bytes).toString('base64'));
}

// pdf-lib writes standard-font text as hex strings: "10" -> <3130> Tj
const tj = (label) => `<${Buffer.from(label, 'latin1').toString('hex').toUpperCase()}> Tj`;

test.describe('PDF Page Number Adder', () => {
  test('bottom center on the 4 page sample produces a PDF with the same 4 pages, each numbered', async ({ page }) => {
    await load(page);
    await page.check('#pos-7', { force: true });
    await expect(page.locator('#pos-name')).toHaveText('Bottom center');
    const bytes = await applyAndDownload(page);
    await expect(page.locator('#result-line')).toContainText('4 of 4 pages numbered');
    await expect(page.locator('#download')).toHaveText('Download thesis-draft_numbered.pdf');

    const before = await inspect(page, fs.readFileSync(THESIS));
    const after = await inspect(page, bytes);
    expect(after).toHaveLength(4);
    after.forEach((p, i) => {
      expect([p.width, p.height]).toEqual([before[i].width, before[i].height]); // landscape page 3 stays landscape
      expect(p.content).toContain(tj(String(i + 1)));
    });
    expect(after[2].width).toBeGreaterThan(after[2].height);

    // The download button in the result card works too (tap-to-download on mobile Safari).
    const [again] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
    expect(again.suggestedFilename()).toBe('thesis-draft_numbered.pdf');
  });

  test('preview shows "1 of 4" on page 1 with the Page X of Y format', async ({ page }) => {
    await load(page);
    await page.selectOption('#format', 'pagenofn');
    await expect(page.locator('#preview-label')).toHaveText('Page 1 of 4');
    await expect(page.locator('#preview-canvas')).toHaveAttribute('aria-label', /label "Page 1 of 4"/);
    // Arrow keys step through the pages.
    await page.locator('h1').click();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#page-indicator')).toHaveText('Page 2 / 4');
    await expect(page.locator('#preview-label')).toHaveText('Page 2 of 4');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#preview-label')).toHaveText('Page 1 of 4');

    const after = await inspect(page, await applyAndDownload(page));
    expect(after[0].content).toContain(tj('Page 1 of 4'));
    expect(after[3].content).toContain(tj('Page 4 of 4'));
  });

  test('start number 10 shows 10 on the first page', async ({ page }) => {
    await load(page);
    await page.fill('#start', '10');
    await expect(page.locator('#preview-label')).toHaveText('10');
    const after = await inspect(page, await applyAndDownload(page));
    expect(after[0].content).toContain(tj('10'));
    expect(after[3].content).toContain(tj('13'));
  });

  test('skipping the first page leaves page 1 unnumbered and N counts numbered pages', async ({ page }) => {
    await load(page);
    await page.selectOption('#format', 'nofn');
    await page.check('#skip-first');
    await expect(page.locator('#preview-label')).toHaveText('not numbered');
    await page.click('#next-page');
    await expect(page.locator('#preview-label')).toHaveText('1 of 3');
    const bytes = await applyAndDownload(page);
    await expect(page.locator('#result-line')).toContainText('3 of 4 pages numbered');

    const before = await inspect(page, fs.readFileSync(THESIS));
    const after = await inspect(page, bytes);
    expect(after[0].content).toBe(before[0].content); // page 1 untouched
    expect(after[0].streams).toBe(before[0].streams);
    expect(after[1].content).toContain(tj('1 of 3'));
    expect(after[3].content).toContain(tj('3 of 3'));
  });

  test('roman numerals, prefix and the unsupported character warning', async ({ page }) => {
    await load(page);
    await page.selectOption('#format', 'roman');
    await page.fill('#start', '4');
    await expect(page.locator('#preview-label')).toHaveText('iv');
    await page.fill('#prefix', 'Doc 7');
    await expect(page.locator('#preview-label')).toHaveText('Doc 7 iv');
    await page.fill('#prefix', 'Doc ✓');
    await expect(page.locator('#prefix-hint')).toContainText("can't be drawn");
    await expect(page.locator('#apply')).toBeDisabled();
    await page.fill('#prefix', 'Doc 7');
    await page.fill('#start', '4000');
    await expect(page.locator('#preview-label')).toHaveText('Doc 7 4000'); // above 3999 falls back to digits
  });

  test('wrong file types and encrypted PDFs show inline errors', async ({ page }) => {
    await page.goto('./');
    await page.setInputFiles('#file-input', fixture('sample.png'));
    await expect(page.locator('#results .alert--error')).toContainText('Not a PDF');
    await expect(page.locator('#workspace')).toBeHidden();

    await page.setInputFiles('#file-input', [fixture('sample.png'), THESIS]);
    await expect(page.locator('#results .alert--error')).toContainText('sample.png');
    await expect(page.locator('#workspace')).toBeVisible();

    await page.setInputFiles('#file-input', fixture('encrypted.pdf'));
    await expect(page.locator('#results .alert--error')).toContainText('encrypted');
  });

  test('layout works at 390px wide', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await load(page);
    await page.selectOption('#format', 'pagenofn');
    await page.click('#apply');
    await expect(page.locator('#download')).toBeVisible();
    const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    expect(widths.doc).toBeLessThanOrEqual(widths.win + 1);
    for (const sel of ['#preview-canvas', '#apply', '#download', '.pn__pos']) {
      const box = await page.locator(sel).boundingBox();
      expect(box.x, sel).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, sel).toBeLessThanOrEqual(391);
    }
  });

  test('__demo shows a finished result', async ({ page }) => {
    await page.goto('./');
    await page.evaluate(() => window.__demo());
    await expect(page.locator('#result-line')).toContainText('3 of 4 pages numbered');
    await expect(page.locator('#preview-label')).toHaveText('Page 1 of 3');
  });
});
