/**
 * napkin.js — Persistent intel knowledge store using napkin-ai
 * Saves processed digest items to the intel vault for historical search
 */

const { execSync } = require('child_process');
const path = require('path');

const VAULT = path.join(__dirname, '../../data/intel-vault');

function napkin(args) {
  try {
    const out = execSync(`napkin ${args} --path "${VAULT}" --json -q 2>/dev/null`, {
      encoding: 'utf8', timeout: 10000,
    });
    return out.trim();
  } catch (err) {
    // napkin errors are non-fatal
    console.error('  napkin error:', err.message?.substring(0, 80));
    return null;
  }
}

/**
 * Save today's digest summary to the daily log
 */
function saveDigestSummary(synthesisData) {
  const { version, date, threat_level } = synthesisData.meta;
  const url = `https://lahavroee.github.io/OSINT-5550/${version}/`;
  const status = (synthesisData.mission_status || {}).rating || 'UNKNOWN';

  const lines = [
    `# Digest ${version} — ${date}`,
    `Threat: ${threat_level} | Mission: ${status}`,
    `URL: ${url}`,
    '',
    '## Situation',
    synthesisData.situational_picture || '',
    '',
    '## Key Takeaways',
    (synthesisData.key_takeaways || []).map(t => `- ${t}`).join('\n'),
    '',
    '## Commander Note',
    synthesisData.commander_note || '',
  ];

  const entry = lines.join('\n');
  const dateStr = date.includes('/') ? date.split('/').reverse().join('-') : date;
  const escaped = entry.replace(/'/g, "\\'");
  napkin(`create "daily/${dateStr}" --content '${escaped}'`);
  console.log(`   📚 napkin: digest saved to daily/${dateStr}`);
}

/**
 * Update threat-actor profiles with today's intel items
 */
function saveActorItems(synthesisData) {
  const actors = synthesisData.actors || {};
  for (const [actor, data] of Object.entries(actors)) {
    if (!data.items || data.items.length === 0) continue;
    const items = data.items.map(i =>
      `- **${i.id}** ${i.title}: ${i.what} (${i.where}) → ${i.action}`
    ).join('\n');
    const entry = `\n## ${synthesisData.meta.date} — Level: ${data.threat_level}\n${items}\n`;
    const escaped = entry.replace(/'/g, "\\'");
    napkin(`append "threat-actors/${actor}" '${escaped}'`);
  }
  console.log('   📚 napkin: actor profiles updated');
}

/**
 * Save red patterns and navigator brief axes to analysis
 */
function saveAnalysis(synthesisData) {
  const patterns = (synthesisData.red_patterns || []).map(p => `- ${p}`).join('\n');
  const axes = (synthesisData.navigator_brief || []).map(a =>
    `- **${a.axis_name}** [${a.threat_type}/${a.time_pattern}] ${a.recommended_action}: ${a.detail}`
  ).join('\n');

  if (!patterns && !axes) return;

  const entry = `\n## ${synthesisData.meta.date}\n### Red Patterns\n${patterns}\n### Axes\n${axes}\n`;
  const escaped = entry.replace(/'/g, "\\'");
  napkin(`append "analysis/patterns" '${escaped}'`);
  console.log('   📚 napkin: patterns & axes saved');
}

/**
 * Search intel vault for historical context (used before synthesis)
 */
function searchIntel(query) {
  return napkin(`search "${query}"`);
}

/**
 * Full post-digest save: summary + actors + analysis
 */
async function saveDigest(synthesisData) {
  try {
    saveDigestSummary(synthesisData);
    saveActorItems(synthesisData);
    saveAnalysis(synthesisData);
  } catch (err) {
    console.error('  napkin save failed (non-fatal):', err.message);
  }
}

module.exports = { saveDigest, searchIntel };
