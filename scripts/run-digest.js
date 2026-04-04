const path = require('path');
const { execSync } = require('child_process');
const db = require('../src/database');
const digest = require('../src/services/digest');
const pdf = require('../src/services/pdf');
const builder = require('../src/services/sitebuilder');
const wa = require('../src/services/whatsapp');
const config = require('../src/config');

async function run() {
  const today = new Date().toISOString().split('T')[0]; // 2026-04-03
  const version = 'v' + today.replace(/-/g, '.');       // v2026.04.03

  console.log(`\n\uD83D\uDE80 מפיק תחקיר ${version}...\n`);

  // 1. Fetch data
  const newUpdates = await db.getUnprocessed();
  const historical = await db.getPersistentIntel({ days: config.historicalDays });

  if (newUpdates.length === 0) {
    console.log('\u26A0\uFE0F  אין עדכונים חדשים. יוצא.');
    process.exit(0);
  }

  console.log(`\uD83D\uDCE5 ${newUpdates.length} עדכונים חדשים, ${historical.length} היסטוריים`);

  // 2. Claude synthesis
  console.log('\uD83E\uDD16 מעבד עם Claude...');
  const synthesisData = await digest.synthesize({ newUpdates, historical, version, today });
  console.log(`   רמת איום: ${synthesisData.meta.threat_level}`);

  // 3. PDF
  console.log('\uD83D\uDCC4 מייצר PDF...');
  const pdfPath = await pdf.generate(synthesisData, version);
  console.log(`   \u2192 ${pdfPath}`);

  // 4. HTML for GitHub Pages
  console.log('\uD83C\uDF10 בונה דף אתר...');
  const docsPath = await builder.buildVersion(synthesisData, version);
  console.log(`   \u2192 ${docsPath}`);

  // 5. Update digest record
  await db.updateDigest(synthesisData.digestId, {
    pdf_path: pdfPath,
    docs_path: docsPath,
  });

  // 6. Push to GitHub
  console.log('\u2B06\uFE0F  דוחף לגיטהאב...');
  try {
    execSync(`git add docs/ && git commit -m "digest: ${version}" && git push`, {
      cwd: config.paths.root,
      stdio: 'inherit',
    });
    await db.updateDigest(synthesisData.digestId, { pushed_to_github: 1 });
  } catch (err) {
    console.log('   \u26A0\uFE0F  דחיפה לגיטהאב נכשלה (ייתכן שצריך להגדיר remote)');
  }

  // 7. Send PDF to Roee
  console.log('\uD83D\uDCF1 שולח לרועי בוואטסאפ...');
  const sent = await wa.sendPdfToCommander(pdfPath, synthesisData);
  if (sent) {
    await db.updateDigest(synthesisData.digestId, { sent_to_roee: 1 });
  }

  // 8. Mark updates as processed
  await db.markProcessed(newUpdates.map(u => u.id), synthesisData.digestId);

  console.log(`\n\u2705 הושלם!`);
  console.log(`   PDF: ${pdfPath}`);
  console.log(`   אתר: https://${config.github.username}.github.io/${config.github.repo}/`);
  console.log(`   גרסה: ${version}\n`);
}

run().catch(err => {
  console.error('\u274C שגיאה:', err.message);
  process.exit(1);
});
