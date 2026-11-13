const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { extractSessionToken, findUserByToken } = require('../middleware/auth');

// ── File-based persistence (survives Render restarts) ──────────────────────
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'messages.json');

function ensureDataDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readMessages() {
  try {
    ensureDataDir();
    if (!fs.existsSync(DATA_FILE)) return [];
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw) || [];
  } catch (e) {
    console.warn('[messages] readMessages error:', e.message);
    return [];
  }
}

function writeMessages(msgs) {
  try {
    ensureDataDir();
    fs.writeFileSync(DATA_FILE, JSON.stringify(msgs, null, 2), 'utf8');
  } catch (e) {
    console.warn('[messages] writeMessages error:', e.message);
  }
}

function addMessage(msgData) {
  const msgs = readMessages();
  const newMsg = { id: 'msg_' + Date.now(), ...msgData };
  msgs.push(newMsg);
  // שמור רק 200 הודעות אחרונות
  const trimmed = msgs.slice(-200);
  writeMessages(trimmed);
  return newMsg;
}

// ── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /api/messages – שליפת כל ההודעות
 */
router.get('/messages', (req, res) => {
  try {
    const messages = readMessages();
    return res.json({ success: true, messages });
  } catch (error) {
    console.error('[messages] GET error:', error);
    return res.status(500).json({ error: 'שגיאה בטעינת הודעות' });
  }
});

/**
 * POST /api/messages – שליחת הודעה חדשה
 */
router.post('/messages', async (req, res) => {
  try {
    const { text, action } = req.body;

    // fetch בלבד
    if (action === 'fetch' || (!text && !req.body.username)) {
      return res.json({ success: true, messages: readMessages() });
    }

    // אימות טוקן
    const token = extractSessionToken(req);
    if (!token) {
      return res.status(401).json({ error: 'לא מחובר', expired: true });
    }

    const verifiedUser = await findUserByToken(token);
    if (!verifiedUser || !verifiedUser.verified) {
      return res.status(403).json({ error: 'הסשן לא תקף. אנא אמת מחדש.', expired: true });
    }

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'ההודעה לא יכולה להיות ריקה.' });
    }

    const newMsg = addMessage({
      userId:     verifiedUser.id,
      username:   verifiedUser.username,
      profilePic: verifiedUser.profilePic || '',
      text:       text.trim(),
      timestamp:  new Date().toISOString()
    });

    return res.status(201).json({
      success:     true,
      messageId:   newMsg.id,
      savedMessage: newMsg,
      messages:    readMessages()
    });

  } catch (error) {
    console.error('[messages] POST error:', error);
    return res.status(500).json({ error: 'שגיאת שרת', detail: error.message });
  }
});

module.exports = router;
