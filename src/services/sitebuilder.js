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

// ─── Location coordinate lookup (for navigator_brief axes without lat/lon) ───
const LOCATION_COORDS = {
  // South Lebanon
  'אלח\'יאם': [33.350, 35.487], 'אלחיאם': [33.350, 35.487],
  'קנטרה': [33.283, 35.515],
  'בינת ג\'ביל': [33.115, 35.430], 'בינת גביל': [33.115, 35.430], 'בינת': [33.115, 35.430],
  'עיתרון': [33.083, 35.370],
  'עינאתא': [33.090, 35.447],
  'שמע': [33.103, 35.193],
  'נאקורה': [33.113, 35.137], 'אלנאקורה': [33.113, 35.137],
  'ראמיה': [33.133, 35.340],
  'צור': [33.270, 35.193],
  'מרג\'יון': [33.367, 35.593],
  'ח\'רבת מאעז': [33.250, 35.480],
  'דבל': [33.090, 35.420],
  'רשאף': [33.095, 35.455],
  'חאמול': [33.080, 35.210],
  // Gaza
  'עזה': [31.500, 34.467], 'רצועת עזה': [31.500, 34.467],
  'רפיח': [31.287, 34.250],
  'חאן יונס': [31.340, 34.300],
  'בית לאהיא': [31.558, 34.493],
  // West Bank
  'ג\'נין': [32.460, 35.300],
  'שכם': [32.217, 35.260], 'נבלוס': [32.217, 35.260],
  'טולכרם': [32.317, 35.013],
  'קלקיליה': [32.188, 34.970],
  'רמאללה': [31.900, 35.200],
  'חברון': [31.530, 35.100],
  // North Israel
  'קרית שמונה': [33.207, 35.570],
  'מטולה': [33.270, 35.570],
  'נהריה': [33.003, 35.094],
  'עכו': [32.928, 35.082],
  // Iran/Hormuz
  'הורמוז': [26.500, 56.500], 'מצרי הורמוז': [26.500, 56.500],
  'הרמוז': [26.500, 56.500],
};

function resolveCoords(axis) {
  // Use explicit lat/lon if provided
  if (axis.lat && axis.lon) return { lat: axis.lat, lon: axis.lon };

  // Try matching axis_name and area against known locations
  const text = `${axis.axis_name} ${axis.area || ''}`.toLowerCase();
  for (const [name, coords] of Object.entries(LOCATION_COORDS)) {
    if (text.includes(name.toLowerCase())) {
      return { lat: coords[0], lon: coords[1] };
    }
  }
  return { lat: null, lon: null };
}

function buildMapSection(axes) {
  if (!axes || axes.length === 0) return '';

  const axesWithCoords = axes.map(ax => {
    const { lat, lon } = resolveCoords(ax);
    return { ...ax, lat, lon };
  });

  const valid = axesWithCoords.filter(a => a.lat && a.lon);
  if (valid.length === 0) return '';

  const axesJson = JSON.stringify(axesWithCoords);

  return `
<div class="map-section" id="map-section">
  <div class="map-section-bar" id="map-bar">
    <div class="map-section-title">🗺 מפה טקטית — צירים חשופים</div>
    <span class="map-section-meta">${valid.length} צירים ממופים | לחץ להרחבה</span>
  </div>
  <div id="tactical-map"></div>
  <div class="map-legend">
    <div class="map-legend-item"><span class="map-legend-dot" style="background:#dc2626"></span>הימנע</div>
    <div class="map-legend-item"><span class="map-legend-dot" style="background:#f59e0b"></span>זהירות</div>
    <div class="map-legend-item"><span class="map-legend-dot" style="background:#16a34a"></span>עקוב</div>
    <div class="map-legend-item" style="margin-right:auto;color:var(--text-muted)">לחץ על marker לפרטים</div>
  </div>
</div>`;
}

// ─── Mobility Intelligence Builders ──────────────────────────────────────────

const STATUS_SUBLABEL = { GO: 'מאושר לתנועה', CAUTION: 'יציאה בזהירות', 'NO-GO': 'אסור לצאת' };

function buildMissionStatusBanner(missionStatus) {
  if (!missionStatus || !missionStatus.rating) return '';
  const { rating, reason } = missionStatus;
  const sublabel = STATUS_SUBLABEL[rating] || '';
  return `
    <div class="mission-status-banner">
      <div class="mission-status-card status-${rating}">
        <div class="mission-status-label">${rating}</div>
        <div class="mission-status-meta">
          <div class="mission-status-sublabel">${sublabel}</div>
          <div class="mission-status-reason">${reason || ''}</div>
        </div>
      </div>
    </div>`;
}

function buildCommanderBrief(items) {
  if (!items || items.length === 0) return '';
  const bullets = items.slice(0, 3)
    .map(item => `<div class="commander-brief-item">${item}</div>`)
    .join('');
  return `
    <div class="commander-brief-section">
      <div class="commander-brief-card">
        <h2>▶ בריפינג למפקד — לפני יציאה</h2>
        ${bullets}
      </div>
    </div>`;
}

const TIME_HEB   = { DAY: 'יום', NIGHT: 'לילה', BOTH: 'יום+לילה' };
const ACTION_HEB = { AVOID: 'הימנע', CAUTION: 'זהירות', MONITOR: 'עקוב' };

function buildNavigatorBrief(axes) {
  if (!axes || axes.length === 0) return '';
  const cards = axes.map(ax => `
    <div class="axis-card action-${ax.recommended_action}">
      <div class="axis-main">
        <div class="axis-header">
          <span class="axis-name">${ax.axis_name}</span>
          <span class="axis-area">${ax.area || ''}</span>
          <span class="axis-threat-type">${ax.threat_type || ''}</span>
        </div>
        <div class="axis-detail">${ax.detail || ''}</div>
      </div>
      <div class="axis-badges">
        <span class="time-badge time-${ax.time_pattern}">${TIME_HEB[ax.time_pattern] || ax.time_pattern}</span>
        <span class="action-badge badge-${ax.recommended_action}">${ACTION_HEB[ax.recommended_action] || ax.recommended_action}</span>
      </div>
    </div>`).join('');

  return `
    <div class="navigator-section">
      <h2>🗺 בריפינג לנווט — איומים לפי ציר</h2>
      <div class="navigator-legend">
        <div class="legend-item"><div class="legend-dot" style="background:#dc2626"></div>הימנע</div>
        <div class="legend-item"><div class="legend-dot" style="background:#f59e0b"></div>זהירות</div>
        <div class="legend-item"><div class="legend-dot" style="background:#16a34a"></div>עקוב</div>
      </div>
      <div class="axis-cards">${cards}</div>
    </div>`;
}

function buildDayNightMissions(dayMissions, nightMissions) {
  const hasDay   = dayMissions  && dayMissions.length  > 0;
  const hasNight = nightMissions && nightMissions.length > 0;
  if (!hasDay && !hasNight) return '';

  const buildItems = (items) => (items || []).map(item => `
    <div class="mission-threat-item">
      <div>${item.threat}</div>
      <div class="mission-threat-area">${item.area || ''}</div>
      <div class="mission-threat-action">→ ${item.action || ''}</div>
    </div>`).join('');

  const empty = '<div style="color:var(--text-muted);font-size:13px;padding:4px 0">אין איומים ספציפיים</div>';

  return `
    <div class="daynight-wrapper">
      <div class="daynight-grid">
        <div class="daynight-col col-day">
          <div class="daynight-header">
            <span class="daynight-icon">☀</span>
            <span class="daynight-title">משימות יום</span>
          </div>
          ${hasDay ? buildItems(dayMissions) : empty}
        </div>
        <div class="daynight-col col-night">
          <div class="daynight-header">
            <span class="daynight-icon">🌙</span>
            <span class="daynight-title">משימות לילה</span>
          </div>
          ${hasNight ? buildItems(nightMissions) : empty}
        </div>
      </div>
    </div>`;
}

function buildLessonsLearned(lessons) {
  if (!lessons || lessons.length === 0) return '';
  const cards = lessons.map(lesson => `
    <div class="lesson-card">
      <span class="lesson-what-label">מה קרה</span>
      <div class="lesson-what">${lesson.what_happened}</div>
      <div class="lesson-apply">
        <span class="lesson-apply-label">💡 מה ללמוד</span>
        <div class="lesson-apply-text">${lesson.apply_to_your_mission}</div>
      </div>
    </div>`).join('');

  return `
    <div class="lessons-section">
      <h2>📋 לקחים מהשטח</h2>
      ${cards}
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────

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

  // Build tactical map
  const mapSection = buildMapSection(data.navigator_brief || []);
  const axesWithCoords = (data.navigator_brief || []).map(ax => {
    const { lat, lon } = resolveCoords(ax);
    return { ...ax, lat, lon };
  });
  const mapAxesJson = JSON.stringify(axesWithCoords);

  // Build mobility sections
  const missionStatusBanner = buildMissionStatusBanner(data.mission_status);
  const commanderBrief      = buildCommanderBrief(data.commander_brief);
  const navigatorBrief      = buildNavigatorBrief(data.navigator_brief);
  const daynightMissions    = buildDayNightMissions(data.day_missions, data.night_missions);
  const lessonsLearned      = buildLessonsLearned(data.lessons_learned);

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
    .replace(/\{\{COMMANDER_NOTE\}\}/g, data.commander_note || '')
    .replace(/\{\{GREGORIAN_DATE\}\}/g, dates.gregorian)
    .replace(/\{\{HEBREW_DATE\}\}/g, dates.hebrew)
    .replace('{{SECTOR_CARDS}}', sectorCards)
    .replace('{{MISSION_STATUS_BANNER}}', missionStatusBanner)
    .replace('{{COMMANDER_BRIEF}}', commanderBrief)
    .replace('{{NAVIGATOR_BRIEF}}', navigatorBrief)
    .replace('{{DAYNIGHT_MISSIONS}}', daynightMissions)
    .replace('{{LESSONS_LEARNED}}', lessonsLearned)
    .replace('{{MAP_SECTION}}', mapSection)
    .replace('{{MAP_AXES_JSON}}', mapAxesJson);

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
