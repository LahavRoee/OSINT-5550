/**
 * Manual digest — uses a pre-generated synthesis JSON file
 * Usage: node scripts/run-digest-manual.js <path-to-synthesis.json>
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const db = require('../src/database');
const pdf = require('../src/services/pdf');
const builder = require('../src/services/sitebuilder');
const wa = require('../src/services/whatsapp');
const config = require('../src/config');

async function run() {
  const jsonFile = process.argv[2];
  if (!jsonFile || !fs.existsSync(jsonFile)) {
    console.error('Usage: node scripts/run-digest-manual.js <synthesis.json>');
    process.exit(1);
  }

  const synthesisData = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
  const version = synthesisData.meta.version;
  const today = synthesisData.meta.date.split('/').reverse().join('-'); // DD/MM/YYYY → YYYY-MM-DD

  console.log(`\n\uD83D\uDE80 מפיק תחקיר ${version} (ידני)...\n`);

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
  synthesisData.digestId = digestId;

  // PDF
  console.log('\uD83D\uDCC4 מייצר PDF...');
  const pdfPath = await pdf.generate(synthesisData, version);
  console.log(`   \u2192 ${pdfPath}`);

  // HTML
  console.log('\uD83C\uDF10 בונה דף אתר...');
  const docsPath = await builder.buildVersion(synthesisData, version);
  console.log(`   \u2192 ${docsPath}`);

  // Update digest
  await db.updateDigest(digestId, { pdf_path: pdfPath, docs_path: docsPath });

  // Mark updates as processed
  const updates = await db.getUnprocessed();
  if (updates.length > 0) {
    await db.markProcessed(updates.map(u => u.id), digestId);
  }

  // WhatsApp
  console.log('\uD83D\uDCF1 שולח לרועי בוואטסאפ...');
  await wa.sendPdfToCommander(pdfPath, synthesisData);

  console.log(`\n\u2705 הושלם!`);
  console.log(`   PDF: ${pdfPath}`);
  console.log(`   אתר: http://localhost:3000/${version}/`);
  console.log(`   גרסה: ${version}\n`);
}

run().catch(err => {
  console.error('\u274C שגיאה:', err.message);
  console.error(err.stack);
  process.exit(1);
});
