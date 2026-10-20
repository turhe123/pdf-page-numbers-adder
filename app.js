// app.js — PDF Page Number Adder. Everything runs on this device: the PDF is read and stamped in worker.js
// with pdf-lib; this file handles the UI, the label text and the schematic page preview.
import { toast, downloadBlob, formatBytes, wireDropzone } from './site.js';

const $ = (id) => document.getElementById(id);
const zone = $('dropzone');
const input = $('file-input');
const results = $('results');
const workspace = $('workspace');
const canvas = $('preview-canvas');
const applyBtn = $('apply');
const progressWrap = $('progress-wrap');
const progressBar = $('progress');
const progressText = $('progress-text');
const prefixHint = $('prefix-hint');
const PREFIX_HINT = prefixHint.textContent;

const POS_NAMES = ['Top left', 'Top center', 'Top right', 'Middle left', 'Middle center', 'Middle right', 'Bottom left', 'Bottom center', 'Bottom right'];
const CANVAS_FONTS = { helvetica: 'Helvetica, Arial, sans-serif', times: '"Times New Roman", Times, serif', courier: '"Courier New", Courier, monospace' };
const MM = 72 / 25.4;
const ASCENT = 0.72; // must match worker.js
// Characters the standard PDF fonts (WinAnsi encoding) can draw.
const UNSUPPORTED = /[^\x20-\x7E -ÿ–—‘-„†-•…‰‹›€™]/gu;

const state = { file: null, bytes: null, pages: [], current: 0, busy: false, result: null };

// ---------- worker ----------
let worker = null;
let nextId = 1;
const pending = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker('worker.js');
  worker.onmessage = (e) => {
    const job = pending.get(e.data.id);
    if (!job) return;
    if (e.data.type === 'progress') { job.onProgress?.(e.data); return; }
    pending.delete(e.data.id);
    if (e.data.type === 'error') job.reject(Object.assign(new Error(e.data.message), { kind: e.data.kind }));
    else job.resolve(e.data);
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    for (const job of pending.values()) job.reject(new Error(e.message || 'The PDF worker stopped unexpectedly.'));
    pending.clear();
    worker = null;
  };
  return worker;
}
function run(message, onProgress) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, onProgress });
    // The bytes are copied (not transferred) so the original stays available for another run.
    getWorker().postMessage({ id, ...message });
  });
}

// ---------- options & labels ----------
const intIn = (el, fallback, min, max) => {
  const n = Math.round(Number(el.value));
  return Number.isFinite(n) && el.value !== '' ? Math.min(max, Math.max(min, n)) : fallback;
};
function readOptions() {
  const pos = Number(document.querySelector('input[name="pos"]:checked')?.value ?? 7);
  return {
    row: Math.floor(pos / 3),
    col: pos % 3,
    pos,
    format: $('format').value,
    start: intIn($('start'), 1, 0, 999999),
    firstPage: intIn($('first-page'), 1, 1, 1e7),
    skipFirst: $('skip-first').checked,
    mirror: $('mirror').checked,
    prefix: $('prefix').value.trim(),
    font: $('font').value,
    size: intIn($('size'), 11, 4, 72),
    marginMm: Math.min(100, Math.max(0, Number($('margin').value) || 0)),
    color: $('color').value || '#333333',
  };
}

export function toRoman(n) {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n); // outside the roman range: digits
  const table = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of table) while (n >= v) { out += s; n -= v; }
  return out;
}

// One label per page (null = left unnumbered). N is the last number printed, so it stays right when pages are skipped.
export function computeLabels(pageCount, o) {
  let first = Math.max(1, o.firstPage);
  if (o.skipFirst) first = Math.max(first, 2);
  const count = Math.max(0, pageCount - first + 1);
  const last = o.start + count - 1;
  const labels = [];
  for (let p = 1; p <= pageCount; p++) {
    if (p < first) { labels.push(null); continue; }
    const n = o.start + (p - first);
    let text;
    switch (o.format) {
      case 'page': text = `Page ${n}`; break;
      case 'nofn': text = `${n} of ${last}`; break;
      case 'pagenofn': text = `Page ${n} of ${last}`; break;
      case 'roman': text = toRoman(n); break;
      default: text = String(n);
    }
    labels.push(o.prefix ? `${o.prefix} ${text}` : text);
  }
  return labels;
}

function unsupportedChars(text) {
  return [...new Set(text.match(UNSUPPORTED) || [])];
}

// ---------- preview ----------
function drawPreview() {
  if (!state.pages.length) return;
  const o = readOptions();
  const labels = computeLabels(state.pages.length, o);
  const i = state.current;
  const pg = state.pages[i];
  const label = labels[i];

  const stage = canvas.parentElement;
  const maxW = Math.max(160, Math.min(320, stage.clientWidth - 26));
  const maxH = 400;
  const scale = Math.min(maxW / pg.w, maxH / pg.h);
  const cssW = Math.round(pg.w * scale);
  const cssH = Math.round(pg.h * scale);
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0); // draw in PDF points, y down

  // Paper and schematic content lines.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, pg.w, pg.h);
  ctx.fillStyle = '#dfe2ea';
  const pad = Math.min(pg.w, pg.h) * 0.12;
  ctx.fillRect(pad, pad, (pg.w - pad * 2) * 0.55, 14);
  for (let y = pad + 36; y < pg.h - pad - 10; y += 18) {
    const short = ((y / 18) | 0) % 5 === 4;
    ctx.fillRect(pad, y, (pg.w - pad * 2) * (short ? 0.6 : 1), 6);
  }

  // Margin guide.
  const m = o.marginMm * MM;
  if (m > 0) {
    ctx.strokeStyle = 'rgba(91, 75, 219, 0.35)';
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash([4 / scale, 3 / scale]);
    ctx.strokeRect(m, m, pg.w - m * 2, pg.h - m * 2);
    ctx.setLineDash([]);
  }

  if (label) {
    ctx.font = `${o.size}px ${CANVAS_FONTS[o.font] || CANVAS_FONTS.helvetica}`;
    ctx.textBaseline = 'alphabetic';
    const tw = ctx.measureText(label).width;
    const col = o.mirror && (i + 1) % 2 === 0 ? 2 - o.col : o.col;
    const x = col === 0 ? m : col === 1 ? (pg.w - tw) / 2 : pg.w - m - tw;
    const asc = o.size * ASCENT;
    const yUp = o.row === 2 ? m : o.row === 1 ? (pg.h - asc) / 2 : pg.h - m - asc;
    ctx.fillStyle = o.color;
    ctx.fillText(label, x, pg.h - yUp);
  }

  const total = state.pages.length;
  $('page-indicator').textContent = `Page ${i + 1} / ${total}`;
  $('preview-label').textContent = label || 'not numbered';
  canvas.setAttribute('aria-label', `Preview of page ${i + 1} of ${total}${pg.rot ? `, rotated ${pg.rot}°` : ''}, ${label ? `label "${label}"` : 'no page number'}`);
  $('prev-page').disabled = i === 0;
  $('next-page').disabled = i === total - 1;
  $('pos-name').textContent = POS_NAMES[o.pos] + (o.mirror && o.col !== 1 ? ' (mirrored on even pages)' : '');

  // Prefix check: standard fonts only draw Latin characters.
  const bad = unsupportedChars(o.prefix);
  prefixHint.textContent = bad.length ? `These characters can't be drawn with the standard PDF fonts: ${bad.join(' ')}. Remove them to continue.` : PREFIX_HINT;
  prefixHint.classList.toggle('pn__warn', bad.length > 0);
  $('prefix').setAttribute('aria-invalid', bad.length ? 'true' : 'false');

  const numbered = labels.filter(Boolean).length;
  $('file-info').textContent = `${formatBytes(state.file.size)} · ${total} page${total === 1 ? '' : 's'} · ${numbered} will be numbered`;
  applyBtn.disabled = state.busy || bad.length > 0 || numbered === 0;
}

function goTo(index) {
  if (!state.pages.length) return;
  state.current = Math.max(0, Math.min(state.pages.length - 1, index));
  drawPreview();
}

// ---------- results & errors ----------
function showError(message) {
  const el = document.createElement('div');
  el.className = 'alert alert--error';
  el.setAttribute('role', 'alert');
  el.textContent = message;
  results.appendChild(el);
  el.scrollIntoView({ block: 'nearest' });
}

function outputName(name) {
  return `${name.replace(/\.pdf$/i, '') || 'document'}_numbered.pdf`;
}

function clearResult() {
  results.querySelectorAll('.result').forEach((el) => el.remove());
  state.result = null;
}

function showResult(blob, name, numbered, total) {
  clearResult();
  state.result = { blob, name };
  const card = document.createElement('div');
  card.className = 'result pn__result';
  card.innerHTML = `
    <svg class="pn__ok" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 9.5 17 19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div class="result__meta"><div class="result__name"></div><div class="result__info" id="result-line"></div></div>
    <button class="btn btn--primary" id="download" type="button"></button>`;
  card.querySelector('.result__name').textContent = name;
  card.querySelector('#result-line').textContent = `${numbered} of ${total} page${total === 1 ? '' : 's'} numbered · ${formatBytes(blob.size)}`;
  card.querySelector('#download').textContent = `Download ${name}`;
  // A tap on this button always works, also on mobile Safari where an automatic download after work may be blocked.
  card.querySelector('#download').addEventListener('click', () => downloadBlob(blob, name));
  results.appendChild(card);
  card.scrollIntoView({ block: 'nearest' });
}

function setProgress(p) {
  const pct = p.total ? Math.floor((p.done / p.total) * 100) : 0; // floor: 99.9% is not 100%
  progressBar.firstElementChild.style.width = `${pct}%`;
  progressBar.setAttribute('aria-valuenow', String(pct));
  progressText.textContent = p.phase === 'read' ? 'Reading the PDF…'
    : p.phase === 'save' ? `Saving ${p.total} page${p.total === 1 ? '' : 's'}…`
    : `Numbering page ${p.done} of ${p.total} (${pct}%)…`;
}

// ---------- loading ----------
const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

async function handleFiles(files) {
  results.replaceChildren();
  const pdfs = files.filter(isPdf);
  const rejected = files.filter((f) => !isPdf(f));
  if (rejected.length) showError(`Not a PDF, skipped: ${rejected.map((f) => f.name).join(', ')}. This tool numbers PDF files only.`);
  if (!pdfs.length) return;
  if (pdfs.length > 1) toast(`One PDF at a time: using ${pdfs[0].name}`);
  await loadPdf(pdfs[0]);
}

async function loadPdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  zone.setAttribute('aria-busy', 'true');
  try {
    const { pages } = await run({ type: 'inspect', bytes });
    if (!pages.length) throw Object.assign(new Error('no pages'), { kind: 'invalid' });
    Object.assign(state, { file, bytes, pages, current: 0, result: null });
    $('file-name').textContent = file.name;
    workspace.hidden = false;
    zone.classList.add('dropzone--compact');
    $('dropzone-title').innerHTML = 'Drop another PDF or <span class="link">choose a different file</span>';
    drawPreview();
  } catch (err) {
    if (err.kind === 'encrypted') showError(`${file.name} is encrypted or password protected, which is not supported. Remove the protection in the app that made it, then try again.`);
    else showError(`${file.name} could not be read as a PDF. It may be damaged or not really a PDF.`);
  } finally {
    zone.removeAttribute('aria-busy');
  }
}

// ---------- apply ----------
async function apply({ download = true } = {}) {
  if (!state.bytes || state.busy) return null;
  const o = readOptions();
  if (unsupportedChars(o.prefix).length) { showError('The prefix has characters the standard PDF fonts cannot draw. Remove them and try again.'); return null; }
  const labels = computeLabels(state.pages.length, o);
  if (!labels.some(Boolean)) { showError(`Nothing to number: the document has ${state.pages.length} page${state.pages.length === 1 ? '' : 's'}. Lower "First page to number".`); return null; }

  results.querySelectorAll('.alert--error').forEach((el) => el.remove());
  clearResult();
  state.busy = true;
  applyBtn.disabled = true;
  progressWrap.hidden = false;
  setProgress({ phase: 'read', done: 0, total: labels.length });
  try {
    const { bytes, numbered, total } = await run({ type: 'stamp', bytes: state.bytes, labels, opts: o }, setProgress);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const name = outputName(state.file.name);
    showResult(blob, name, numbered, total);
    if (download) downloadBlob(blob, name);
    return blob;
  } catch (err) {
    showError(err.kind === 'encrypted' ? 'This PDF is encrypted, which is not supported.' : `Numbering failed: ${err.message}`);
    return null;
  } finally {
    state.busy = false;
    progressWrap.hidden = true;
    drawPreview();
  }
}

// ---------- wiring ----------
wireDropzone(zone, input, handleFiles);
applyBtn.addEventListener('click', () => apply());
$('prev-page').addEventListener('click', () => goTo(state.current - 1));
$('next-page').addEventListener('click', () => goTo(state.current + 1));
workspace.addEventListener('input', (e) => {
  if (e.target.closest('.pn__options')) { clearResult(); drawPreview(); }
});
workspace.addEventListener('change', () => drawPreview());

document.addEventListener('keydown', (e) => {
  if (workspace.hidden || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target.closest?.('input, select, textarea, [contenteditable="true"]')) return; // let fields use their arrows
  if (e.key === 'ArrowRight') { e.preventDefault(); goTo(state.current + 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(state.current - 1); }
});
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawPreview, 120); });

// Called by the factory's screenshot script: loads the fictional thesis draft and shows a finished result.
window.__demo = async () => {
  const res = await fetch('./tests/fixtures/thesis-draft.pdf');
  const file = new File([await res.blob()], 'thesis-draft.pdf', { type: 'application/pdf' });
  await handleFiles([file]);
  $('format').value = 'pagenofn';
  $('skip-first').checked = true;
  goTo(1);
  await apply({ download: false });
};

export { handleFiles, apply };
