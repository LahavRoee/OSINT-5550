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

// ─── Location lookup (mirror of sitebuilder) ──────────────────────────────────

const LOCATION_COORDS = {
  'אלחיאם': [33.350, 35.487], 'אל חיאם': [33.350, 35.487],
  'קנטרה': [33.283, 35.515],
  "בינת ג'ביל": [33.115, 35.430], 'בינת גביל': [33.115, 35.430], 'בינת': [33.115, 35.430],
  'עיתרון': [33.083, 35.370], 'עינאתא': [33.090, 35.447],
  'שמע': [33.103, 35.193],
  'נאקורה': [33.113, 35.137], 'אל נאקורה': [33.113, 35.137], 'ראס אל-נאקורה': [33.113, 35.137],
  'ראמיה': [33.133, 35.340],
  'צור': [33.270, 35.193],
  "מרג'יון": [33.367, 35.593],
  'דבל': [33.090, 35.420], 'מירון': [32.997, 35.421],
  'עזה': [31.500, 34.467], 'רצועת עזה': [31.500, 34.467], 'הרצועה': [31.500, 34.467],
  'רפיח': [31.287, 34.250],
  'חאן יונס': [31.340, 34.300], "ח'אן יונס": [31.340, 34.300],
  'בית לאהיא': [31.558, 34.493],
  "ג'בליה": [31.527, 34.481],
  'נוסיירט': [31.426, 34.395], 'אל-נוסיירט': [31.426, 34.395],
  'נצרים': [31.389, 34.337], 'ציר נצרים': [31.389, 34.337],
  "שג'עיה": [31.497, 34.487],
  "ג'נין": [32.460, 35.300],
  'שכם': [32.217, 35.260], 'נבלוס': [32.217, 35.260],
  'טולכרם': [32.317, 35.013], 'קלקיליה': [32.188, 34.970],
  'רמאללה': [31.900, 35.200], 'חברון': [31.530, 35.100],
  'יריחו': [31.856, 35.462], 'טובאס': [32.318, 35.373],
  'קרית שמונה': [33.207, 35.570],
  'מטולה': [33.270, 35.570], 'המטולה': [33.270, 35.570],
  'נהריה': [33.003, 35.094], 'עכו': [32.928, 35.082],
  'צנעא': [15.352, 44.207], 'עדן': [12.780, 45.036],
  'הורמוז': [26.500, 56.500], 'מצרי הורמוז': [26.500, 56.500],
  'טהרן': [35.689, 51.389], 'תהרן': [35.689, 51.389],
  'איספהאן': [32.660, 51.680],
  'ביירות': [33.888, 35.495], 'בעלבק': [34.004, 36.212],
  'דמשק': [33.513, 36.292],
};

function resolveItemCoords(item) {
  const text = (item.translated_text || item.original_text || '').toLowerCase();
  for (const [name, coords] of Object.entries(LOCATION_COORDS)) {
    const escaped = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![א-תa-z\\d])${escaped}(?![א-תa-z\\d])`, 'u');
    if (re.test(text)) return coords;
  }
  return null;
}

function buildMiniMap(coords) {
  const [lat, lon] = coords;
  const url = `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lon}&zoom=9&size=130x85&markers=${lat},${lon},red`;
  return `<img class="item-mini-map" src="${url}" alt="" onerror="this.style.display='none'">`;
}

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

// ─── Executive summary (auto-generated from data, no AI) ─────────────────────

function buildExecSummary(data) {
  const ORDER = ['HEZBOLLAH', 'HAMAS', 'IRAN', 'OTHERS'];
  const ACTOR_HEB = { HEZBOLLAH: 'חיזבאללה / לבנון', HAMAS: 'חמאס / עזה', IRAN: 'איראן', OTHERS: 'אחרים' };
  const ACTOR_COLOR = { HEZBOLLAH: '#ea580c', HAMAS: '#dc2626', IRAN: '#7c3aed', OTHERS: '#16a34a' };

  // Count by domain across all actors
  const domainTotals = {};
  let totalKinetic = 0;

  // Collect top 3 kinetic items (from Hezbollah first, then Hamas)
  const kineticItems = [];

  for (const k of ORDER) {
    const items = data.actors?.[k]?.items || [];
    for (const item of items) {
      domainTotals[item.domain] = (domainTotals[item.domain] || 0) + 1;
      if (item.domain === 'KINETIC') {
        totalKinetic++;
        if (kineticItems.length < 4) kineticItems.push({ actor: k, item });
      }
    }
  }

  // Actor rows
  const actorRows = ORDER.map(k => {
    const items = data.actors?.[k]?.items || [];
    if (!items.length) return '';
    const kinetic = items.filter(i => i.domain === 'KINETIC').length;
    const color = ACTOR_COLOR[k];
    return `<tr>
      <td style="border-right:3px solid ${color};padding-right:8px;font-weight:700;color:${color};">${ACTOR_HEB[k]}</td>
      <td style="text-align:center;font-weight:900;color:#c9a84c;">${items.length}</td>
      <td style="text-align:center;color:#ef4444;">${kinetic || '—'}</td>
    </tr>`;
  }).filter(Boolean).join('');

  // Top kinetic items
  const kineticLines = kineticItems.map(({ actor, item }) => {
    const text = (item.translated_text || item.original_text || '').replace(/\n/g, ' ').substring(0, 110);
    const timeStr = item.datetime ? item.datetime.replace(/^\d{2}\/\d{2}\/\d{4}\s/, '').substring(0, 5) : '';
    const color = ACTOR_COLOR[actor];
    return `<div style="border-right:2px solid ${color};padding:4px 8px;margin-bottom:5px;font-size:10px;line-height:1.5;">
      ${timeStr ? `<span style="color:#c9a84c;font-weight:700;margin-left:6px;">${timeStr}</span>` : ''}
      <span style="color:#94a3b8;font-size:9px;">[${ACTOR_HEB[actor]}]</span>
      <span style="color:#e2e8f0;">${text}${text.length >= 110 ? '...' : ''}</span>
    </div>`;
  }).join('');

  return `
  <div style="margin-bottom:24px;">
    <div class="summary-title">סיכום מנהלים</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:11px;">
      <thead>
        <tr style="background:#0d1a30;">
          <th style="padding:5px 10px;text-align:right;color:#94a3b8;font-weight:700;">גזרה</th>
          <th style="padding:5px 10px;text-align:center;color:#94a3b8;font-weight:700;">ידיעות</th>
          <th style="padding:5px 10px;text-align:center;color:#ef4444;font-weight:700;">קינטי</th>
        </tr>
      </thead>
      <tbody style="color:#e2e8f0;">${actorRows}</tbody>
    </table>
    ${kineticLines ? `<div style="margin-top:4px;"><div style="font-size:10px;font-weight:700;color:#c9a84c;margin-bottom:6px;letter-spacing:0.5px;">אירועים קינטיים מובילים</div>${kineticLines}</div>` : ''}
  </div>`;
}

// ─── Build actor section — Hebrew only, concise ───────────────────────────────

function buildActorSection(actorKey, actorData) {
  if (!actorData || !actorData.items || actorData.items.length === 0) return '';

  const items = actorData.items.map(item => {
    const domainLabel = DOMAIN_HEB[item.domain] || item.domain;

    // Show full date+time if available, fallback to time only
    const dt = item.datetime || '';
    const dateLabel = dt ? dt.replace(/(\d{2})\/(\d{2})\/(\d{4})\s/, '$1/$2 ').substring(0, 11) : '';

    const sourceLink = item.source_url
      ? `<a href="${item.source_url}" style="color:#60a5fa;font-size:9px;margin-right:4px;">מקור ↗</a>`
      : '';

    const coords = resolveItemCoords(item);
    const miniMap = coords ? buildMiniMap(coords) : '';

    // Hebrew text only — no Arabic. Truncate at 300 chars.
    const text = (item.translated_text || item.original_text || '').trim();
    const truncated = text.length > 300 ? text.substring(0, 300) + '…' : text;

    return `
    <div class="item-card item-${actorKey}">
      <div class="item-header">
        ${dateLabel ? `<span class="item-time">${dateLabel}</span>` : ''}
        <span class="item-id">${item.id}</span>
        <span class="domain-tag">${domainLabel}</span>
        ${sourceLink}
      </div>
      <div class="item-body${coords ? ' item-body-with-map' : ''}">
        <div class="item-text">${truncated}</div>
        ${miniMap}
      </div>
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

// ─── Build summary section (Lebanon first) ───────────────────────────────────

function buildSummarySection(data, mapsLinks) {
  const actorOrder = ['HEZBOLLAH', 'HAMAS', 'IRAN', 'OTHERS'];
  const ACTOR_NAMES_HEB = { HEZBOLLAH:'חיזבאללה / לבנון', HAMAS:'חמאס / עזה', IRAN:'איראן', OTHERS:'אחרים' };
  const DOMAIN_ORDER = ['KINETIC','TERRAIN','SOCIAL','CYBER','GENERAL'];

  const rows = actorOrder.map(key => {
    const items = data.actors?.[key]?.items || [];
    if (!items.length) return '';

    // Domain breakdown
    const domainCounts = {};
    for (const item of items) {
      domainCounts[item.domain] = (domainCounts[item.domain] || 0) + 1;
    }
    const domainStr = DOMAIN_ORDER
      .filter(d => domainCounts[d])
      .map(d => `${DOMAIN_HEB[d]}: ${domainCounts[d]}`)
      .join(' · ');

    const mapLink = mapsLinks?.[key]
      ? `<a class="maps-link" href="${mapsLinks[key].url}">🗺 מפה (${mapsLinks[key].count} מיקומים)</a>`
      : '';

    return `<tr class="summary-row-${key}">
      <td>${ACTOR_NAMES_HEB[key]}</td>
      <td class="summary-count">${items.length}</td>
      <td>${domainStr}</td>
      <td>${mapLink}</td>
    </tr>`;
  }).filter(Boolean).join('');

  return `
    <div class="summary-title">סיכום מצב — לבנון ראשון</div>
    <table class="summary-table">
      <thead>
        <tr>
          <th>גזרה</th>
          <th>ידיעות</th>
          <th>תחומים</th>
          <th>מפה</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ─── Render HTML ──────────────────────────────────────────────────────────────

function renderHtml(data) {
  const templatePath = path.join(config.paths.templates, 'pdf.html');
  let html = fs.readFileSync(templatePath, 'utf-8');

  const actorOrder = ['HEZBOLLAH', 'HAMAS', 'IRAN', 'OTHERS'];
  const actorsSections = actorOrder
    .map(key => buildActorSection(key, data.actors[key] || { items: [] }))
    .join('');

  // Executive summary (auto-generated) + detail summary table
  const execSummary = buildExecSummary(data);
  const sheldon = require('./sheldon');
  const mapsLinks = sheldon.buildMapsLinks(data.actors || {});
  const summarySection = execSummary + buildSummarySection(data, mapsLinks);

  const totalItems = actorOrder.reduce((n, k) => n + (data.actors[k]?.items?.length || 0), 0);

  const dateStr = data.meta.date;
  const dates = getBothDates(dateStr);

  const logoBase64 = getLogoBase64();

  html = html
    .replace(/\{\{VERSION\}\}/g,         data.meta.version)
    .replace(/\{\{ITEM_COUNT\}\}/g,      String(totalItems))
    .replace(/\{\{ACTORS_SECTIONS\}\}/g, actorsSections)
    .replace(/\{\{SUMMARY_SECTION\}\}/g, summarySection)
    .replace(/\{\{GREGORIAN_DATE\}\}/g,  dates.gregorian)
    .replace(/\{\{HEBREW_DATE\}\}/g,     dates.hebrew)
    .replace(/\{\{DISPLAY_DATE\}\}/g,    dates.display)
    .replace('{{LOGO_BASE64}}',           logoBase64);

  return html;
}

// ─── Generate PDF ─────────────────────────────────────────────────────────────

async function generate(data, version) {
  const html = renderHtml(data);

  if (!fs.existsSync(config.paths.digests)) {
    fs.mkdirSync(config.paths.digests, { recursive: true });
  }

  // Filename uses today's export date (Israel time), not the synthesis data date
  const todayIL = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const displayDate = getDisplayDateString(todayIL);
  const pdfPath = path.join(config.paths.digests, `OSINT-5550_${displayDate}.pdf`);

  // Remove existing file to avoid Windows file-lock errors on overwrite
  try { if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath); } catch (_) {}

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
    ">OSINT יל"ק 5550 — יסוד האש &nbsp;|&nbsp; הופק ע"י רועי להב (רס"ן, סמג"ד ב') &nbsp;|&nbsp; מידע פתוח בלבד &nbsp;|&nbsp; ${data.meta.version}</div>`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });

  // Generate to buffer first to avoid Windows file-lock errors on overwrite
  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: headerHtml,
    footerTemplate: footerHtml,
    margin: { top: '22mm', bottom: '14mm', left: '15mm', right: '15mm' },
  });

  await browser.close();

  // Write to temp file first, then rename — avoids Windows file-lock on overwrite
  const tmpPath = pdfPath + '.tmp';
  fs.writeFileSync(tmpPath, pdfBuffer);
  try {
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
  } catch (_) {} // ignore if still locked; rename may still work
  try {
    fs.renameSync(tmpPath, pdfPath);
  } catch (_) {
    // If rename fails (e.g. locked), keep .tmp as the result
    return tmpPath;
  }
  return pdfPath;
}

module.exports = { generate, renderHtml };
