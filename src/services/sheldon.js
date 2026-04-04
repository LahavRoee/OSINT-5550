/**
 * Sheldon Agent Connection — sends digests via OpenClaw webhook
 * Sheldon is Roee's WhatsApp AI agent running on OpenClaw
 */

const fs = require('fs');
const config = require('../config');

const SHELDON_CONFIG = {
  // OpenClaw gateway on VPS (via Tailscale)
  gatewayUrl: process.env.SHELDON_GATEWAY_URL || 'http://100.87.1.27:18789',
  gatewayToken: process.env.SHELDON_GATEWAY_TOKEN || '',
  // Roee's WhatsApp number for DM
  targetNumber: process.env.ROEE_WHATSAPP || '972523818575',
};

const THREAT_EMOJI = {
  LOW: '\uD83D\uDFE2',
  MEDIUM: '\uD83D\uDFE1',
  HIGH: '\uD83D\uDD34',
  CRITICAL: '\u26A0\uFE0F',
};

function buildDigestMessage(data) {
  const emoji = THREAT_EMOJI[data.meta.threat_level] || '\u2753';
  const pagesUrl = `https://${config.github.username}.github.io/${config.github.repo}/${data.meta.version}/`;

  const takeaways = data.key_takeaways
    .map(t => `\u2022 ${t}`)
    .join('\n');

  return `\uD83D\uDDC2 *\u200F\u200Fתחקיר מודיעין — OSINT יל"ק 5550*
\uD83D\uDCC5 ${data.meta.version} | ${data.meta.date}
\uD83C\uDFAF רמת איום: ${emoji} ${data.meta.threat_level}

*\u200F\u200Fתמונת מצב:*
${data.situational_picture}

\uD83D\uDCCC *\u200F\u200Fעיקרי היום:*
${takeaways}

\uD83C\uDF10 ${pagesUrl}

*\u200F\u200Fיל"ק 5550 — יסוד האש | רס"ן רועי להב*
_מידע פתוח בלבד_`;
}

/**
 * Send a message to Roee via Sheldon's OpenClaw gateway
 */
async function sendViaSheldon(message) {
  if (!SHELDON_CONFIG.gatewayToken) {
    console.log('   \u26A0\uFE0F  Sheldon לא מוגדר (חסר SHELDON_GATEWAY_TOKEN)');
    console.log('   הודעה שהייתה נשלחת:');
    console.log('   ---');
    console.log(message);
    console.log('   ---');
    return false;
  }

  try {
    const res = await fetch(`${SHELDON_CONFIG.gatewayUrl}/api/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SHELDON_CONFIG.gatewayToken}`,
      },
      body: JSON.stringify({
        to: SHELDON_CONFIG.targetNumber,
        message: message,
      }),
    });

    const result = await res.json();
    if (res.ok) {
      console.log(`   \u2705 נשלח לרועי דרך שלדון`);
      return true;
    } else {
      console.error('   \u274C שגיאה בשליחה דרך שלדון:', result);
      return false;
    }
  } catch (err) {
    console.error('   \u274C שלדון לא זמין:', err.message);
    return false;
  }
}

/**
 * Send digest summary to Roee via Sheldon
 */
async function sendDigestViaSheldon(data) {
  const message = buildDigestMessage(data);
  return sendViaSheldon(message);
}

module.exports = { sendViaSheldon, sendDigestViaSheldon, buildDigestMessage };
