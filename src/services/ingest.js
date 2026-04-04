const db = require('../database');

const ACTOR_KEYWORDS = {
  HAMAS: ['חמאס', 'קסאם', 'עזה', 'gaza', 'hamas', 'רצועה', 'נוחבה', 'סינוואר', 'פלאג\''],
  HEZBOLLAH: ['חיזבאללה', 'לבנון', 'נסראללה', 'hezbollah', 'lebanon', 'רדואן', 'צפון'],
  IRAN: ['איראן', 'iran', 'irgc', 'טהרן', 'פיילק', 'קודס', 'חמינאי', 'פרס'],
  OTHERS: ['חות\'ים', 'תימן', 'yemen', 'houthi', 'סוריה', 'syria', 'גדה', 'ג\'נין', 'שכם'],
};

const DOMAIN_KEYWORDS = {
  KINETIC: ['ירי', 'רקטה', 'טיל', 'פיצוץ', 'חיסול', 'תקיפה', 'לחימה', 'כטבם', 'מנהרה', 'חדירה', 'ירט'],
  TERRAIN: ['שטח', 'תשתית', 'מבנה', 'ציר', 'גבול', 'מעבר', 'גדר', 'בסיס'],
  SOCIAL: ['רשת', 'טלגרם', 'opsec', 'תעמולה', 'פרסום', 'סרטון', 'תמונה', 'דליפה', 'זיהוי'],
  CYBER: ['סייבר', 'פריצה', 'האקר', 'מכשיר', 'אפליקציה', 'GPS', 'מעקב', 'phishing'],
  GENERAL: ['רקע', 'הקשר', 'פוליטי', 'דיפלומטי', 'הסכם', 'עסקה'],
};

function classifyActor(text) {
  const lower = text.toLowerCase();
  let best = null;
  let bestCount = 0;
  for (const [actor, keywords] of Object.entries(ACTOR_KEYWORDS)) {
    const count = keywords.filter(kw => lower.includes(kw.toLowerCase())).length;
    if (count > bestCount) { best = actor; bestCount = count; }
  }
  return best;
}

function classifyDomain(text) {
  const lower = text.toLowerCase();
  let best = 'GENERAL';
  let bestCount = 0;
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    const count = keywords.filter(kw => lower.includes(kw.toLowerCase())).length;
    if (count > bestCount) { best = domain; bestCount = count; }
  }
  return best;
}

async function ingestMessage({ text, sourceNumber, sourceName }) {
  const actor = classifyActor(text);
  const domain = classifyDomain(text);

  const id = await db.insertUpdate({
    rawText: text,
    sourceNumber: sourceNumber || null,
    sourceName: sourceName || null,
    actor,
    domain,
  });

  console.log(`  [${id}] ${actor || '?'} / ${domain} — ${text.substring(0, 60)}...`);
  return id;
}

function classifyUpdate(text) {
  return {
    actor: classifyActor(text),
    domain: classifyDomain(text),
  };
}

module.exports = { ingestMessage, classifyActor, classifyDomain, classifyUpdate };
