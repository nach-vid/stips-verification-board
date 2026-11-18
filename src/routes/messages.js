const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { extractSessionToken, findUserByToken } = require('../middleware/auth');

// ── Persistence Setup ──
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const DIRECT_FILE   = path.join(DATA_DIR, 'direct_messages.json');
const GROUPS_FILE   = path.join(DATA_DIR, 'groups.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(file, defaultVal = []) {
  try {
    ensureDataDir();
    if (!fs.existsSync(file)) return defaultVal;
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw) || defaultVal;
  } catch (e) {
    return defaultVal;
  }
}

function writeJSON(file, data) {
  try {
    ensureDataDir();
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

// ── In-Memory Online Heartbeat Store (clean & fast) ──
// userId -> { lastSeen: timestamp, username: string, profilePic: string }
const onlineUsers = new Map();

function cleanOnlineUsers() {
  const now = Date.now();
  for (const [userId, record] of onlineUsers.entries()) {
    if (now - record.lastSeen > 35000) { // 35 seconds timeout
      onlineUsers.delete(userId);
    }
  }
}

// ── Public Messages (Feed) ──
function getPublicMessages() {
  return readJSON(MESSAGES_FILE, []);
}

function addPublicMessage(msgData) {
  const msgs = getPublicMessages();
  const newMsg = { id: 'msg_' + Date.now(), ...msgData };
  msgs.push(newMsg);
  const trimmed = msgs.slice(-300);
  writeJSON(MESSAGES_FILE, trimmed);
  return newMsg;
}

// ── Direct Messages & Groups ──
// direct_messages: [ { id, fromId, toId, fromName, toName, profilePic, text, timestamp } ]
function getDirectMessages() {
  return readJSON(DIRECT_FILE, []);
}

function saveDirectMessage(msg) {
  const all = getDirectMessages();
  const newMsg = { id: 'dm_' + Date.now(), ...msg };
  all.push(newMsg);
  writeJSON(DIRECT_FILE, all.slice(-1000));
  return newMsg;
}

// groups: [ { id, name, creatorId, members: [userId], messages: [{ id, userId, username, profilePic, text, timestamp }] } ]
function getGroups() {
  return readJSON(GROUPS_FILE, []);
}

function saveGroups(groups) {
  writeJSON(GROUPS_FILE, groups);
}

// ── Helper: Authenticate ──
async function authUser(req) {
  const token = extractSessionToken(req) || req.body?.sessionToken || req.query?.sessionToken;
  let user = null;
  if (token) {
    user = await findUserByToken(token);
  }
  if (!user && req.body?.user?.id) {
    user = req.body.user;
  }
  return user;
}

// ══════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════

/**
 * POST /api/heartbeat – לעדכן נוכחות משתמש מקוון (Online Presence)
 */
router.post('/heartbeat', async (req, res) => {
  try {
    const user = await authUser(req);
    if (user && user.id) {
      onlineUsers.set(String(user.id), {
        lastSeen: Date.now(),
        username: user.username || user.id,
        profilePic: user.profilePic || ''
      });
    }
    cleanOnlineUsers();
    const onlineIds = Array.from(onlineUsers.keys());
    return res.json({ success: true, onlineUsers: onlineIds });
  } catch (err) {
    return res.json({ success: true, onlineUsers: [] });
  }
});

/**
 * GET /api/online-users – רשימת מזהי המשתמשים שמחוברים ברגע זה
 */
router.get('/online-users', (req, res) => {
  cleanOnlineUsers();
  return res.json({ success: true, onlineUsers: Array.from(onlineUsers.keys()) });
});

/**
 * GET /api/messages – שליפת כל ההודעות הציבוריות
 */
router.get('/messages', (req, res) => {
  try {
    cleanOnlineUsers();
    const messages = getPublicMessages();
    return res.json({
      success: true,
      messages,
      onlineUsers: Array.from(onlineUsers.keys())
    });
  } catch (error) {
    return res.status(500).json({ error: 'שגיאה בטעינת הודעות' });
  }
});

/**
 * POST /api/messages – שליחת הודעה ציבורית
 */
router.post('/messages', async (req, res) => {
  try {
    const { text, action } = req.body;
    if (action === 'fetch' || (!text && !req.body.username)) {
      return res.json({ success: true, messages: getPublicMessages() });
    }

    const verifiedUser = await authUser(req);
    if (!verifiedUser) {
      return res.status(401).json({ error: 'לא מחובר', expired: true });
    }

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'ההודעה לא יכולה להיות ריקה.' });
    }

    // רענון נוכחות
    onlineUsers.set(String(verifiedUser.id), {
      lastSeen: Date.now(),
      username: verifiedUser.username,
      profilePic: verifiedUser.profilePic
    });

    const newMsg = addPublicMessage({
      userId:     String(verifiedUser.id),
      username:   verifiedUser.username || verifiedUser.id || 'משתמש',
      profilePic: verifiedUser.profilePic || '',
      text:       text.trim(),
      timestamp:  new Date().toISOString()
    });

    cleanOnlineUsers();
    return res.status(201).json({
      success: true,
      messageId: newMsg.id,
      savedMessage: newMsg,
      messages: getPublicMessages(),
      onlineUsers: Array.from(onlineUsers.keys())
    });
  } catch (error) {
    return res.status(500).json({ error: 'שגיאת שרת', detail: error.message });
  }
});

// ══════════════════════════════════════════════
// צ'אט פרטי (Direct Messages) & אנשי קשר (Contacts)
// ══════════════════════════════════════════════

/**
 * GET /api/contacts – רשימת כל האנשים שדיברתי איתם (פרטי או קבוצה)
 */
router.get('/contacts', async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user || !user.id) {
      return res.status(401).json({ error: 'לא מחובר' });
    }

    const myId = String(user.id);
    const allDMs = getDirectMessages();
    const contactsMap = new Map(); // otherUserId -> contact info

    for (const dm of allDMs) {
      const fromId = String(dm.fromId);
      const toId   = String(dm.toId);

      if (fromId === myId) {
        contactsMap.set(toId, {
          id: toId,
          name: dm.toName || toId,
          profilePic: dm.toProfilePic || '',
          lastMessage: dm.text,
          lastTime: dm.timestamp
        });
      } else if (toId === myId) {
        contactsMap.set(fromId, {
          id: fromId,
          name: dm.fromName || fromId,
          profilePic: dm.profilePic || '',
          lastMessage: dm.text,
          lastTime: dm.timestamp
        });
      }
    }

    // קבוצות שהמשתמש שייך אליהן
    const allGroups = getGroups();
    const myGroups = allGroups.filter(g => (g.members || []).includes(myId) || g.creatorId === myId);

    cleanOnlineUsers();
    const contactsList = Array.from(contactsMap.values()).map(c => ({
      ...c,
      online: onlineUsers.has(String(c.id))
    }));

    return res.json({
      success: true,
      contacts: contactsList,
      groups: myGroups,
      onlineUsers: Array.from(onlineUsers.keys())
    });
  } catch (err) {
    return res.status(500).json({ error: 'שגיאה בטעינת אנשי קשר' });
  }
});

/**
 * GET /api/dm/:targetUserId – קריאת הודעות שיחה פרטית
 */
router.get('/dm/:targetUserId', async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user || !user.id) {
      return res.status(401).json({ error: 'לא מחובר' });
    }

    const myId = String(user.id);
    const targetId = String(req.params.targetUserId);

    const allDMs = getDirectMessages();
    const conversation = allDMs.filter(m =>
      (String(m.fromId) === myId && String(m.toId) === targetId) ||
      (String(m.fromId) === targetId && String(m.toId) === myId)
    );

    return res.json({
      success: true,
      conversation,
      targetOnline: onlineUsers.has(targetId)
    });
  } catch (err) {
    return res.status(500).json({ error: 'שגיאה בטעינת שיחה פרטית' });
  }
});

/**
 * POST /api/dm/:targetUserId – שליחת הודעה בשיחה פרטית
 */
router.post('/dm/:targetUserId', async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user || !user.id) {
      return res.status(401).json({ error: 'לא מחובר' });
    }

    const text = (req.body.text || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'הודעה ריקה' });
    }

    const myId = String(user.id);
    const targetId = String(req.params.targetUserId);
    const targetName = req.body.targetName || targetId;
    const targetPic = req.body.targetPic || '';

    const newDm = saveDirectMessage({
      fromId: myId,
      fromName: user.username || myId,
      profilePic: user.profilePic || '',
      toId: targetId,
      toName: targetName,
      toProfilePic: targetPic,
      text: text,
      timestamp: new Date().toISOString()
    });

    return res.status(201).json({ success: true, message: newDm });
  } catch (err) {
    return res.status(500).json({ error: 'שגיאה בשליחת הודעה פרטית' });
  }
});

// ══════════════════════════════════════════════
// צ'אט קבוצתי (Group Chat & Invite Link)
// ══════════════════════════════════════════════

/**
 * POST /api/groups – יצירת קבוצה חדשה (עם חברים או קישור)
 */
router.post('/groups', async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user || !user.id) {
      return res.status(401).json({ error: 'לא מחובר' });
    }

    const { name, memberIds } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'שם קבוצה נדרש' });
    }

    const myId = String(user.id);
    const membersSet = new Set([myId]);
    if (Array.isArray(memberIds)) {
      memberIds.forEach(id => membersSet.add(String(id)));
    }

    const groupId = 'grp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const newGroup = {
      id: groupId,
      name: name.trim(),
      creatorId: myId,
      creatorName: user.username || myId,
      members: Array.from(membersSet),
      createdAt: new Date().toISOString(),
      messages: []
    };

    const allGroups = getGroups();
    allGroups.push(newGroup);
    saveGroups(allGroups);

    return res.status(201).json({ success: true, group: newGroup });
  } catch (err) {
    return res.status(500).json({ error: 'שגיאה ביצירת קבוצה' });
  }
});

/**
 * GET /api/groups/:groupId – שליפת פרטי והודעות קבוצה (נגיש גם לאורחים לצפייה!)
 */
router.get('/groups/:groupId', (req, res) => {
  try {
    const { groupId } = req.params;
    const allGroups = getGroups();
    const group = allGroups.find(g => g.id === groupId);

    if (!group) {
      return res.status(404).json({ error: 'הקבוצה לא נמצאה' });
    }

    return res.json({ success: true, group });
  } catch (err) {
    return res.status(500).json({ error: 'שגיאה בטעינת קבוצה' });
  }
});

/**
 * POST /api/groups/:groupId/join – הצטרפות לקבוצה באמצעות קישור
 */
router.post('/groups/:groupId/join', async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user || !user.id) {
      return res.status(401).json({ error: 'יש להתחבר כדי להצטרף לקבוצה' });
    }

    const { groupId } = req.params;
    const allGroups = getGroups();
    const group = allGroups.find(g => g.id === groupId);

    if (!group) {
      return res.status(404).json({ error: 'הקבוצה לא נמצאה' });
    }

    const myId = String(user.id);
    if (!group.members.includes(myId)) {
      group.members.push(myId);
      saveGroups(allGroups);
    }

    return res.json({ success: true, group });
  } catch (err) {
    return res.status(500).json({ error: 'שגיאה בהצטרפות' });
  }
});

/**
 * POST /api/groups/:groupId/messages – שליחת הודעה בקבוצה
 */
router.post('/groups/:groupId/messages', async (req, res) => {
  try {
    const user = await authUser(req);
    if (!user || !user.id) {
      return res.status(401).json({ error: 'לא מחובר', expired: true });
    }

    const { groupId } = req.params;
    const text = (req.body.text || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'הודעה ריקה' });
    }

    const allGroups = getGroups();
    const group = allGroups.find(g => g.id === groupId);

    if (!group) {
      return res.status(404).json({ error: 'קבוצה לא קיימת' });
    }

    const myId = String(user.id);
    if (!group.members.includes(myId)) {
      group.members.push(myId);
    }

    const newMsg = {
      id: 'grp_msg_' + Date.now(),
      senderId: myId,
      userId: myId,
      senderUsername: user.username || myId,
      username: user.username || myId,
      senderAvatar: user.profilePic || '',
      avatar: user.profilePic || '',
      text: text,
      createdAt: new Date().toISOString(),
      timestamp: new Date().toISOString()
    };

    if (!group.messages) group.messages = [];
    group.messages.push(newMsg);
    saveGroups(allGroups);

    return res.status(201).json({ success: true, message: newMsg, group });
  } catch (err) {
    return res.status(500).json({ error: 'שגיאה בשליחת הודעה לקבוצה' });
  }
});

module.exports = router;
