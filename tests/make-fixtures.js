// Generates the fictional fixtures used by __demo and smoke.spec.js:
//   tests/fixtures/thesis-draft.pdf  4 pages (title, two body pages, references), page 3 is landscape
//   tests/fixtures/encrypted.pdf     a tiny PDF with an /Encrypt entry, to test the unsupported message
// Run: node tests/make-fixtures.js
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('../vendor/pdf-lib/pdf-lib.min.js');

const out = (name) => path.join(__dirname, 'fixtures', name);
const A4 = [595.28, 841.89];

function wrap(text, font, size, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

async function thesis() {
  const doc = await PDFDocument.create();
  doc.setTitle('Thesis Draft');
  doc.setAuthor('Mira Okafor');
  doc.setProducer('fixture generator');
  doc.setCreator('fixture generator');
  const fixed = new Date('2026-01-15T10:00:00Z');
  doc.setCreationDate(fixed);
  doc.setModificationDate(fixed);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const ink = rgb(0.12, 0.12, 0.14);

  // Page 1: title page
  const title = doc.addPage(A4);
  const center = (page, text, font, size, y) => page.drawText(text, { x: (page.getWidth() - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color: ink });
  center(title, 'Thesis Draft', bold, 30, 560);
  center(title, 'Tidal Patterns in Small Coastal Lagoons', serif, 17, 520);
  center(title, 'Mira Okafor', serif, 15, 440);
  center(title, 'Department of Marine Studies, Lakemoor Institute', serif, 12, 416);
  center(title, 'Working draft for supervisor review', serif, 12, 392);

  const body = (page, heading, paragraphs) => {
    const left = 72;
    const width = page.getWidth() - left * 2;
    let y = page.getHeight() - 90;
    page.drawText(heading, { x: left, y, size: 18, font: bold, color: ink });
    y -= 34;
    for (const p of paragraphs) {
      for (const line of wrap(p, serif, 12, width)) { page.drawText(line, { x: left, y, size: 12, font: serif, color: ink }); y -= 17; }
      y -= 10;
    }
  };
  const para = 'Small lagoons along sheltered coasts fill and drain with every tide, yet the timing of that exchange is rarely measured in detail. This chapter describes a simple method for logging water level with low cost sensors, and compares the readings with tide tables for the nearest harbour.';
  const para2 = 'The results suggest that narrow inlets delay the peak level inside the lagoon by a predictable amount, which matters for anyone planning field work, boat access or habitat surveys at the water edge.';

  body(doc.addPage(A4), 'Chapter One: Introduction', [para, para2, para]);
  body(doc.addPage([A4[1], A4[0]]), 'Chapter Two: Measurements', [para2, para, para2]);
  body(doc.addPage(A4), 'References', [
    'Adebayo, T. and Lind, R. Water levels in shallow basins. Journal of Imaginary Coasts, volume four.',
    'Okafor, M. Notes on inlet width and tidal delay. Unpublished field notebook.',
    'Varga, E. A practical guide to low cost sensors. Example Press.',
  ]);
  fs.writeFileSync(out('thesis-draft.pdf'), await doc.save({ useObjectStreams: false }));
}

function encrypted() {
  const pad = '0'.repeat(64);
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>',
    `<< /Filter /Standard /V 1 /R 2 /O <${pad}> /U <${pad}> /P -4 >>`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Encrypt 4 0 R /ID [<${pad.slice(0, 32)}> <${pad.slice(0, 32)}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(out('encrypted.pdf'), pdf, 'latin1');
}

thesis().then(encrypted).then(() => console.log('fixtures written'));
