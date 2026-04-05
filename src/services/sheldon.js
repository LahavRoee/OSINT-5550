/**
 * Sheldon Agent Connection — sends digests via OpenClaw webhook
 * Sheldon is Roee's WhatsApp AI agent running on OpenClaw
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

// ─── Location coords (mirror of sitebuilder — for Maps URL generation) ────────

const LOCATION_COORDS = {
  // Lebanon
  'נאקורה': [33.113, 35.137], 'בינת ג\'בייל': [33.118, 35.428],
  'מרג\'עיון': [33.36, 35.59], 'טייבה': [33.374, 35.502],
  'כפר קילא': [33.316, 35.564], 'ח\'יאם': [33.293, 35.601],
  'שמע': [33.233, 35.424], 'עיתא אל-שעב': [33.116, 35.285],
  'אל-ח\'יאם': [33.293, 35.601], 'ראש נקורה': [33.101, 35.104],
  'נבטייה': [33.377, 35.484], 'צור': [33.271, 35.194],
  'צידון': [33.558, 35.37], 'ביירות': [33.888, 35.495],
  'בעלבק': [34.004, 36.212], 'הרמל': [34.395, 36.387],
  'דמשק': [33.513, 36.292],
  // Gaza / Hamas
  'נוסיירט': [31.426, 34.395], 'נצרים': [31.389, 34.337],
  'רפיח': [31.296, 34.244], 'ח\'אן יונס': [31.344, 34.305],
  'בית לאהייא': [31.551, 34.494], 'ג\'באליה': [31.529, 34.484],
  'שכונת א-שיג\'עייה': [31.501, 34.482], 'עזה': [31.5, 34.467],
  // Israel / North
  'מירון': [32.997, 35.421], 'קריית שמונה': [33.207, 35.57],
  'מטולה': [33.272, 35.567], 'שלומי': [33.077, 35.149],
  'ראש פינה': [32.972, 35.546], 'צפת': [32.964, 35.496],
  'טבריה': [32.794, 35.531], 'נהריה': [33.003, 35.094],
  'כרמיאל': [32.919, 35.296], 'עכו': [32.923, 35.076],
  'חיפה': [32.815, 34.985], 'קצרין': [32.994, 35.692],
  // Iran / Region
  'טהרן': [35.689, 51.389], 'איספהן': [32.657, 51.677],
  'נתנז': [33.723, 51.926], 'פורדו': [34.882, 50.994],
  'בגדד': [33.325, 44.422], 'דמשק': [33.513, 36.292],
  'ביירות': [33.888, 35.495], 'סנעא': [15.352, 44.207],
};

function resolveCoords(text) {
  const lower = (text || '').toLowerCase();
  for (const [name, coords] of Object.entries(LOCATION_COORDS)) {
    const escaped = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![א-תa-z\\d])${escaped}(?![א-תa-z\\d])`, 'u');
    if (re.test(lower)) return coords;
  }
  return null;
}

// ─── Build Google Maps links per actor ────────────────────────────────────────

function buildMapsLinks(actors) {
  const links = {};
  const ACTOR_NAMES = { HAMAS:'חמאס/עזה', HEZBOLLAH:'חיזבאללה/לבנון', IRAN:'איראן', OTHERS:'אחרים' };

  for (const [actorKey, actorData] of Object.entries(actors)) {
    const items = actorData?.items || [];
    if (!items.length) continue;

    // Collect unique coordinates for this actor
    const seen = new Set();
    const coords = [];
    for (const item of items) {
      const c = resolveCoords(item.translated_text || item.original_text || '');
      if (c) {
        const key = `${c[0]},${c[1]}`;
        if (!seen.has(key)) { seen.add(key); coords.push(c); }
      }
    }
    if (!coords.length) continue;

    // Google Maps directions URL — up to 10 waypoints
    const points = coords.slice(0, 10);
    if (points.length === 1) {
      links[actorKey] = {
        label: ACTOR_NAMES[actorKey] || actorKey,
        url: `https://www.google.com/maps/search/?api=1&query=${points[0][0]},${points[0][1]}`,
        count: 1,
      };
    } else {
      const waypoints = points.map(p => `${p[0]},${p[1]}`).join('/');
      links[actorKey] = {
        label: ACTOR_NAMES[actorKey] || actorKey,
        url: `https://www.google.com/maps/dir/${waypoints}`,
        count: points.length,
      };
    }
  }
  return links;
}

// ─── Core send function ───────────────────────────────────────────────────────

async function sendViaSheldon(message, toNumber) {
  const cfg = config.sheldon;
  const target = toNumber || cfg.roeeNumber;

  if (!cfg.gatewayToken) {
    console.log('   ⚠️  Sheldon לא מוגדר (חסר SHELDON_GATEWAY_TOKEN)');
    console.log('   הודעה שהייתה נשלחת → ' + target + ':');
    console.log('   ' + message.substring(0, 200));
    return false;
  }

  try {
    const res = await fetch(`${cfg.gatewayUrl}/api/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.gatewayToken}`,
      },
      body: JSON.stringify({ to: target, message }),
    });
    const result = await res.json();
    if (res.ok) { console.log(`   ✅ נשלח (${target})`); return true; }
    console.error('   ❌ שגיאה בשליחה:', result);
    return false;
  } catch (err) {
    console.error('   ❌ שלדון לא זמין:', err.message);
    return false;
  }
}

async function sendToGroup(message) {
  const cfg = config.sheldon;
  const groupJid = cfg.osintGroupJid;

  if (!groupJid) {
    // Fallback: send to Roee + Dvir personally
    console.log('   ⚠️  OSINT_GROUP_JID לא מוגדר — שולח ישירות לרועי ודביר');
    const tasks = [sendViaSheldon(message, cfg.roeeNumber)];
    if (cfg.dvirNumber) tasks.push(sendViaSheldon(message, cfg.dvirNumber));
    await Promise.all(tasks);
    return true;
  }

  return sendViaSheldon(message, groupJid);
}

// ─── Send PDF file via OpenClaw ───────────────────────────────────────────────

async function sendPdfFile(pdfPath, caption, toNumber) {
  const cfg = config.sheldon;
  const target = toNumber || cfg.osintGroupJid || cfg.roeeNumber;

  if (!cfg.gatewayToken) {
    console.log('   ⚠️  Sheldon לא מוגדר — PDF לא נשלח');
    return false;
  }

  try {
    const pdfBuffer = fs.readFileSync(pdfPath);
    const base64 = pdfBuffer.toString('base64');
    const filename = path.basename(pdfPath).replace('.tmp', '');

    const res = await fetch(`${cfg.gatewayUrl}/api/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.gatewayToken}`,
      },
      body: JSON.stringify({
        to: target,
        type: 'document',
        base64,
        filename,
        caption: caption || '',
      }),
    });

    if (res.ok) {
      console.log(`   ✅ PDF נשלח (${filename}) → ${target}`);
      return true;
    }
    // Fallback: if document sending not supported, send link message
    console.log('   ⚠️  שליחת קובץ לא נתמכת — שולח הודעת קישור');
    return false;
  } catch (err) {
    console.error('   ❌ שגיאה בשליחת PDF:', err.message);
    return false;
  }
}

// ─── Build review request message ────────────────────────────────────────────

function buildReviewMessage(synthesisData, webUrl, mapsLinks) {
  const ACTOR_EMOJI = { HEZBOLLAH: '🟠', HAMAS: '🔴', IRAN: '🟣', OTHERS: '🟢' };
  const ACTOR_NAMES = { HEZBOLLAH: 'חיזבאללה/לבנון', HAMAS: 'חמאס/עזה', IRAN: 'איראן', OTHERS: 'אחרים' };
  const ORDER = ['HEZBOLLAH', 'HAMAS', 'IRAN', 'OTHERS'];

  // Summary lines — Lebanon first
  const summaryLines = ORDER.map(key => {
    const count = synthesisData.actors?.[key]?.items?.length || 0;
    const emoji = ACTOR_EMOJI[key];
    const name = ACTOR_NAMES[key];
    return `${emoji} ${name}: *${count}* ידיעות`;
  }).join('\n');

  // Maps lines
  const mapLines = ORDER
    .filter(key => mapsLinks[key])
    .map(key => {
      const m = mapsLinks[key];
      return `🗺 ${m.label} (${m.count} מיקומים): ${m.url}`;
    }).join('\n');

  const total = synthesisData.meta?.item_count || 0;
  const version = synthesisData.meta?.version || '';
  const date = synthesisData.meta?.date || '';

  return `🗂 *תחקיר OSINT מוכן לסקירה*
📅 ${version} | ${date} | ${total} ידיעות

📊 *סיכום לפי גזרה:*
${summaryLines}

🌐 *צפה בדוח המלא:*
${webUrl}
${mapLines ? '\n' + mapLines : ''}

━━━━━━━━━━━━━━━━━
✅ לאישור ושליחה: *אשר*
❌ לביטול: *בטל*
━━━━━━━━━━━━━━━━━
_יל"ק 5550 — יסוד האש_`;
}

// ─── Send review request (called after PDF is built) ─────────────────────────

async function sendReviewRequest(synthesisData, pdfPath) {
  const db = require('../database');
  const cfg = config.sheldon;

  const webUrl = `https://${config.github.username}.github.io/${config.github.repo}/${synthesisData.meta.version}/`;
  const mapsLinks = buildMapsLinks(synthesisData.actors || {});

  // Save pending state to DB
  await db.setPendingReview({
    digestId:       synthesisData.digestId || 0,
    version:        synthesisData.meta.version,
    pdfPath,
    webUrl,
    mapsJson:       mapsLinks,
    timeoutMinutes: cfg.reviewTimeoutMinutes,
  });

  const message = buildReviewMessage(synthesisData, webUrl, mapsLinks);

  console.log('   📤 שולח בקשת סקירה לקבוצה...');
  await sendToGroup(message);

  const expiresIn = cfg.reviewTimeoutMinutes;
  console.log(`   ⏳ ממתין לאישור (תפוגה בעוד ${expiresIn} דק׳)...`);
}

// ─── Send approved digest (called when "אשר" arrives via webhook) ─────────────

async function sendApprovedDigest(pending) {
  const ORDER = ['HEZBOLLAH', 'HAMAS', 'IRAN', 'OTHERS'];
  const ACTOR_NAMES = { HEZBOLLAH: 'חיזבאללה/לבנון', HAMAS: 'חמאס/עזה', IRAN: 'איראן', OTHERS: 'אחרים' };

  // Maps lines from stored maps JSON
  const mapsLines = ORDER
    .filter(k => pending.maps?.[k])
    .map(k => `🗺 ${pending.maps[k].label}: ${pending.maps[k].url}`)
    .join('\n');

  const summaryMsg =
    `✅ *תחקיר OSINT אושר ונשלח*\n` +
    `📅 ${pending.version}\n` +
    `🌐 ${pending.web_url}\n` +
    (mapsLines ? `\n${mapsLines}\n` : '') +
    `\n_יל"ק 5550 — יסוד האש | רס"ן רועי להב_`;

  console.log('   📱 שולח תחקיר מאושר לקבוצה...');

  // 1. Try to send PDF file
  let pdfSent = false;
  if (pending.pdf_path) {
    const actualPath = pending.pdf_path.replace(/\.tmp$/, '') ;
    const tryPaths = [actualPath, pending.pdf_path];
    for (const p of tryPaths) {
      try {
        if (require('fs').existsSync(p)) {
          pdfSent = await sendPdfFile(p, `תחקיר OSINT ${pending.version}`, null);
          if (pdfSent) break;
        }
      } catch (_) {}
    }
  }

  // 2. Send summary + maps (always)
  await sendToGroup(summaryMsg);

  if (!pdfSent) {
    console.log('   ℹ️  PDF לא נשלח כקובץ — הקישור נשלח בהודעה');
  }
}

// ─── Legacy: full digest message (backward-compat) ────────────────────────────

function buildDigestMessage(data) {
  const webUrl = `https://${config.github.username}.github.io/${config.github.repo}/${data.meta.version}/`;
  const mapsLinks = buildMapsLinks(data.actors || {});
  return buildReviewMessage(data, webUrl, mapsLinks)
    .replace('*אשר*\n❌ לביטול: *בטל*\n━━━━━━━━━━━━━━━━━', '(אין צורך באישור — הופק ידנית)');
}

async function sendDigestViaSheldon(data) {
  const message = buildDigestMessage(data);
  return sendViaSheldon(message);
}

async function sendAlert(message) {
  return sendViaSheldon(message);
}

module.exports = {
  sendViaSheldon,
  sendToGroup,
  sendPdfFile,
  buildMapsLinks,
  buildReviewMessage,
  sendReviewRequest,
  sendApprovedDigest,
  sendDigestViaSheldon,
  buildDigestMessage,
  sendAlert,
};
