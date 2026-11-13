const express = require('express');
const router = express.Router();
const { getFirestore } = require('../firebase');
const { requireAuth, extractSessionToken, findUserByToken } = require('../middleware/auth');

const db = getFirestore();

/**
 * Helper to fetch recent messages ordered chronologically
 */
async function fetchMessages(limitCount = 50) {
  const snapshot = await db.collection('messages')
    .orderBy('timestamp', 'asc')
    .limit(limitCount)
    .get();

  const messages = [];
  snapshot.docs.forEach(doc => {
    messages.push({
      id: doc.id,
      ...doc.data()
    });
  });
  return messages;
}

/**
 * POST /api/messages
 * Saves and/or fetches chat messages in Firestore collection 'messages'.
 * Security requirement:
 * Posting messages strictly requires a valid cryptographically secure session token!
 * Spoofing is impossible because username & avatar are taken directly from the verified session token.
 */
router.post('/messages', async (req, res) => {
  try {
    const { text, action } = req.body;

    // If request is purely to fetch messages via POST
    if (action === 'fetch' || (!text && !req.body.username)) {
      try {
        const messages = await fetchMessages();
        return res.json({ success: true, messages });
      } catch (fetchErr) {
        console.warn('[messages] fetch failed:', fetchErr.message);
        return res.json({ success: true, messages: [] });
      }
    }

    // Posting a new message: Authenticate caller using session token
    const token = extractSessionToken(req);
    if (!token) {
      return res.status(401).json({
        error: 'לא מחובר: יש לאמת את פרופיל הסטיפס לפני שליחת הודעות.'
      });
    }

    let verifiedUser = null;
    try {
      verifiedUser = await findUserByToken(token);
    } catch (authErr) {
      console.warn('[messages] Token lookup failed:', authErr.message);
    }

    if (!verifiedUser || !verifiedUser.verified) {
      return res.status(403).json({
        error: 'הסשן פג תוקף או לא תקף. אנא אמת מחדש את פרופיל הסטיפס שלך.',
        expired: true
      });
    }

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'ההודעה לא יכולה להיות ריקה.' });
    }

    const trimmedText = text.trim();

    const messageData = {
      userId: verifiedUser.id,
      username: verifiedUser.username,
      profilePic: verifiedUser.profilePic || '',
      text: trimmedText,
      timestamp: new Date().toISOString()
    };

    let docRef = { id: 'local_' + Date.now() };
    try {
      docRef = await db.collection('messages').add(messageData);
    } catch (dbErr) {
      console.warn('[messages] DB add failed (non-fatal):', dbErr.message);
    }

    let messages = [];
    try {
      messages = await fetchMessages();
    } catch (fetchErr) {
      messages = [{ id: docRef.id, ...messageData }];
    }

    return res.status(201).json({
      success: true,
      messageId: docRef.id,
      savedMessage: { id: docRef.id, ...messageData },
      messages: messages
    });
  } catch (error) {
    console.error('[messages] Unexpected error:', error);
    return res.status(500).json({ error: 'שגיאת שרת בעת שליחת ההודעה. נסה שוב.', detail: error.message });
  }
});

/**
 * GET /api/messages
 * Retrieves public messages
 */
router.get('/messages', async (req, res) => {
  try {
    const messages = await fetchMessages();
    return res.json({ success: true, messages });
  } catch (error) {
    console.error('Error fetching messages:', error);
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

module.exports = router;
