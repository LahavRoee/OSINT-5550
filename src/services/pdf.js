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

function buildActorSection(actorKey, actorData) {
  if (!actorData.items || actorData.items.length === 0) return '';

  const items = actorData.items.map(item => `
    <div class="item-card">
      <div class="item-title">
        <span class="item-id">${item.id}</span>
        ${item.title}
        <span class="domain-tag">${item.domain}</span>
        <span class="confidence confidence-${item.confidence}">${item.confidence}</span>
      </div>
      <div class="field"><span class="field-label">מה: </span>${item.what}</div>
      <div class="field"><span class="field-label">איפה: </span>${item.where}</div>
      <div class="field"><span class="field-label">משמעות: </span>${item.so_what}</div>
      <div class="action">פעולה: ${item.action}</div>
    </div>
  `).join('');

  return `
    <div class="actor-section actor-${actorKey}">
      <div class="actor-header">
        <span>${ACTOR_NAMES[actorKey]} (${actorData.items.length})</span>
        <span class="threat-badge threat-${actorData.threat_level}">${actorData.threat_level}</span>
      </div>
      ${items}
    </div>
  `;
}

/**
 * Filter synthesis data by sector (actor or domain)
 * @param {object} data - full synthesis data
 * @param {object} opts - { actor: 'HAMAS' } or { domain: 'KINETIC' } or null for all
 */
function filterBySector(data, opts) {
  if (!opts) return data;

  const filtered = JSON.parse(JSON.stringify(data)); // deep clone

  if (opts.actor) {
    // Keep only the specified actor
    for (const key of Object.keys(filtered.actors)) {
      if (key !== opts.actor) {
        filtered.actors[key] = { threat_level: 'LOW', items: [] };
      }
    }
    const actorItems = filtered.actors[opts.actor]?.items?.length || 0;
    filtered.meta.new_items = actorItems;
  }

  if (opts.domain) {
    // Filter items within each actor to only the specified domain
    let totalItems = 0;
    for (const key of Object.keys(filtered.actors)) {
      const actor = filtered.actors[key];
      if (actor.items) {
        actor.items = actor.items.filter(item => item.domain === opts.domain);
        totalItems += actor.items.length;
      }
    }
    filtered.meta.new_items = totalItems;
  }

  return filtered;
}

function renderHtml(data, opts) {
  const templatePath = path.join(config.paths.templates, 'pdf.html');
  let html = fs.readFileSync(templatePath, 'utf-8');

  const filteredData = filterBySector(data, opts);

  const takeaways = filteredData.key_takeaways.map(t => `<li>${t}</li>`).join('');

  const actorsSections = ['HAMAS', 'HEZBOLLAH', 'IRAN', 'OTHERS']
    .map(key => buildActorSection(key, filteredData.actors[key] || { items: [] }))
    .join('');

  const redPatterns = filteredData.red_patterns && filteredData.red_patterns.length > 0
    ? `<div class="alerts-section"><h2>דפוסי איום חוזרים</h2>${filteredData.red_patterns.map(p => `<div class="alert-item">${p}</div>`).join('')}</div>`
    : '';

  const opsecAlerts = filteredData.blue_opsec_alerts && filteredData.blue_opsec_alerts.length > 0
    ? `<div class="alerts-section"><h2>התראות OPSEC</h2>${filteredData.blue_opsec_alerts.map(a => `<div class="alert-item opsec-item">${a}</div>`).join('')}</div>`
    : '';

  // Dates
  const dateStr = filteredData.meta.date; // DD/MM/YYYY
  const dates = getBothDates(dateStr);

  // Logo path (absolute file:// for Puppeteer)
  const logoPath = path.join(config.paths.docs, 'assets', 'logo.png').replace(/\\/g, '/');

  // Sector title
  let sectorTitle = '';
  if (opts?.actor) sectorTitle = ` — גזרת ${ACTOR_NAMES[opts.actor]}`;
  if (opts?.domain) sectorTitle = ` — תחום ${opts.domain}`;

  html = html
    .replace(/\{\{VERSION\}\}/g, filteredData.meta.version)
    .replace(/\{\{THREAT_LEVEL\}\}/g, filteredData.meta.threat_level)
    .replace('{{NEW_ITEMS}}', filteredData.meta.new_items)
    .replace('{{SITUATIONAL_PICTURE}}', filteredData.situational_picture)
    .replace('{{TAKEAWAYS}}', takeaways)
    .replace('{{ACTORS_SECTIONS}}', actorsSections)
    .replace('{{RED_PATTERNS}}', redPatterns)
    .replace('{{OPSEC_ALERTS}}', opsecAlerts)
    .replace('{{COMMANDER_NOTE}}', filteredData.commander_note || '')
    .replace(/\{\{GREGORIAN_DATE\}\}/g, dates.gregorian)
    .replace(/\{\{HEBREW_DATE\}\}/g, dates.hebrew)
    .replace(/\{\{DISPLAY_DATE\}\}/g, dates.display)
    .replace('{{LOGO_PATH}}', 'file:///' + logoPath)
    .replace('{{SECTOR_TITLE}}', sectorTitle);

  return html;
}

/**
 * Generate PDF
 * @param {object} data - synthesis data
 * @param {string} version - e.g. 'v2026.04.04'
 * @param {object} [sectorOpts] - optional { actor: 'HAMAS' } or { domain: 'KINETIC' }
 */
async function generate(data, version, sectorOpts) {
  const html = renderHtml(data, sectorOpts);

  if (!fs.existsSync(config.paths.digests)) {
    fs.mkdirSync(config.paths.digests, { recursive: true });
  }

  // Build filename: OSINT-5550_04-APRIL-2026[-sector].pdf
  const displayDate = getDisplayDateString(data.meta.date);
  let suffix = '';
  if (sectorOpts?.actor) suffix = `-${sectorOpts.actor.toLowerCase()}`;
  if (sectorOpts?.domain) suffix = `-${sectorOpts.domain.toLowerCase()}`;

  const pdfPath = path.join(config.paths.digests, `OSINT-5550_${displayDate}${suffix}.pdf`);

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

module.exports = { generate, renderHtml, filterBySector };
