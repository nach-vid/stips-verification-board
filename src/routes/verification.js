const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const { getFirestore } = require('../firebase');
const {
  extractSessionToken,
  findUserByToken,
  createSessionToken
} = require('../middleware/auth');

const db = getFirestore();

// קודי אימות בעברית - פשוטים ויפים
const ADJECTIVES = ['ירח', 'כוכב', 'שמש', 'ברק', 'ים', 'אור', 'ענן', 'רוח', 'אש', 'לב'];
const NOUNS = ['כחול', 'ירוק', 'אדום', 'זהוב', 'סגול', 'לבן', 'שחור', 'כתום', 'ורוד', 'אפור'];

function generateCode() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const b = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const n = Math.floor(100 + Math.random() * 900);
  return `${a}-${b}-${n}`;
}

// זיכרון זמני לקודים פעילים (session ID → { code, createdAt })
// בסביבת production, זה נשמר גם ב-DB אבל מחזיקים גם בזיכרון לביצועים
const activeCodes = new Map(); // code → { createdAt, used }

/**
 * POST /api/request-verification
 * מחזיר קוד חדש למשתמש - ללא צורך ב-ID
 * המשתמש ישלח את הקוד בקיר של נאצ ב-stips
 */
router.post('/request-verification', async (req, res) => {
  try {
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 דקות

    // שמירת הקוד בזיכרון
    activeCodes.set(code, { createdAt: new Date().toISOString(), used: false });

    // שמירת הקוד ב-DB (non-fatal)
    try {
      await db.collection('pending_codes').doc(code).set({
        code,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        used: false
      });
    } catch (dbErr) {
      console.warn('[request-verification] DB write failed (non-fatal):', dbErr.message);
    }

    return res.json({
      success: true,
      verificationCode: code,
      expiresIn: '15 דקות',
      instructions: `שלח את הקוד "${code}" בקיר התודות של נאצ ב-stips.co.il/profile/428498`
    });
  } catch (error) {
    console.error('[request-verification] Error:', error);
    return res.status(500).json({ error: 'שגיאה ביצירת קוד אימות' });
  }
});

/**
 * POST /api/verify-stips
 * בודק האם הקוד נמצא בקיר התודות של נאצ (428498)
 * אם כן - מחבר את המשתמש לפי הפרופיל ששלח את ההודעה
 */
router.post('/verify-stips', async (req, res) => {
  try {
    const { verificationCode } = req.body;

    if (!verificationCode || typeof verificationCode !== 'string') {
      return res.status(400).json({ success: false, error: 'חסר קוד אימות' });
    }

    const code = verificationCode.trim();

    // בדיקה שהקוד לא שומש כבר
    if (activeCodes.has(code) && activeCodes.get(code).used) {
      return res.status(400).json({ success: false, error: 'קוד זה כבר שומש. בקש קוד חדש.' });
    }

    console.log(`[verify-stips] מחפש קוד "${code}" בקיר של נאצ...`);

    let codeFound = false;
    let senderUserId = '';
    let senderUsername = '';
    let senderAvatar = '';

    // --- בדיקת קיר התודות של נאצ (428498) ---
    try {
      // בודקים עמוד 1 ו-2 כדי לתפוס הודעות חדשות
      for (let page = 1; page <= 2 && !codeFound; page++) {
        const wallApiParams = JSON.stringify({ page, objType: 'thanksmsg', userid: 428498 });
        const wallUrl = `https://stips.co.il/api?name=objectlist&rest_action=GET&api_params=${encodeURIComponent(wallApiParams)}`;
        
        const wallRes = await axios.get(wallUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
          },
          timeout: 12000
        }).catch(err => {
          console.warn(`[verify-stips] wall API page ${page} error:`, err.message);
          return null;
        });

        if (wallRes && wallRes.data && Array.isArray(wallRes.data.data)) {
          for (const item of wallRes.data.data) {
            const msgText = String(item.data?.msg || item.data?.text || '');
            const authorProfile = item.extra?.item_profile || item.extra?.from_profile || {};
            const fromUserId = String(item.data?.fromuserid || authorProfile.userid || '');

            if (msgText.includes(code)) {
              codeFound = true;
              senderUserId = fromUserId || String(authorProfile.userid || '');
              senderUsername = authorProfile.nickname || authorProfile.name || 'משתמש סטיפס';
              
              // בניית URL לתמונת פרופיל
              const photoStamp = authorProfile.photostamp || '';
              const photoUserId = authorProfile.userid || senderUserId;
              if (photoStamp && photoUserId) {
                senderAvatar = `https://stips.co.il/photos/user_profile/l/${photoUserId}/${photoStamp}.jpg`;
              }
              break;
            }
          }
        }
      }
    } catch (wallErr) {
      console.error('[verify-stips] Wall check error:', wallErr.message);
    }

    if (!codeFound) {
      return res.status(400).json({
        success: false,
        error: `הקוד "${code}" עדיין לא נמצא בקיר של נאצ. ודא ששלחת אותו ל: stips.co.il/profile/428498 ולחץ שוב.`
      });
    }

    // סימון הקוד כמשומש
    if (activeCodes.has(code)) {
      activeCodes.get(code).used = true;
    }
    try {
      await db.collection('pending_codes').doc(code).set({ used: true, usedAt: new Date().toISOString() }, { merge: true });
    } catch (e) {}

    // אם לא הצלחנו לזהות את השולח, נשתמש ב-ID גנרי
    if (!senderUserId) {
      senderUserId = 'stips_' + Date.now();
    }

    const profileUrl = senderUserId
      ? `https://stips.co.il/profile/${senderUserId}`
      : 'https://stips.co.il';

    // יצירת JWT session
    const sessionToken = createSessionToken({
      id: senderUserId,
      username: senderUsername,
      profilePic: senderAvatar || '',
      profileUrl
    });

    const userData = {
      id: senderUserId,
      username: senderUsername,
      profilePic: senderAvatar || '',
      profileUrl,
      verified: true,
      verifiedAt: new Date().toISOString(),
      sessionToken,
      tokenCreatedAt: new Date().toISOString()
    };

    // שמירה ב-DB
    try {
      await db.collection('users').doc(senderUserId.toLowerCase()).set(userData, { merge: true });
    } catch (dbErr) {
      console.warn('[verify-stips] DB user save failed (non-fatal):', dbErr.message);
    }

    // Cookie
    res.cookie('stips_session_token', sessionToken, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    return res.json({
      success: true,
      sessionToken,
      user: {
        id: userData.id,
        username: userData.username,
        profilePic: userData.profilePic,
        profileUrl: userData.profileUrl,
        verified: true
      }
    });

  } catch (error) {
    console.error('[verify-stips] Error:', error);
    return res.status(500).json({ error: 'שגיאת שרת באימות' });
  }
});

/**
 * GET /api/me
 */
router.get('/me', async (req, res) => {
  try {
    const token = extractSessionToken(req) || req.query.token;
    if (!token) {
      return res.status(401).json({ success: false, error: 'לא מחובר' });
    }

    const user = await findUserByToken(token);
    if (!user || !user.verified) {
      return res.status(401).json({ success: false, error: 'הסשן לא תקף', expired: true });
    }

    return res.json({
      success: true,
      user: {
        id:         user.id,
        username:   user.username,
        profilePic: user.profilePic || '',
        profileUrl: user.profileUrl || `https://stips.co.il/profile/${user.id}`,
        verified:   true
      }
    });
  } catch (error) {
    console.error('[/api/me] Error:', error);
    return res.status(500).json({ error: 'שגיאת שרת' });
  }
});

/**
 * POST /api/validate-session
 */
router.post('/validate-session', async (req, res) => {
  try {
    const token = extractSessionToken(req);
    if (!token) {
      return res.status(401).json({ success: false, error: 'No session token provided' });
    }

    const user = await findUserByToken(token);
    if (!user || !user.verified) {
      return res.status(401).json({ success: false, error: 'Session token is invalid or expired' });
    }

    return res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        profilePic: user.profilePic || '',
        profileUrl: user.profileUrl || `https://stips.co.il/profile/${user.id}`,
        verified: user.verified
      }
    });
  } catch (error) {
    console.error('[validate-session] Error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/verify-session (alias)
 */
router.post('/verify-session', async (req, res) => {
  try {
    const token = extractSessionToken(req);
    if (!token) return res.status(401).json({ success: false, error: 'No session token' });
    const user = await findUserByToken(token);
    if (!user || !user.verified) return res.status(401).json({ success: false, error: 'Invalid session' });
    return res.json({ success: true, user: { id: user.id, username: user.username, profilePic: user.profilePic, profileUrl: user.profileUrl, verified: true } });
  } catch (error) {
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/logout
 */
router.post('/logout', async (req, res) => {
  try {
    const token = extractSessionToken(req);
    if (token) {
      const user = await findUserByToken(token);
      if (user) {
        await db.collection('users').doc(user.id.toLowerCase()).set({ sessionToken: null }, { merge: true });
      }
    }
    res.clearCookie('stips_session_token');
    return res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Server error during logout' });
  }
});

module.exports = router;
