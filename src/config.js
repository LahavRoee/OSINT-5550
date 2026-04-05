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
  sheldon: {
    gatewayUrl:   process.env.SHELDON_GATEWAY_URL   || 'http://100.87.1.27:18789',
    gatewayToken: process.env.SHELDON_GATEWAY_TOKEN || '',
    roeeNumber:   process.env.ROEE_WHATSAPP         || '972523818575',
    dvirNumber:   process.env.DVIR_WHATSAPP         || '',
    // WhatsApp group JID for "דיווחי OSINT - דביר ורועי 🫡"
    // Format: 972XXXXXXXXX-XXXXXXXXXX@g.us  (get from OpenClaw logs)
    osintGroupJid: process.env.OSINT_GROUP_JID      || '',
    // How many minutes to wait for approval before expiring
    reviewTimeoutMinutes: parseInt(process.env.REVIEW_TIMEOUT_MINUTES || '120', 10),
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
