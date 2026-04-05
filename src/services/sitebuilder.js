const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../database');
const { getBothDates } = require('../utils/hebrew-date');

const ACTOR_NAMES = {
  HAMAS: 'חמאס',
  HEZBOLLAH: 'חיזבאללה',
  IRAN: 'איראן',
  OTHERS: 'אחרים',
};

const ACTOR_EMOJIS = {
  HAMAS: '🔴',
  HEZBOLLAH: '🟠',
  IRAN: '🟣',
  OTHERS: '⚫',
};

const DOMAIN_HEB = {
  KINETIC: 'קינטי',
  TERRAIN: 'שטח',
  SOCIAL: 'חברתי',
  CYBER: 'סייבר',
  GENERAL: 'כללי',
};

// ─── Location lookup — resolve text → lat/lon ─────────────────────────────────

const LOCATION_COORDS = {
  // South Lebanon
  'אלחיאם':       [33.350, 35.487], 'אל חיאם':   [33.350, 35.487],
  'קנטרה':        [33.283, 35.515],
  'בינת ג\'ביל':  [33.115, 35.430], 'בינת גביל': [33.115, 35.430], 'בינת': [33.115, 35.430],
  'עיתרון':       [33.083, 35.370],
  'עינאתא':       [33.090, 35.447],
  'שמע':          [33.103, 35.193],
  'נאקורה':       [33.113, 35.137], 'אל נאקורה': [33.113, 35.137], 'ראס אל-נאקורה': [33.113, 35.137],
  'ראמיה':        [33.133, 35.340],
  'צור':          [33.270, 35.193],
  'מרג\'יון':     [33.367, 35.593],
  'דבל':          [33.090, 35.420],
  'מירון':        [32.997, 35.421],
  // Gaza
  'עזה':          [31.500, 34.467], 'רצועת עזה': [31.500, 34.467], 'הרצועה': [31.500, 34.467],
  'רפיח':         [31.287, 34.250],
  'חאן יונס':     [31.340, 34.300], 'ח\'אן יונס': [31.340, 34.300],
  'בית לאהיא':    [31.558, 34.493],
  'ג\'בליה':      [31.527, 34.481],
  'נוסיירט':      [31.426, 34.395], 'אל-נוסיירט': [31.426, 34.395], 'מחנה אל-נוסיירט': [31.426, 34.395],
  'נצרים':        [31.389, 34.337], 'ציר נצרים':  [31.389, 34.337],
  'שג\'עיה':      [31.497, 34.487],
  // West Bank
  'ג\'נין':       [32.460, 35.300],
  'שכם':          [32.217, 35.260], 'נבלוס':  [32.217, 35.260],
  'טולכרם':       [32.317, 35.013],
  'קלקיליה':      [32.188, 34.970],
  'רמאללה':       [31.900, 35.200],
  'חברון':        [31.530, 35.100],
  'יריחו':        [31.856, 35.462],
  'טובאס':        [32.318, 35.373],
  // North Israel
  'קרית שמונה':   [33.207, 35.570],
  'מטולה':        [33.270, 35.570], 'המטולה': [33.270, 35.570],
  'נהריה':        [33.003, 35.094],
  'עכו':          [32.928, 35.082],
  // Yemen / Houthis
  'צנעא':         [15.352, 44.207],
  'עדן':          [12.780, 45.036],
  'הורמוז':       [26.500, 56.500], 'מצרי הורמוז': [26.500, 56.500],
  // Iran
  'טהרן':         [35.689, 51.389], 'תהרן': [35.689, 51.389],
  'איספהאן':      [32.660, 51.680],
};

/**
 * Try to find coordinates for an item by scanning its translated text.
 * Returns { lat, lon } or { lat: null, lon: null }.
 */
function resolveItemCoords(item) {
  const text = (item.translated_text || item.original_text || '').toLowerCase();
  for (const [name, coords] of Object.entries(LOCATION_COORDS)) {
    // Whole-word match only — prevent e.g. 'צור' hitting 'בצורה', 'שמע' hitting 'ישמע'
    const escaped = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![א-תa-z\\d])${escaped}(?![א-תa-z\\d])`, 'u');
    if (re.test(text)) {
      return { lat: coords[0], lon: coords[1] };
    }
  }
  return { lat: null, lon: null };
}

// ─── Item card — Military Sitrep format ───────────────────────────────────────

function buildItemCard(item) {
  const domainLabel = DOMAIN_HEB[item.domain] || item.domain;

  // Extract time only (HH:MM) from datetime
  const timeStr = item.datetime
    ? item.datetime.replace(/^\d{2}\/\d{2}\/\d{4}\s/, '').substring(0, 5)
    : '';

  const sourceLink = item.source_url
    ? `<a href="${item.source_url}" target="_blank" rel="noopener" class="item-source-link">מקור ↗</a>`
    : '';

  const { lat, lon } = resolveItemCoords(item);
  const hasLocation = lat !== null;
  const mapPin = `<button class="map-pin-btn${hasLocation ? '' : ' no-location'}"
    data-item-id="${item.id}"
    title="${hasLocation ? 'הצג על המפה' : 'מיקום לא ידוע'}">📍</button>`;

  const text = item.translated_text || item.original_text || '';

  // Show expand button only for long text (>180 chars or >3 lines)
  const isLong = text.length > 180 || text.split('\n').length > 3;
  const expandBtn = isLong
    ? `<button class="item-expand-btn">▼ קרא עוד</button>`
    : '';

  // Collapsible original if different from translation
  const showOriginal = item.original_text && item.original_text !== item.translated_text;
  const originalBlock = showOriginal
    ? `<details class="item-original">
        <summary>מקור ערבי</summary>
        <div class="item-original-text">${item.original_text}</div>
      </details>`
    : '';

  return `
    <div class="item-card" data-actor="${item.actor}" data-domain="${item.domain}" data-id="${item.id}">
      <div class="item-header">
        ${timeStr ? `<span class="item-time">${timeStr}</span>` : ''}
        <span class="item-id">${item.id}</span>
        <span class="domain-tag">${domainLabel}</span>
        <div class="item-header-actions">
          ${mapPin}
          ${sourceLink}
        </div>
      </div>
      <div class="item-body">
        <div class="item-translated">${text}</div>
      </div>
      ${expandBtn}
      ${originalBlock}
    </div>`;
}

// ─── Actor tab ────────────────────────────────────────────────────────────────

function buildActorTab(actorKey, actorData) {
  const count = (actorData.items || []).length;
  return `<button class="actor-tab" data-actor="${actorKey}">
    <span class="dot"></span>
    ${ACTOR_NAMES[actorKey]}
    <span class="tab-count">${count}</span>
  </button>`;
}

function buildActorPanel(actorKey, actorData) {
  const items = (actorData.items || []).map(buildItemCard).join('');
  const empty = items ? '' : '<p style="color:var(--text-dim);padding:20px;text-align:center;">אין ידיעות</p>';
  return `<div class="actor-panel" id="panel-${actorKey}">${items}${empty}</div>`;
}

// ─── Sector nav cards ─────────────────────────────────────────────────────────

function buildSectorCards(actors) {
  const actorOrder = ['HAMAS', 'HEZBOLLAH', 'IRAN', 'OTHERS'];
  return actorOrder.map(k => {
    const actor = actors[k] || { items: [] };
    const count = (actor.items || []).length;
    if (count === 0) return '';
    return `<div class="sector-card" data-actor="${k}">
      <span class="sector-dot"></span>
      <span class="sector-name">${ACTOR_NAMES[k]}</span>
      <span class="sector-count">${count} ידיעות</span>
    </div>`;
  }).filter(Boolean).join('');
}

// ─── Map items — all items with resolved coordinates ─────────────────────────

function buildMapItemsJson(actors) {
  const actorOrder = ['HAMAS', 'HEZBOLLAH', 'IRAN', 'OTHERS'];
  const mapItems = [];
  for (const k of actorOrder) {
    const items = (actors[k]?.items || []);
    for (const item of items) {
      const { lat, lon } = resolveItemCoords(item);
      mapItems.push({
        id:       item.id,
        actor:    item.actor,
        domain:   item.domain,
        datetime: item.datetime || null,
        text:     item.translated_text || item.original_text || '',
        lat,
        lon,
      });
    }
  }
  return JSON.stringify(mapItems);
}

// ─── Main page builder ────────────────────────────────────────────────────────

function buildVersionPage(data) {
  const templatePath = path.join(config.paths.templates, 'version.html');
  let html = fs.readFileSync(templatePath, 'utf-8');

  const actorOrder = ['HAMAS', 'HEZBOLLAH', 'IRAN', 'OTHERS'];
  const tabs        = actorOrder.map(k => buildActorTab(k, data.actors[k] || { items: [] })).join('');
  const panels      = actorOrder.map(k => buildActorPanel(k, data.actors[k] || { items: [] })).join('');
  const sectorCards = buildSectorCards(data.actors);
  const mapItemsJson = buildMapItemsJson(data.actors);

  const dates = getBothDates(data.meta.date);

  const totalItems = actorOrder.reduce((n, k) => n + (data.actors[k]?.items || []).length, 0);

  // Count how many items have coordinates
  const mappedCount = JSON.parse(mapItemsJson).filter(i => i.lat).length;

  // Default tab: prefer HEZBOLLAH (Lebanon field ops), then first with items
  const preferOrder = ['HEZBOLLAH', 'HAMAS', 'IRAN', 'OTHERS'];
  const firstActive = preferOrder.find(k => (data.actors[k]?.items || []).length > 0) || 'HEZBOLLAH';

  html = html
    .replace(/\{\{VERSION\}\}/g,        data.meta.version)
    .replace(/\{\{DISPLAY_DATE\}\}/g,   dates.display)
    .replace(/\{\{ITEM_COUNT\}\}/g,     String(totalItems))
    .replace(/\{\{GREGORIAN_DATE\}\}/g, dates.gregorian)
    .replace(/\{\{HEBREW_DATE\}\}/g,    dates.hebrew)
    .replace(/\{\{MAPPED_COUNT\}\}/g,   String(mappedCount))
    .replace('{{SECTOR_CARDS}}',        sectorCards)
    .replace('{{ACTOR_TABS}}',          tabs)
    .replace('{{ACTOR_PANELS}}',        panels)
    .replace('{{MAP_ITEMS_JSON}}',      mapItemsJson);

  // Set first actor tab + panel active
  html = html.replace(
    `class="actor-tab" data-actor="${firstActive}">`,
    `class="actor-tab active" data-actor="${firstActive}">`
  );
  html = html.replace(
    `class="actor-panel" id="panel-${firstActive}"`,
    `class="actor-panel active" id="panel-${firstActive}"`
  );

  return html;
}

// ─── Homepage builder ─────────────────────────────────────────────────────────

function buildHomepage(digests) {
  const templatePath = path.join(config.paths.templates, 'index.html');
  let html = fs.readFileSync(templatePath, 'utf-8');

  let latestSection = '';
  let archiveList = '';
  let footerCta = '';

  if (digests.length > 0) {
    const latest = digests[0];
    const dates = getBothDates(latest.date);
    latestSection = `
      <div class="latest-card">
        <div class="latest-version">${latest.version}</div>
        <div class="latest-meta">
          <span>${latest.new_count || 0} ידיעות</span>
          <span>${dates.hebrew}</span>
        </div>
        <a href="${latest.version}/" class="btn-cta">כנס לתחקיר האחרון</a>
      </div>`;

    footerCta = `<a href="${latest.version}/" class="btn-cta">לתחקיר האחרון</a>`;

    archiveList = digests.map(d => `
      <li class="archive-item">
        <div>
          <span class="ver">${d.version}</span>
          <span class="detail"> — ${d.new_count || 0} ידיעות</span>
        </div>
        <a href="${d.version}/">פתח</a>
      </li>`
    ).join('');
  } else {
    latestSection = `
      <div class="latest-card">
        <div class="latest-version" style="color:var(--text-dim)">אין תחקירים עדיין</div>
      </div>`;
  }

  html = html
    .replace('{{LATEST_SECTION}}', latestSection)
    .replace('{{ARCHIVE_LIST}}',   archiveList)
    .replace('{{FOOTER_CTA}}',     footerCta);

  return html;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function buildVersion(data, version) {
  const versionDir = path.join(config.paths.docs, version);
  if (!fs.existsSync(versionDir)) {
    fs.mkdirSync(versionDir, { recursive: true });
  }

  const versionHtml = buildVersionPage(data);
  fs.writeFileSync(path.join(versionDir, 'index.html'), versionHtml, 'utf-8');

  // PDF may be named by display date (OSINT-5550_DD-MONTH-YYYY.pdf) or by version
  const { getDisplayDateString } = require('../utils/hebrew-date');
  const todayIL = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const displayDate = getDisplayDateString(todayIL);
  const pdfByDate = path.join(config.paths.digests, `OSINT-5550_${displayDate}.pdf`);
  const pdfByVersion = path.join(config.paths.digests, `${version}.pdf`);
  const pdfSrc = fs.existsSync(pdfByDate) ? pdfByDate : pdfByVersion;
  if (fs.existsSync(pdfSrc)) {
    fs.copyFileSync(pdfSrc, path.join(versionDir, 'digest.pdf'));
  }

  const digests = await db.getDigests();
  const homepageHtml = buildHomepage(digests);
  fs.writeFileSync(path.join(config.paths.docs, 'index.html'), homepageHtml, 'utf-8');

  return versionDir;
}

module.exports = { buildVersion, buildHomepage };
