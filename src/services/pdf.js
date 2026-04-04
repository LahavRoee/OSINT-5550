const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const config = require('../config');

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

function renderHtml(data) {
  const templatePath = path.join(config.paths.templates, 'pdf.html');
  let html = fs.readFileSync(templatePath, 'utf-8');

  const takeaways = data.key_takeaways.map(t => `<li>${t}</li>`).join('');

  const actorsSections = ['HAMAS', 'HEZBOLLAH', 'IRAN', 'OTHERS']
    .map(key => buildActorSection(key, data.actors[key] || { items: [] }))
    .join('');

  const redPatterns = data.red_patterns && data.red_patterns.length > 0
    ? `<div class="alerts-section"><h2>דפוסי איום חוזרים</h2>${data.red_patterns.map(p => `<div class="alert-item">${p}</div>`).join('')}</div>`
    : '';

  const opsecAlerts = data.blue_opsec_alerts && data.blue_opsec_alerts.length > 0
    ? `<div class="alerts-section"><h2>התראות OPSEC</h2>${data.blue_opsec_alerts.map(a => `<div class="alert-item opsec-item">${a}</div>`).join('')}</div>`
    : '';

  html = html
    .replace('{{VERSION}}', data.meta.version)
    .replace('{{DATE}}', data.meta.date)
    .replace(/\{\{THREAT_LEVEL\}\}/g, data.meta.threat_level)
    .replace('{{NEW_ITEMS}}', data.meta.new_items)
    .replace('{{SITUATIONAL_PICTURE}}', data.situational_picture)
    .replace('{{TAKEAWAYS}}', takeaways)
    .replace('{{ACTORS_SECTIONS}}', actorsSections)
    .replace('{{RED_PATTERNS}}', redPatterns)
    .replace('{{OPSEC_ALERTS}}', opsecAlerts)
    .replace('{{COMMANDER_NOTE}}', data.commander_note || '');

  return html;
}

async function generate(data, version) {
  const html = renderHtml(data);

  // Ensure digests directory exists
  if (!fs.existsSync(config.paths.digests)) {
    fs.mkdirSync(config.paths.digests, { recursive: true });
  }

  const pdfPath = path.join(config.paths.digests, `${version}.pdf`);

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
