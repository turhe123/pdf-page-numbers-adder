// worker.js — reads and stamps the PDF off the main thread (classic worker, pdf-lib from vendor/).
// Messages in:  { id, type: 'inspect', bytes }            -> { id, type: 'inspected', pages: [{ w, h, rot }] }
//               { id, type: 'stamp', bytes, labels, opts } -> progress events, then { id, type: 'done', bytes, numbered }
// Errors:       { id, type: 'error', kind: 'encrypted' | 'invalid' | 'other', message }
importScripts('vendor/pdf-lib/pdf-lib.min.js');
const { PDFDocument, StandardFonts, rgb, degrees } = self.PDFLib;

const FONTS = { helvetica: StandardFonts.Helvetica, times: StandardFonts.TimesRoman, courier: StandardFonts.Courier };
const MM = 72 / 25.4;
const ASCENT = 0.72; // share of the font size above the baseline, used for top and middle rows (same as the preview)

const normRotation = (angle) => (((Math.round((angle || 0) / 90) * 90) % 360) + 360) % 360;

async function load(bytes) {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    const name = (err && (err.name || err.constructor?.name)) || '';
    if (/Encrypt/i.test(name) || /encrypt/i.test(String(err && err.message))) throw Object.assign(new Error('encrypted'), { kind: 'encrypted' });
    throw Object.assign(new Error(String(err && err.message || err)), { kind: 'invalid' });
  }
}

// Visible page geometry: the crop box, with width and height swapped when the page is turned sideways.
function geometry(page) {
  const box = page.getCropBox();
  const rot = normRotation(page.getRotation().angle);
  const sideways = rot === 90 || rot === 270;
  return { box, rot, w: sideways ? box.height : box.width, h: sideways ? box.width : box.height };
}

// Where the label's baseline starts, in the page's own (unrotated) coordinates.
function place(geo, textWidth, size, opts, pageNumber) {
  const { box, rot, w: W, h: H } = geo;
  const margin = opts.marginMm * MM;
  let col = opts.col;
  if (opts.mirror && pageNumber % 2 === 0) col = 2 - col;
  const dx = col === 0 ? margin : col === 1 ? (W - textWidth) / 2 : W - margin - textWidth;
  const asc = size * ASCENT;
  const dy = opts.row === 2 ? margin : opts.row === 1 ? (H - asc) / 2 : H - margin - asc;
  let rx = dx, ry = dy;
  if (rot === 90) { rx = box.width - dy; ry = dx; }
  else if (rot === 180) { rx = box.width - dx; ry = box.height - dy; }
  else if (rot === 270) { rx = dy; ry = box.height - dx; }
  return { x: box.x + rx, y: box.y + ry, rotate: degrees(rot) };
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x333333;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    if (type === 'inspect') {
      const doc = await load(e.data.bytes);
      const pages = doc.getPages().map((p) => { const g = geometry(p); return { w: g.w, h: g.h, rot: g.rot }; });
      self.postMessage({ id, type: 'inspected', pages });
      return;
    }
    if (type === 'stamp') {
      const { labels, opts } = e.data;
      self.postMessage({ id, type: 'progress', phase: 'read', done: 0, total: labels.length });
      const doc = await load(e.data.bytes);
      const font = await doc.embedFont(FONTS[opts.font] || StandardFonts.Helvetica);
      const color = hexToRgb(opts.color);
      const pages = doc.getPages();
      let numbered = 0;
      let lastPost = 0;
      for (let i = 0; i < pages.length; i++) {
        const text = labels[i];
        if (text) {
          const geo = geometry(pages[i]);
          const at = place(geo, font.widthOfTextAtSize(text, opts.size), opts.size, opts, i + 1);
          pages[i].drawText(text, { ...at, size: opts.size, font, color });
          numbered++;
        }
        const now = Date.now();
        if (now - lastPost > 80 || i === pages.length - 1) {
          lastPost = now;
          self.postMessage({ id, type: 'progress', phase: 'stamp', done: i + 1, total: pages.length });
        }
      }
      self.postMessage({ id, type: 'progress', phase: 'save', done: pages.length, total: pages.length });
      const out = await doc.save();
      self.postMessage({ id, type: 'done', bytes: out, numbered, total: pages.length }, [out.buffer]);
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', kind: err.kind || 'other', message: String(err && err.message || err) });
  }
};
