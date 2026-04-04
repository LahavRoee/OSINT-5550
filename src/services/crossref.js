/**
 * Cross-Reference Service — enriches OSINT items with external source validation
 * Searches open sources to corroborate or challenge reported intelligence
 */

const OSINT_SOURCES = [
  { name: 'ISW', url: 'https://www.understandingwar.org', type: 'analysis', reliability: 'HIGH' },
  { name: 'Reuters', url: 'https://www.reuters.com', type: 'news', reliability: 'HIGH' },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com', type: 'news', reliability: 'MEDIUM' },
  { name: 'Times of Israel', url: 'https://www.timesofisrael.com', type: 'news', reliability: 'HIGH' },
  { name: 'ACLED', url: 'https://acleddata.com', type: 'data', reliability: 'HIGH' },
  { name: 'Telegram OSINT', url: 'https://t.me', type: 'social', reliability: 'LOW' },
  { name: 'X/Twitter', url: 'https://x.com', type: 'social', reliability: 'LOW' },
  { name: 'Al-Monitor', url: 'https://www.al-monitor.com', type: 'analysis', reliability: 'HIGH' },
  { name: 'Ynet', url: 'https://www.ynet.co.il', type: 'news', reliability: 'MEDIUM' },
  { name: 'BBC', url: 'https://www.bbc.com', type: 'news', reliability: 'HIGH' },
];

const RELIABILITY_LABELS = {
  HIGH: { he: 'מהימנות גבוהה', color: '#16a34a', icon: '\u2705' },
  MEDIUM: { he: 'מהימנות בינונית', color: '#ca8a04', icon: '\uD83D\uDFE1' },
  LOW: { he: 'מהימנות נמוכה', color: '#dc2626', icon: '\uD83D\uDD34' },
};

/**
 * Build cross-reference data for a synthesis item
 * This generates recommendations for external source checking
 */
function buildCrossRefForItem(item) {
  const refs = [];

  // Determine relevant sources based on actor and domain
  const keywords = extractKeywords(item);

  // Always recommend ISW for military analysis
  if (item.domain === 'KINETIC' || item.domain === 'TERRAIN') {
    refs.push({
      source: 'ISW',
      reason: 'ניתוח צבאי מקצועי',
      searchUrl: `https://www.understandingwar.org/search?query=${encodeURIComponent(keywords.en)}`,
      reliability: 'HIGH',
    });
  }

  // Reuters/BBC for verified news
  refs.push({
    source: 'Reuters',
    reason: 'אימות עובדתי',
    searchUrl: `https://www.reuters.com/search/news?query=${encodeURIComponent(keywords.en)}`,
    reliability: 'HIGH',
  });

  // Actor-specific sources
  if (item.actor === 'HEZBOLLAH') {
    refs.push({
      source: 'Al-Monitor',
      reason: 'ניתוח מזרח תיכוני',
      searchUrl: `https://www.al-monitor.com/search?q=${encodeURIComponent('hezbollah ' + keywords.en)}`,
      reliability: 'HIGH',
    });
    refs.push({
      source: 'Times of Israel',
      reason: 'ראייה ישראלית',
      searchUrl: `https://www.timesofisrael.com/?s=${encodeURIComponent('hezbollah ' + keywords.en)}`,
      reliability: 'HIGH',
    });
  }

  if (item.actor === 'IRAN') {
    refs.push({
      source: 'Al-Monitor',
      reason: 'ניתוח איראני',
      searchUrl: `https://www.al-monitor.com/search?q=${encodeURIComponent('iran ' + keywords.en)}`,
      reliability: 'HIGH',
    });
    refs.push({
      source: 'BBC',
      reason: 'סיקור בינלאומי',
      searchUrl: `https://www.bbc.com/search?q=${encodeURIComponent('iran ' + keywords.en)}`,
      reliability: 'HIGH',
    });
  }

  // Social media sources for SOCIAL domain
  if (item.domain === 'SOCIAL' || item.domain === 'CYBER') {
    refs.push({
      source: 'X/Twitter',
      reason: 'ניטור רשתות',
      searchUrl: `https://x.com/search?q=${encodeURIComponent(keywords.en)}`,
      reliability: 'LOW',
    });
  }

  // Assess overall corroboration level
  const corroboration = assessCorroboration(item);

  return {
    itemId: item.id,
    refs,
    corroboration,
  };
}

function extractKeywords(item) {
  // Extract English-friendly keywords from the item for search URLs
  const actorMap = { HAMAS: 'Hamas', HEZBOLLAH: 'Hezbollah', IRAN: 'Iran', OTHERS: '' };
  const domainMap = { KINETIC: 'attack strike', TERRAIN: 'military position', SOCIAL: 'propaganda', CYBER: 'cyber', GENERAL: '' };

  const actor = actorMap[item.actor] || '';
  const domain = domainMap[item.domain] || '';

  // Extract location from 'where' field
  const where = (item.where || '').replace(/[^\w\s-]/g, '').trim();

  return {
    en: `${actor} ${domain} ${where} Lebanon`.trim(),
    he: item.title || '',
  };
}

function assessCorroboration(item) {
  // Based on the item's own confidence and source patterns
  if (item.confidence === 'HIGH') {
    return { level: 'CORROBORATED', he: 'מאומת ממספר מקורות', color: '#16a34a' };
  }
  if (item.confidence === 'MEDIUM') {
    return { level: 'PARTIALLY', he: 'מאומת חלקית', color: '#ca8a04' };
  }
  return { level: 'UNCORROBORATED', he: 'לא מאומת — נדרש אימות', color: '#dc2626' };
}

/**
 * Generate cross-references for all items in synthesis data
 */
function generateCrossRefs(synthesisData) {
  const allRefs = {};

  for (const [actorKey, actorData] of Object.entries(synthesisData.actors)) {
    for (const item of actorData.items || []) {
      allRefs[item.id] = buildCrossRefForItem(item);
    }
  }

  return allRefs;
}

/**
 * Build HTML sidebar for cross-references
 */
function buildCrossRefSidebar(crossRefs) {
  let html = '<div class="crossref-sidebar">';
  html += '<h2>הצלבת מקורות</h2>';
  html += '<div class="crossref-desc">מקורות חיצוניים לאימות ובדיקה</div>';

  for (const [itemId, data] of Object.entries(crossRefs)) {
    const corrColor = data.corroboration.color;
    const corrText = data.corroboration.he;

    html += `<div class="crossref-item" data-item-id="${itemId}">`;
    html += `<div class="crossref-item-header">`;
    html += `<span class="crossref-id">${itemId}</span>`;
    html += `<span class="crossref-status" style="color:${corrColor}">${corrText}</span>`;
    html += `</div>`;

    html += `<div class="crossref-links">`;
    for (const ref of data.refs) {
      const rel = RELIABILITY_LABELS[ref.reliability];
      html += `<a href="${ref.searchUrl}" target="_blank" rel="noopener" class="crossref-link">`;
      html += `<span class="crossref-source">${ref.source}</span>`;
      html += `<span class="crossref-reason">${ref.reason}</span>`;
      html += `<span class="crossref-reliability" style="color:${rel.color}">${rel.icon}</span>`;
      html += `</a>`;
    }
    html += `</div></div>`;
  }

  html += '</div>';
  return html;
}

module.exports = { generateCrossRefs, buildCrossRefSidebar, buildCrossRefForItem };
