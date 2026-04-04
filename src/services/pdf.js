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

// ─── Logo → base64 for PDF header ────────────────────────────────────────────

function getLogoBase64() {
  try {
    const logoPath = path.join(config.paths.docs, 'assets', 'logo.png');
    if (fs.existsSync(logoPath)) {
      return 'data:image/png;base64,' + fs.readFileSync(logoPath).toString('base64');
    }
  } catch (e) { /* non-fatal */ }
  return '';
}

// ─── Build actor section — verbatim items only ────────────────────────────────

function buildActorSection(actorKey, actorData) {
  if (!actorData || !actorData.items || actorData.items.length === 0) return '';

  const items = actorData.items.map(item => {
    const domainLabel = DOMAIN_HEB[item.domain] || item.domain;
    const timeStr = item.datetime
      ? item.datetime.replace(/^\d{2}\/\d{2}\/\d{4}\s/, '').substring(0, 5)
      : '';
    const sourceLink = item.source_url
      ? `<a href="${item.source_url}" style="color:#60a5fa;font-size:10px;margin-right:6px;">מקור ↗</a>`
      : '';

    const showOriginal = item.original_text && item.original_text !== item.translated_text;
    const originalBlock = showOriginal
      ? `<div style="font-size:10px;color:#475569;margin-top:7px;padding-top:7px;border-top:1px solid #1e293b;direction:auto;white-space:pre-wrap;">${item.original_text}</div>`
      : '';

    return `
    <div class="item-card item-${actorKey}">
      <div class="item-header">
        ${timeStr ? `<span class="item-time">${timeStr}</span>` : ''}
        <span class="item-id">${item.id}</span>
        <span class="domain-tag">${domainLabel}</span>
        ${sourceLink}
      </div>
      <div class="item-body">${item.translated_text || item.original_text || ''}</div>
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

// ─── Render HTML ──────────────────────────────────────────────────────────────

function renderHtml(data) {
  const templatePath = path.join(config.paths.templates, 'pdf.html');
  let html = fs.readFileSync(templatePath, 'utf-8');

  const actorOrder = ['HEZBOLLAH', 'HAMAS', 'IRAN', 'OTHERS'];
  const actorsSections = actorOrder
    .map(key => buildActorSection(key, data.actors[key] || { items: [] }))
    .join('');

  const totalItems = actorOrder.reduce((n, k) => n + (data.actors[k]?.items?.length || 0), 0);

  const dateStr = data.meta.date;
  const dates = getBothDates(dateStr);

  const logoBase64 = getLogoBase64();

  html = html
    .replace(/\{\{VERSION\}\}/g,        data.meta.version)
    .replace(/\{\{ITEM_COUNT\}\}/g,     String(totalItems))
    .replace(/\{\{ACTORS_SECTIONS\}\}/g, actorsSections)
    .replace(/\{\{GREGORIAN_DATE\}\}/g, dates.gregorian)
    .replace(/\{\{HEBREW_DATE\}\}/g,    dates.hebrew)
    .replace(/\{\{DISPLAY_DATE\}\}/g,   dates.display)
    .replace('{{LOGO_BASE64}}',          logoBase64);

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

  const logoBase64 = getLogoBase64();

  // Puppeteer header shown on every page
  const headerHtml = `
    <div style="
      width:100%; padding:4px 15mm; box-sizing:border-box;
      display:flex; align-items:center; justify-content:space-between;
      border-bottom:1px solid #c9a84c; background:#070d1a;
      font-family:Arial,sans-serif;
    ">
      <div style="display:flex;align-items:center;gap:8px;">
        ${logoBase64
          ? `<img src="${logoBase64}" style="height:18px;filter:invert(1) sepia(0.3) saturate(1.4);mix-blend-mode:screen;">`
          : ''}
        <span style="font-size:9px;font-weight:700;color:#c9a84c;letter-spacing:1px;">יל"ק 5550 — יסוד האש</span>
      </div>
      <span style="font-size:8px;color:#475569;direction:ltr;">${displayDate}</span>
      <span style="font-size:8px;color:#475569;">עמוד <span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>`;

  const footerHtml = `
    <div style="
      width:100%; padding:3px 15mm; box-sizing:border-box;
      border-top:1px solid #1e293b; background:#070d1a;
      text-align:center; font-size:8px; color:#334155;
      font-family:Arial,sans-serif;
    ">OSINT יל"ק 5550 | מידע פתוח בלבד | ${data.meta.version}</div>`;

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
    displayHeaderFooter: true,
    headerTemplate: headerHtml,
    footerTemplate: footerHtml,
    margin: { top: '22mm', bottom: '14mm', left: '15mm', right: '15mm' },
  });

  await browser.close();
  return pdfPath;
}

module.exports = { generate, renderHtml };
