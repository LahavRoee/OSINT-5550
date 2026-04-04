const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../database');
const { getBothDates } = require('../utils/hebrew-date');
const { generateCrossRefs, buildCrossRefSidebar } = require('./crossref');

const ACTOR_NAMES = {
  HAMAS: 'חמאס',
  HEZBOLLAH: 'חיזבאללה',
  IRAN: 'איראן',
  OTHERS: 'אחרים',
};

const ACTOR_EMOJIS = {
  HAMAS: '\uD83D\uDD34',
  HEZBOLLAH: '\uD83D\uDFE0',
  IRAN: '\uD83D\uDFE3',
  OTHERS: '\u26AB',
};

function buildItemCard(item) {
  const sourceLink = item.source_url
    ? `<a href="${item.source_url}" target="_blank" rel="noopener" class="item-source-link" title="פתח מקור מקורי">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        מקור
      </a>`
    : '';
  return `
    <div class="item-card" data-actor="${item.actor}" data-domain="${item.domain}">
      <div class="item-top">
        <span class="item-id">${item.id}</span>
        <span class="domain-tag">${item.domain}</span>
        <span class="confidence confidence-${item.confidence}">${item.confidence}</span>
        ${sourceLink}
      </div>
      <div class="item-title">${item.title}</div>
      <div class="item-fields">
        <div><span class="field-label">מה: </span>${item.what}</div>
        <div><span class="field-label">איפה: </span>${item.where}</div>
        <div><span class="field-label">משמעות: </span>${item.so_what}</div>
      </div>
      <div class="item-action">פעולה: ${item.action}</div>
    </div>`;
}

function buildActorTab(actorKey, actorData) {
  const count = (actorData.items || []).length;
  return `<button class="actor-tab" data-actor="${actorKey}">
    <span class="dot"></span>
    ${ACTOR_EMOJIS[actorKey]} ${ACTOR_NAMES[actorKey]}
    <span class="tab-count">${count}</span>
  </button>`;
}

function buildActorPanel(actorKey, actorData) {
  const items = (actorData.items || []).map(buildItemCard).join('');
  const empty = items ? '' : '<p style="color:var(--text-dim);padding:20px;text-align:center;">אין פריטים</p>';
  return `<div class="actor-panel" id="panel-${actorKey}">${items}${empty}</div>`;
}

function buildVersionPage(data) {
  const templatePath = path.join(config.paths.templates, 'version.html');
  let html = fs.readFileSync(templatePath, 'utf-8');

  const takeaways = data.key_takeaways
    .map(t => `<div class="takeaway">${t}</div>`)
    .join('');

  const actorOrder = ['HAMAS', 'HEZBOLLAH', 'IRAN', 'OTHERS'];
  const tabs = actorOrder.map(k => buildActorTab(k, data.actors[k] || { items: [] })).join('');
  const panels = actorOrder.map(k => buildActorPanel(k, data.actors[k] || { items: [] })).join('');

  const redPatterns = data.red_patterns && data.red_patterns.length > 0
    ? `<div class="alerts-section"><h2>דפוסי איום חוזרים</h2>${data.red_patterns.map(p => `<div class="alert-item">${p}</div>`).join('')}</div>`
    : '';

  const opsecAlerts = data.blue_opsec_alerts && data.blue_opsec_alerts.length > 0
    ? `<div class="alerts-section"><h2>התראות OPSEC</h2>${data.blue_opsec_alerts.map(a => `<div class="alert-item opsec-item">${a}</div>`).join('')}</div>`
    : '';

  // Find first actor with items for default active tab
  const firstActiveActor = actorOrder.find(k => (data.actors[k]?.items || []).length > 0) || 'HAMAS';

  const dates = getBothDates(data.meta.date);

  // Build sector nav cards
  const sectorCards = actorOrder.map(k => {
    const actor = data.actors[k] || { items: [], threat_level: 'LOW' };
    const count = (actor.items || []).length;
    if (count === 0) return '';
    return `<div class="sector-card" data-actor="${k}">
      <span class="sector-dot"></span>
      <span class="sector-name">${ACTOR_NAMES[k]}</span>
      <span class="sector-count">${count} פריטים</span>
      <span class="sector-level threat-badge threat-${actor.threat_level}">${actor.threat_level}</span>
    </div>`;
  }).filter(Boolean).join('');

  html = html
    .replace(/\{\{VERSION\}\}/g, data.meta.version)
    .replace(/\{\{THREAT_LEVEL\}\}/g, data.meta.threat_level)
    .replace(/\{\{DISPLAY_DATE\}\}/g, dates.display)
    .replace(/\{\{HEADLINE\}\}/g, data.situational_picture.substring(0, 80))
    .replace(/\{\{SITUATIONAL_PICTURE\}\}/g, data.situational_picture)
    .replace('{{TAKEAWAYS}}', takeaways)
    .replace('{{ACTOR_TABS}}', tabs)
    .replace('{{ACTOR_PANELS}}', panels)
    .replace('{{RED_PATTERNS}}', redPatterns)
    .replace('{{OPSEC_ALERTS}}', opsecAlerts)
    .replace('{{COMMANDER_NOTE}}', data.commander_note || '')
    .replace(/\{\{GREGORIAN_DATE\}\}/g, dates.gregorian)
    .replace(/\{\{HEBREW_DATE\}\}/g, dates.hebrew)
    .replace('{{SECTOR_CARDS}}', sectorCards);

  // Cross-reference sidebar
  const crossRefs = generateCrossRefs(data);
  const crossRefHtml = buildCrossRefSidebar(crossRefs);
  html = html.replace('{{CROSSREF_SIDEBAR}}', crossRefHtml);

  // Set first actor tab active
  html = html.replace(
    `data-actor="${firstActiveActor}">`,
    `data-actor="${firstActiveActor}" class="actor-tab active">`
  );
  html = html.replace(
    `id="panel-${firstActiveActor}"`,
    `id="panel-${firstActiveActor}" class="actor-panel active"`
  );

  return html;
}

function buildHomepage(digests) {
  const templatePath = path.join(config.paths.templates, 'index.html');
  let html = fs.readFileSync(templatePath, 'utf-8');

  let latestSection = '';
  let archiveList = '';
  let footerCta = '';

  if (digests.length > 0) {
    const latest = digests[0];
    const threatLevel = latest.threat_level || 'LOW';
    const dates = getBothDates(latest.date);
    latestSection = `
      <div class="latest-card">
        <div class="latest-version">${latest.version}</div>
        <div class="latest-meta">
          <span class="threat-badge threat-${threatLevel}">${threatLevel}</span>
          <span>${latest.new_count || 0} פריטים</span>
          <span>${dates.hebrew}</span>
        </div>
        <a href="${latest.version}/" class="btn-cta">כנס לתחקיר האחרון</a>
      </div>`;

    footerCta = `<a href="${latest.version}/" class="btn-cta">לתחקיר האחרון</a>`;

    archiveList = digests.map(d => `
      <li class="archive-item">
        <div>
          <span class="ver">${d.version}</span>
          <span class="detail"> \u2014 ${d.new_count || 0} פריטים</span>
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
    .replace('{{ARCHIVE_LIST}}', archiveList)
    .replace('{{FOOTER_CTA}}', footerCta);

  return html;
}

async function buildVersion(data, version) {
  const versionDir = path.join(config.paths.docs, version);
  if (!fs.existsSync(versionDir)) {
    fs.mkdirSync(versionDir, { recursive: true });
  }

  // Build version page
  const versionHtml = buildVersionPage(data);
  fs.writeFileSync(path.join(versionDir, 'index.html'), versionHtml, 'utf-8');

  // Copy PDF if exists
  const pdfSrc = path.join(config.paths.digests, `${version}.pdf`);
  if (fs.existsSync(pdfSrc)) {
    fs.copyFileSync(pdfSrc, path.join(versionDir, 'digest.pdf'));
  }

  // Rebuild homepage with all digests
  const digests = await db.getDigests();
  const homepageHtml = buildHomepage(digests);
  fs.writeFileSync(path.join(config.paths.docs, 'index.html'), homepageHtml, 'utf-8');

  return versionDir;
}

module.exports = { buildVersion, buildHomepage };
