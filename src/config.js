const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

module.exports = {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-20250514',
  },
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    roeeNumber: process.env.ROEE_WHATSAPP,
  },
  github: {
    username: process.env.GITHUB_USERNAME || 'LahavRoee',
    repo: process.env.GITHUB_REPO || 'OSINT-5550',
  },
  paths: {
    root: path.join(__dirname, '..'),
    data: path.join(__dirname, '..', 'data'),
    db: path.join(__dirname, '..', 'data', 'osint.db'),
    digests: path.join(__dirname, '..', 'digests'),
    docs: path.join(__dirname, '..', 'docs'),
    templates: path.join(__dirname, 'templates'),
  },
  historicalDays: parseInt(process.env.HISTORICAL_DAYS || '30', 10),
};
