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

// ─── Item card — verbatim translation + source link, zero analysis ────────────

function buildItemCard(item) {
  const sourceLink = item.source_url
    ? `<a href="${item.source_url}" target="_blank" rel="noopener" class="item-source-link" title="פתח מקור מקורי">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        מקור
      </a>`
    : '';

  const datetime = item.datetime
    ? `<span class="item-datetime">${item.datetime}</span>`
    : '';

  const domainLabel = DOMAIN_HEB[item.domain] || item.domain;

  // Show original text as collapsible if it differs from translated
  const showOriginal = item.original_text && item.original_text !== item.translated_text;
  const originalBlock = showOriginal
    ? `<details class="item-original">
        <summary>טקסט מקורי</summary>
        <div class="item-original-text">${item.original_text}</div>
      </details>`
    : '';

  return `
    <div class="item-card" data-actor="${item.actor}" data-domain="${item.domain}">
      <div class="item-top">
        <span class="item-id">${item.id}</span>
        <span class="domain-tag">${domainLabel}</span>
        ${datetime}
        ${sourceLink}
      </div>
      <div class="item-translated">${item.translated_text || item.original_text || ''}</div>
      ${originalBlock}
    </div>`;
}

// ─── Actor tab + panel ────────────────────────────────────────────────────────

function buildActorTab(actorKey, actorData) {
  const count = (actorData.items || []).length;
  return `<button class="actor-tab" data-actor="${actorKey}">
    ${ACTOR_EMOJIS[actorKey]} ${ACTOR_NAMES[actorKey]}
    <span class="tab-count">${count}</span>
  </button>`;
}

function buildActorPanel(actorKey, actorData) {
  const items = (actorData.items || []).map(buildItemCard).join('');
  const empty = items ? '' : '<p style="color:var(--text-dim);padding:20px;text-align:center;">אין ידיעות</p>';
  return `<div class="actor-panel" id="panel-${actorKey}">${items}${empty}</div>`;
}

// ─── Sector nav cards (header quick-nav) ─────────────────────────────────────

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

// ─── Main page builder ────────────────────────────────────────────────────────

function buildVersionPage(data) {
  const templatePath = path.join(config.paths.templates, 'version.html');
  let html = fs.readFileSync(templatePath, 'utf-8');

  const actorOrder = ['HAMAS', 'HEZBOLLAH', 'IRAN', 'OTHERS'];
  const tabs   = actorOrder.map(k => buildActorTab(k, data.actors[k] || { items: [] })).join('');
  const panels = actorOrder.map(k => buildActorPanel(k, data.actors[k] || { items: [] })).join('');
  const sectorCards = buildSectorCards(data.actors);

  const dates = getBothDates(data.meta.date);

  const totalItems = actorOrder.reduce((n, k) => n + (data.actors[k]?.items || []).length, 0);

  // Find first actor with items for default active tab
  const firstActive = actorOrder.find(k => (data.actors[k]?.items || []).length > 0) || 'HAMAS';

  html = html
    .replace(/\{\{VERSION\}\}/g,       data.meta.version)
    .replace(/\{\{DISPLAY_DATE\}\}/g,  dates.display)
    .replace(/\{\{ITEM_COUNT\}\}/g,    String(totalItems))
    .replace(/\{\{GREGORIAN_DATE\}\}/g, dates.gregorian)
    .replace(/\{\{HEBREW_DATE\}\}/g,   dates.hebrew)
    .replace('{{SECTOR_CARDS}}',       sectorCards)
    .replace('{{ACTOR_TABS}}',         tabs)
    .replace('{{ACTOR_PANELS}}',       panels);

  // Set first actor tab active — match the <button> specifically to avoid hitting sector-cards
  html = html.replace(
    `class="actor-tab" data-actor="${firstActive}">`,
    `class="actor-tab active" data-actor="${firstActive}">`
  );
  html = html.replace(
    `id="panel-${firstActive}"`,
    `id="panel-${firstActive}" class="actor-panel active"`
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

  const pdfSrc = path.join(config.paths.digests, `${version}.pdf`);
  if (fs.existsSync(pdfSrc)) {
    fs.copyFileSync(pdfSrc, path.join(versionDir, 'digest.pdf'));
  }

  const digests = await db.getDigests();
  const homepageHtml = buildHomepage(digests);
  fs.writeFileSync(path.join(config.paths.docs, 'index.html'), homepageHtml, 'utf-8');

  return versionDir;
}

module.exports = { buildVersion, buildHomepage };
