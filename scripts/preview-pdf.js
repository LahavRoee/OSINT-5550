/**
 * PDF preview — uses pdf.js renderHtml() directly, screenshots sections
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const pdf = require('../src/services/pdf');

const synthesisPath = path.join(__dirname, '..', 'data', 'synthesis-v2026.04.03.json');
const synthesis = JSON.parse(fs.readFileSync(synthesisPath, 'utf-8'));

(async () => {
  // Use the actual renderHtml function
  const html = pdf.renderHtml(synthesis);

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 794, height: 6000 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));

  const fullHeight = await page.evaluate(() => document.body.scrollHeight);
  console.log('Full page height:', fullHeight);

  // Cover + credit
  await page.screenshot({ path: path.join(__dirname, '..', 'pdf_cover.png'),
    clip: { x: 0, y: 0, width: 794, height: 430 } });
  console.log('Cover saved');

  // Summary table (right after cover)
  await page.screenshot({ path: path.join(__dirname, '..', 'pdf_summary.png'),
    clip: { x: 0, y: 430, width: 794, height: 300 } });
  console.log('Summary saved');

  // First items
  await page.screenshot({ path: path.join(__dirname, '..', 'pdf_items1.png'),
    clip: { x: 0, y: 730, width: 794, height: 800 } });
  console.log('Items 1 saved');

  await browser.close();
})().catch(e => console.error('Error:', e.message, e.stack));
