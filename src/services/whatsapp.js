const fs = require('fs');
const path = require('path');
const config = require('../config');

const THREAT_EMOJI = {
  LOW: '\uD83D\uDFE2',
  MEDIUM: '\uD83D\uDFE1',
  HIGH: '\uD83D\uDD34',
  CRITICAL: '\u26A0\uFE0F',
};

function buildMessage(data) {
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

\uD83D\uDCCE PDF מצורף
\uD83C\uDF10 ${pagesUrl}

*\u200F\u200Fיל"ק 5550 — יסוד האש | רס"ן רועי להב*
_מידע פתוח בלבד_`;
}

async function sendPdfToCommander(pdfPath, data) {
  const token = config.whatsapp.token;
  const phoneNumberId = config.whatsapp.phoneNumberId;
  const roeeNumber = config.whatsapp.roeeNumber;

  if (!token || !phoneNumberId || !roeeNumber) {
    console.log('   \u26A0\uFE0F  WhatsApp לא מוגדר — מדלג על שליחה');
    console.log('   הודעה שהייתה נשלחת:');
    console.log('   ---');
    console.log(buildMessage(data));
    console.log('   ---');
    return false;
  }

  const baseUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}`;

  // Step 1: Upload PDF as media
  const formData = new FormData();
  const pdfBuffer = fs.readFileSync(pdfPath);
  const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' });
  formData.append('file', pdfBlob, path.basename(pdfPath));
  formData.append('messaging_product', 'whatsapp');
  formData.append('type', 'application/pdf');

  const uploadRes = await fetch(`${baseUrl}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  const uploadData = await uploadRes.json();
  const mediaId = uploadData.id;

  if (!mediaId) {
    console.error('   \u274C שגיאה בהעלאת PDF:', uploadData);
    return false;
  }

  // Step 2: Send document message with caption
  const message = buildMessage(data);

  const sendRes = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: roeeNumber,
      type: 'document',
      document: {
        id: mediaId,
        filename: `OSINT-5550-${data.meta.version}.pdf`,
        caption: message,
      },
    }),
  });

  const sendData = await sendRes.json();

  if (sendData.messages && sendData.messages[0]) {
    console.log(`   \u2705 נשלח לרועי (${roeeNumber})`);
    return true;
  } else {
    console.error('   \u274C שגיאה בשליחה:', sendData);
    return false;
  }
}

module.exports = { sendPdfToCommander, buildMessage };
