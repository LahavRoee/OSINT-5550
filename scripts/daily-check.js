/**
 * daily-check.js — Safety-wrapped daily digest runner
 *
 * Safety rules:
 *   1. Only processes messages received TODAY (Israel time)
 *   2. If no messages today → skips silently on Saturday, sends WhatsApp alert on other days
 *   3. After successful digest → auto git-commits docs/ and pushes to GitHub
 *
 * Run via cron on VPS: 0 14 * * * cd /opt/OSINT-5550 && node scripts/daily-check.js
 */

const { execSync } = require('child_process');
const path = require('path');
const db = require('../src/database');
const pdf = require('../src/services/pdf');
const builder = require('../src/services/sitebuilder');
const sheldon = require('../src/services/sheldon');
const digest = require('../src/services/digest');
const { sendAlert } = require('../src/services/sheldon');
const napkin = require('../src/services/napkin');
const { getDisplayDateString } = require('../src/utils/hebrew-date');

// ─── Israel timezone helpers ──────────────────────────────────────────────────

function getIsraelDate() {
  const now = new Date();
  // Use Intl to get the wall-clock time in Jerusalem
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const dateStr = formatter.format(now); // YYYY-MM-DD (en-CA locale gives ISO format)

  const dayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    weekday: 'long',
  });
  const dayName = dayFormatter.format(now);

  const [year, month, day] = dateStr.split('-').map(Number);

  return {
    iso: dateStr,                          // YYYY-MM-DD
    display: getDisplayDateString(dateStr), // DD-MONTH-YYYY
    version: `v${dateStr.replace(/-/g, '.')}`, // vYYYY.MM.DD
    ddmmyyyy: `${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}/${year}`,
    isSaturday: dayName === 'Saturday',
    dayName,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const today = getIsraelDate();

  console.log(`\n🕒 בדיקה יומית OSINT — ${today.display} (${today.dayName})`);
  console.log(`   תאריך ISO: ${today.iso}`);

  // 1. Fetch TODAY's messages only
  const todayUpdates = await db.getUpdatesForDate(today.iso);
  console.log(`   📥 הודעות שהתקבלו היום: ${todayUpdates.length}`);

  // 2. Safety gate — no messages
  if (todayUpdates.length === 0) {
    if (today.isSaturday) {
      console.log('   ✅ יום שבת — לא מפיקים תחקיר. שלום שבת!');
      process.exit(0);
    }

    // Weekday with no data — alert Roee
    console.log('   ⚠️  אין נתונים להיום — שולח התראה לרועי...');
    await sendAlert(
      `⚠️ *OSINT יל"ק 5550 — התראה*\n\n` +
      `לא התקבלו דיווחי OSINT היום (${today.display}).\n` +
      `התחקיר היומי *לא יופק* עד קבלת נתונים.\n\n` +
      `אנא בדוק את הקבוצה ואת חיבור שלדון.`
    );
    console.log('   📱 התראה נשלחה. יוצא ללא הפקת תחקיר.');
    process.exit(0);
  }

  // 3. We have data — run the full digest pipeline
  console.log(`\n🚀 מפיק תחקיר ${today.version} עם ${todayUpdates.length} דיווחים...`);

  try {
    // Run Claude synthesis on today's updates only
    const synthesisData = await digest.runSynthesis({
      updates: todayUpdates,
      version: today.version,
      date: today.ddmmyyyy,
    });

    // Save to DB
    const digestId = await db.createDigest({
      version: today.version,
      date: today.iso,
      threatLevel: synthesisData.meta.threat_level,
      headline: synthesisData.situational_picture,
      newCount: synthesisData.meta.new_items,
      historicalCount: synthesisData.meta.historical_items || 0,
      synthesisJson: synthesisData,
    });
    synthesisData.digestId = digestId;

    // PDF
    console.log('📄 מייצר PDF...');
    const pdfPath = await pdf.generate(synthesisData, today.version);
    console.log(`   → ${pdfPath}`);

    // HTML site
    console.log('🌐 בונה דף אתר...');
    const docsPath = await builder.buildVersion(synthesisData, today.version);
    console.log(`   → ${docsPath}`);

    // Update DB record with paths
    await db.updateDigest(digestId, { pdf_path: pdfPath, docs_path: docsPath });

    // Mark today's updates as processed
    await db.markProcessed(todayUpdates.map(u => u.id), digestId);

    // Save to napkin intel vault (non-blocking)
    console.log('📚 שומר בnapkin intel vault...');
    await napkin.saveDigest(synthesisData);

    // 4. Auto-push to GitHub Pages
    console.log('📤 דוחף לGitHub Pages...');
    pushToGitHub(today.version, today.display);

    // 5. Send REVIEW REQUEST to group — wait for "אשר" before sending PDF
    console.log('📱 שולח בקשת סקירה לקבוצה דרך שלדון...');
    await sheldon.sendReviewRequest(synthesisData, pdfPath);

    console.log(`\n✅ תחקיר ${today.version} הופק ונשלח לסקירה!`);
    console.log(`   PDF: ${pdfPath}`);
    console.log(`   אתר: https://${process.env.GITHUB_USERNAME || 'LahavRoee'}.github.io/OSINT-5550/${today.version}/`);

  } catch (err) {
    console.error('❌ שגיאה בהפקת התחקיר:', err.message);

    // Alert Roee on failure
    await sendAlert(
      `🚨 *OSINT יל"ק 5550 — שגיאה בהפקה*\n\n` +
      `תחקיר ${today.version} נכשל בהפקה.\n` +
      `שגיאה: ${err.message}\n\n` +
      `נדרשת בדיקה ידנית.`
    );
    process.exit(1);
  }
}

// ─── Git push helper ──────────────────────────────────────────────────────────

function pushToGitHub(version, displayDate) {
  try {
    const root = path.join(__dirname, '..');
    execSync('git add docs/', { cwd: root, stdio: 'pipe' });

    // Check if there's anything to commit
    try {
      execSync('git diff --cached --exit-code', { cwd: root, stdio: 'pipe' });
      console.log('   ℹ️  אין שינויים חדשים ל-commit');
    } catch {
      // There are staged changes — commit and push
      execSync(
        `git commit -m "auto: digest ${version} — ${displayDate}"`,
        { cwd: root, stdio: 'pipe' }
      );
      execSync('git push', { cwd: root, stdio: 'pipe' });
      console.log('   ✅ נדחף ל-GitHub Pages');
    }
  } catch (err) {
    console.error('   ⚠️  Git push נכשל:', err.message);
    // Non-fatal — digest was still generated
  }
}

run().catch(err => {
  console.error('❌ קריסה:', err.message);
  process.exit(1);
});
