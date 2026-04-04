const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const config = require('../config');
const { getBothDates, getDisplayDateString } = require('../utils/hebrew-date');

const ACTOR_NAMES = {
  HAMAS: 'חמאס',
  HEZBOLLAH: 'חיזבאללה',
  IRAN: 'איראן',
  OTHERS: 'אחרים',
};

const DOMAIN_HEB = {
  KINETIC: 'קינטי',
  TERRAIN: 'שטח',
  SOCIAL: 'חברתי',
  CYBER: 'סייבר',
  GENERAL: 'כללי',
};

// ─── Build actor section — verbatim items only ────────────────────────────────

function buildActorSection(actorKey, actorData) {
  if (!actorData || !actorData.items || actorData.items.length === 0) return '';

  const items = actorData.items.map(item => {
    const domainLabel = DOMAIN_HEB[item.domain] || item.domain;
    const sourceLink = item.source_url
      ? `<a href="${item.source_url}" class="source-link">מקור ↗</a>`
      : '';
    const datetime = item.datetime ? `<span class="item-datetime">${item.datetime}</span>` : '';
    const showOriginal = item.original_text && item.original_text !== item.translated_text;
    const originalBlock = showOriginal
      ? `<div class="original-text">${item.original_text}</div>`
      : '';

    return `
    <div class="item-card item-${actorKey}">
      <div class="item-top">
        <span class="item-id">${item.id}</span>
        <span class="domain-tag">${domainLabel}</span>
        ${datetime}
        ${sourceLink}
      </div>
      <div class="item-translated">${item.translated_text || item.original_text || ''}</div>
      ${originalBlock}
    </div>`;
  }).join('');

  return `
    <div class="actor-section">
      <div class="actor-header actor-${actorKey}">
        ${ACTOR_NAMES[actorKey]} — ${actorData.items.length} ידיעות
      </div>
      ${items}
    </div>`;
}

// ─── Render HTML from template ────────────────────────────────────────────────

function renderHtml(data) {
  const templatePath = path.join(config.paths.templates, 'pdf.html');
  let html = fs.readFileSync(templatePath, 'utf-8');

  const actorOrder = ['HAMAS', 'HEZBOLLAH', 'IRAN', 'OTHERS'];
  const actorsSections = actorOrder
    .map(key => buildActorSection(key, data.actors[key] || { items: [] }))
    .join('');

  const totalItems = actorOrder.reduce((n, k) => n + (data.actors[k]?.items?.length || 0), 0);

  const dateStr = data.meta.date; // DD/MM/YYYY
  const dates = getBothDates(dateStr);

  const logoPath = path.join(config.paths.docs, 'assets', 'logo.png').replace(/\\/g, '/');

  html = html
    .replace(/\{\{VERSION\}\}/g,       data.meta.version)
    .replace(/\{\{ITEM_COUNT\}\}/g,    String(totalItems))
    .replace(/\{\{ACTORS_SECTIONS\}\}/, actorsSections)
    .replace(/\{\{GREGORIAN_DATE\}\}/g, dates.gregorian)
    .replace(/\{\{HEBREW_DATE\}\}/g,   dates.hebrew)
    .replace(/\{\{DISPLAY_DATE\}\}/g,  dates.display)
    .replace('{{LOGO_PATH}}',          'file:///' + logoPath);

  return html;
}

// ─── Generate PDF ─────────────────────────────────────────────────────────────

async function generate(data, version) {
  const html = renderHtml(data);

  if (!fs.existsSync(config.paths.digests)) {
    fs.mkdirSync(config.paths.digests, { recursive: true });
  }

  const displayDate = getDisplayDateString(data.meta.date);
  const pdfPath = path.join(config.paths.digests, `OSINT-5550_${displayDate}.pdf`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });

  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
  });

  await browser.close();
  return pdfPath;
}

module.exports = { generate, renderHtml };
