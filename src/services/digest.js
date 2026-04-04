const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const db = require('../database');
const { buildSynthesisPrompt } = require('../prompts/synthesis');

async function synthesize({ newUpdates, historical, version, today }) {
  const date = today.split('-').reverse().join('/'); // 2026-04-03 → 03/04/2026

  const prompt = buildSynthesisPrompt({
    newUpdates,
    historical,
    version,
    date,
  });

  const client = new Anthropic({ apiKey: config.anthropic.apiKey });

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  });

  // Extract JSON from response
  let jsonText = response.content[0].text.trim();

  // Handle markdown code blocks
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const synthesisData = JSON.parse(jsonText);

  // Save digest to DB
  const digestId = await db.createDigest({
    version,
    date: today,
    threatLevel: synthesisData.meta.threat_level,
    headline: synthesisData.situational_picture,
    newCount: synthesisData.meta.new_items,
    historicalCount: synthesisData.meta.historical_items,
    synthesisJson: synthesisData,
  });

  // Save persistent intel items
  const persistentItems = [];
  for (const [actorKey, actorData] of Object.entries(synthesisData.actors)) {
    for (const item of actorData.items || []) {
      if (item.is_persistent) {
        persistentItems.push({
          actor: item.actor,
          domain: item.domain,
          summary: `${item.title}: ${item.what}`,
          relevance_score: item.confidence === 'HIGH' ? 8 : item.confidence === 'MEDIUM' ? 5 : 3,
          expires_at: item.keep_until || null,
        });
      }
    }
  }
  if (persistentItems.length > 0) {
    await db.upsertPersistentIntel(persistentItems);
  }

  return { ...synthesisData, digestId };
}

/**
 * runSynthesis — Claude API only, no DB writes.
 * Used by daily-check.js which manages DB operations itself.
 * @param {object} opts
 * @param {Array}  opts.updates  - array of update rows from DB
 * @param {string} opts.version  - e.g. 'v2026.04.04'
 * @param {string} opts.date     - DD/MM/YYYY
 */
async function runSynthesis({ updates, version, date }) {
  const historical = await db.getPersistentIntel();

  const prompt = buildSynthesisPrompt({
    newUpdates: updates,
    historical,
    version,
    date,
  });

  const client = new Anthropic({ apiKey: config.anthropic.apiKey });

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  });

  let jsonText = response.content[0].text.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const synthesisData = JSON.parse(jsonText);

  // Save persistent intel items to DB
  const persistentItems = [];
  for (const actorData of Object.values(synthesisData.actors)) {
    for (const item of actorData.items || []) {
      if (item.is_persistent) {
        persistentItems.push({
          actor: item.actor,
          domain: item.domain,
          summary: `${item.title}: ${item.what}`,
          relevance_score: item.confidence === 'HIGH' ? 8 : item.confidence === 'MEDIUM' ? 5 : 3,
          expires_at: item.keep_until || null,
        });
      }
    }
  }
  if (persistentItems.length > 0) {
    await db.upsertPersistentIntel(persistentItems);
  }

  return synthesisData;
}

module.exports = { synthesize, runSynthesis };
