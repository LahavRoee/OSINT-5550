/**
 * WhatsApp Chat Export Parser for OSINT יל"ק 5550
 * Parses the exported _chat.txt and ingests structured OSINT reports
 */

const fs = require('fs');
const path = require('path');
const db = require('../src/database');
const { classifyActor, classifyDomain } = require('../src/services/ingest');

// WhatsApp message line pattern: [DD/MM/YYYY, HH:MM:SS] sender: content
const MSG_START = /^\[(\d{2}\/\d{2}\/\d{4}),\s(\d{2}:\d{2}:\d{2})\]\s(.+?):\s(.*)$/;

// OSINT report title pattern (bold with asterisks): *region / topic / ...*
const OSINT_TITLE = /^\*([^*]+)\*$/;

// Skip patterns
const SKIP_PATTERNS = [
  /^‎.*created group/,
  /^‎.*added you/,
  /^‎Messages and calls are end-to-end encrypted/,
  /^‎image omitted$/,
  /^‎video omitted$/,
  /^‎audio omitted$/,
  /^‎sticker omitted$/,
  /^‎document omitted$/,
  /^‎GIF omitted$/,
];

function parseWhatsAppExport(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');

  const messages = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(MSG_START);
    if (match) {
      if (current) messages.push(current);
      current = {
        date: match[1],      // DD/MM/YYYY
        time: match[2],      // HH:MM:SS
        sender: match[3],
        text: match[4],
      };
    } else if (current) {
      current.text += '\n' + line;
    }
  }
  if (current) messages.push(current);

  return messages;
}

function isSystemMessage(text) {
  return SKIP_PATTERNS.some(p => p.test(text.trim()));
}

function parseOsintReport(text) {
  const lines = text.split('\n');
  const report = {
    title: '',
    body: '',
    links: [],
    sources: '',
    timestamp: '',
    author: '',
    notes: '',
  };

  // Find title (first bold line)
  let titleLine = '';
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const titleMatch = trimmed.match(OSINT_TITLE);
    if (titleMatch && !trimmed.includes('האוסינט המטכ"לי') && !trimmed.includes('הערה')) {
      titleLine = titleMatch[1];
      bodyStart = i + 1;
      break;
    }
  }

  if (!titleLine) return null;
  report.title = titleLine.trim();

  // Parse body and metadata
  const bodyLines = [];
  let inNotes = false;

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip Arabic text blocks (lines that are primarily Arabic)
    if (/^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\s\d:،.!?؟\-*()]+$/.test(trimmed) && trimmed.length > 20) {
      continue;
    }

    // Skip Spanish text
    if (/^[A-Za-zÁÉÍÓÚáéíóúñÑ\s\d:,."!?¿¡\-@()]+$/.test(trimmed) && trimmed.length > 20 && /[áéíóúñ]/i.test(trimmed)) {
      continue;
    }

    // Links
    if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
      report.links.push(trimmed);
      continue;
    }

    if (trimmed.startsWith('קישורים:')) continue;

    // Sources
    if (trimmed.startsWith('מקורות:')) {
      report.sources = trimmed.replace('מקורות:', '').trim();
      continue;
    }

    // Timestamp
    if (trimmed.startsWith('תז"ק:')) {
      report.timestamp = trimmed.replace('תז"ק:', '').trim();
      continue;
    }

    // Author initials (2-3 chars with dots, standalone line)
    if (/^[א-ת]\.[א-ת]\.?$/.test(trimmed)) {
      report.author = trimmed;
      continue;
    }

    // Notes section
    if (trimmed === '*הערה:*') {
      inNotes = true;
      continue;
    }

    // End markers
    if (trimmed === '*האוסינט המטכ"לי*') continue;
    if (trimmed === '--------------------------------') {
      inNotes = false;
      continue;
    }

    // Skip empty lines
    if (!trimmed) continue;

    // Skip lines that are just bold markers
    if (trimmed === '*' || trimmed === '**') continue;

    if (inNotes) {
      report.notes += (report.notes ? ' ' : '') + trimmed.replace(/^\*|\*$/g, '');
    } else {
      bodyLines.push(trimmed.replace(/^\*|\*$/g, ''));
    }
  }

  report.body = bodyLines.join('\n');
  return report;
}

function parseReceivedAt(date, time) {
  // date: DD/MM/YYYY, time: HH:MM:SS
  const [day, month, year] = date.split('/');
  return `${year}-${month}-${day}T${time}`;
}

async function main() {
  const chatFile = process.argv[2] || '/tmp/wa-chat/_chat.txt';

  if (!fs.existsSync(chatFile)) {
    console.error(`❌ קובץ לא נמצא: ${chatFile}`);
    process.exit(1);
  }

  console.log(`📱 מפענח צ'אט WhatsApp: ${chatFile}\n`);

  // Clear existing test data
  const d = await db.getDb();
  d.run('DELETE FROM updates');
  db.save();
  console.log('🗑️  נוקה בסיס נתונים קיים\n');

  const messages = parseWhatsAppExport(chatFile);
  console.log(`📨 ${messages.length} הודעות נמצאו בצ'אט\n`);

  let ingested = 0;
  let skipped = 0;

  for (const msg of messages) {
    // Skip system messages
    if (isSystemMessage(msg.text)) {
      skipped++;
      continue;
    }

    // Skip empty or very short messages
    if (msg.text.trim().length < 20) {
      skipped++;
      continue;
    }

    // Try to parse as OSINT report
    const report = parseOsintReport(msg.text);

    if (report && report.body.length > 30) {
      // Structured OSINT report
      const fullText = [
        report.title,
        report.body,
        report.notes ? `הערה: ${report.notes}` : '',
        report.links.length ? `קישורים: ${report.links.join(', ')}` : '',
      ].filter(Boolean).join('\n\n');

      const actor = classifyActor(fullText);
      const domain = classifyDomain(fullText);

      const receivedAt = parseReceivedAt(msg.date, msg.time);

      // Insert directly with received_at
      const dd = await db.getDb();
      dd.run(
        `INSERT INTO updates (raw_text, source_number, source_name, actor, domain, received_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [fullText, null, msg.sender, actor, domain, receivedAt]
      );
      db.save();

      ingested++;
      const shortTitle = report.title.substring(0, 60);
      const shortSource = report.sources || '?';
      console.log(`  ✅ [${ingested}] ${actor || '?'} / ${domain} — ${shortTitle}...`);
      console.log(`     📡 ${shortSource} | ${report.timestamp || msg.date} | ${report.author || '?'}`);
    } else {
      skipped++;
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ הוכנסו: ${ingested} דיווחי OSINT`);
  console.log(`⏭️  דולגו: ${skipped} הודעות (מערכת/ריקות/לא-OSINT)`);

  // Show summary by actor
  const summary = d.exec(`
    SELECT actor, COUNT(*) as cnt FROM updates
    GROUP BY actor ORDER BY cnt DESC
  `);
  if (summary.length) {
    console.log(`\n📊 סיכום לפי שחקן:`);
    for (const row of summary[0].values) {
      console.log(`   ${row[0] || 'לא מסווג'}: ${row[1]}`);
    }
  }

  // Show summary by domain
  const domainSummary = d.exec(`
    SELECT domain, COUNT(*) as cnt FROM updates
    GROUP BY domain ORDER BY cnt DESC
  `);
  if (domainSummary.length) {
    console.log(`\n📊 סיכום לפי תחום:`);
    for (const row of domainSummary[0].values) {
      console.log(`   ${row[0] || 'לא מסווג'}: ${row[1]}`);
    }
  }
}

main().catch(err => {
  console.error('❌ שגיאה:', err.message);
  console.error(err.stack);
  process.exit(1);
});
