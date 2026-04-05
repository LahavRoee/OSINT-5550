/**
 * ingest-webhook.js — HTTP server for Sheldon to push WhatsApp messages into the DB
 *
 * Sheldon is configured to forward messages from "דיווחי OSINT - דביר ורועי 🫡"
 * to POST http://localhost:8099/ingest
 *
 * Start: node src/server/ingest-webhook.js
 * Or via systemd: see scripts/setup-vps.sh
 */

const http = require('http');
const db = require('../database');
const { classifyUpdate } = require('../services/ingest');
const config = require('../config');

const PORT = process.env.WEBHOOK_PORT || 8099;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

// Source group name — only process messages from this group
const OSINT_GROUP_NAME = 'דיווחי OSINT - דביר ורועי 🫡';

// Keywords that trigger digest approval
const APPROVE_KEYWORDS = ['אשר', 'approve', '✅', 'approved', 'אישור', 'ok', 'אוקיי'];
const REJECT_KEYWORDS  = ['בטל', 'reject', '❌', 'cancel', 'ביטול', 'דחה'];

function isApproval(text) {
  const t = text.trim().toLowerCase();
  return APPROVE_KEYWORDS.some(kw => t === kw.toLowerCase() || t.startsWith(kw.toLowerCase()));
}
function isRejection(text) {
  const t = text.trim().toLowerCase();
  return REJECT_KEYWORDS.some(kw => t === kw.toLowerCase() || t.startsWith(kw.toLowerCase()));
}

// Authorized approvers — Roee and Dvir's numbers
function isAuthorizedApprover(senderNumber) {
  const authorized = [
    config.sheldon.roeeNumber,
    config.sheldon.dvirNumber,
  ].filter(Boolean).map(n => n.replace(/\D/g, ''));
  const sender = (senderNumber || '').replace(/\D/g, '');
  return authorized.some(n => sender.endsWith(n) || n.endsWith(sender));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  // Only handle POST /ingest
  if (req.method !== 'POST' || req.url !== '/ingest') {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  // Optional secret token auth
  if (WEBHOOK_SECRET) {
    const auth = req.headers['x-webhook-secret'] || req.headers['authorization']?.replace('Bearer ', '');
    if (auth !== WEBHOOK_SECRET) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }
  }

  try {
    const body = await parseBody(req);

    /*
     * Expected payload from Sheldon/OpenClaw:
     * {
     *   "group":   "דיווחי OSINT - דביר ורועי 🫡",
     *   "sender":  "972501234567",
     *   "name":    "דביר",
     *   "message": "**כותרת הדיווח**\nגוף הדיווח...",
     *   "timestamp": "2026-04-04T11:32:00Z"   (optional)
     * }
     */
    const { group, sender, name, message } = body;

    if (!message || typeof message !== 'string') {
      sendJson(res, 400, { error: 'Missing message field' });
      return;
    }

    // Safety: only accept from the OSINT group
    if (group && group !== OSINT_GROUP_NAME) {
      console.log(`[webhook] Ignored message from group: "${group}"`);
      sendJson(res, 200, { status: 'ignored', reason: 'wrong group' });
      return;
    }

    // Skip very short messages (system notifications, stickers, etc.)
    if (message.trim().length < 20) {
      // BUT first check if it's an approval/rejection keyword (these are intentionally short)
      if (isApproval(message) && isAuthorizedApprover(sender)) {
        // Handle approval
        const pending = await db.getPendingReview();
        if (pending) {
          console.log(`[webhook] ✅ APPROVAL received from ${name || sender} — sending digest ${pending.version}`);
          await db.clearPendingReview();
          // Trigger PDF send asynchronously
          setImmediate(async () => {
            try {
              const sheldon = require('../services/sheldon');
              await sheldon.sendApprovedDigest(pending);
            } catch (e) {
              console.error('[webhook] Failed to send approved digest:', e.message);
            }
          });
          sendJson(res, 200, { status: 'approved', version: pending.version });
        } else {
          console.log(`[webhook] ℹ️  Approval received but no pending review found`);
          sendJson(res, 200, { status: 'no_pending' });
        }
        return;
      }

      if (isRejection(message) && isAuthorizedApprover(sender)) {
        const pending = await db.getPendingReview();
        if (pending) {
          console.log(`[webhook] ❌ REJECTION received from ${name || sender} — cancelling digest ${pending.version}`);
          await db.clearPendingReview();
          const sheldon = require('../services/sheldon');
          await sheldon.sendViaSheldon(
            `❌ *תחקיר ${pending.version} בוטל*\nהתחקיר לא נשלח לקבוצה.\nניתן להפיק מחדש באופן ידני.`,
            sender
          );
        }
        sendJson(res, 200, { status: 'rejected' });
        return;
      }

      sendJson(res, 200, { status: 'ignored', reason: 'too short' });
      return;
    }

    // Classify actor + domain using keyword analysis
    const classification = classifyUpdate(message);

    const id = await db.insertUpdate({
      rawText: message,
      sourceNumber: sender || null,
      sourceName: name || null,
      actor: classification.actor,
      domain: classification.domain,
    });

    // id === null means duplicate
    if (id === null) {
      console.log(`[webhook] ⚠️  Duplicate message ignored from ${name || sender || 'unknown'}`);
      sendJson(res, 200, { status: 'duplicate' });
      return;
    }

    console.log(`[webhook] ✅ Saved update #${id} (${classification.actor}/${classification.domain}) from ${name || sender || 'unknown'}`);
    sendJson(res, 200, { status: 'ok', id, actor: classification.actor, domain: classification.domain });

  } catch (err) {
    console.error('[webhook] ❌ Error:', err.message);
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🎯 OSINT Ingest Webhook listening on http://127.0.0.1:${PORT}/ingest`);
  console.log(`   Group filter: "${OSINT_GROUP_NAME}"`);
  console.log(`   Auth: ${WEBHOOK_SECRET ? 'enabled' : 'disabled (set WEBHOOK_SECRET to enable)'}`);
});

server.on('error', err => {
  console.error('Server error:', err.message);
  process.exit(1);
});
