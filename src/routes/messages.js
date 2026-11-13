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
      const messages = await fetchMessages();
      return res.json({ success: true, messages });
    }

    // Posting a new message: Authenticate caller using session token
    const token = extractSessionToken(req);
    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized: You must be verified with a valid session token to post messages.'
      });
    }

    const verifiedUser = await findUserByToken(token);
    if (!verifiedUser || !verifiedUser.verified) {
      return res.status(403).json({
        error: 'Forbidden: Invalid or expired session token. Please re-verify your Stips account.'
      });
    }

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Message text cannot be empty' });
    }

    const trimmedText = text.trim();

    // The user identity is bound to the verified session in Firestore (prevents user spoofing)
    const messageData = {
      userId: verifiedUser.id,
      username: verifiedUser.username,
      profilePic: verifiedUser.profilePic || '',
      text: trimmedText,
      timestamp: new Date().toISOString()
    };

    const docRef = await db.collection('messages').add(messageData);
    const messages = await fetchMessages();

    return res.status(201).json({
      success: true,
      messageId: docRef.id,
      savedMessage: { id: docRef.id, ...messageData },
      messages: messages
    });
  } catch (error) {
    console.error('Error handling /api/messages POST:', error);
    return res.status(500).json({ error: 'Failed to process message request' });
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
