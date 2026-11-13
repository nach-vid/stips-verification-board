const express = require('express');
const router = express.Router();
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const { getFirestore } = require('../firebase');
const {
  extractSessionToken,
  findUserByToken,
  checkAccountOwnership
} = require('../middleware/auth');

const db = getFirestore();

// Helper to generate a unique verification code like STIPS-A8F2K
function generateUniqueCode() {
  const randomStr = crypto.randomBytes(3).toString('hex').toUpperCase().substring(0, 5);
  return `STIPS-${randomStr}`;
}

// Helper to generate a cryptographically secure 256-bit session token
function generateSecureSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Extracts Stips Profile identifier (supports full URL or raw username/ID)
 */
function extractProfileIdentifier(input) {
  if (!input) return '';
  const trimmed = input.trim();
  const match = trimmed.match(/profile\/([a-zA-Z0-9_\u0590-\u05FF]+)/i);
  if (match) return match[1];
  return trimmed;
}

/**
 * POST /api/generate-code
 * Receives: { stipsUsername }
 * Hijacking Protection: Checks if username is already claimed.
 * If claimed by someone else, blocks code generation.
 */
router.post('/generate-code', async (req, res) => {
  try {
    const { stipsUsername } = req.body;

    if (!stipsUsername || typeof stipsUsername !== 'string' || !stipsUsername.trim()) {
      return res.status(400).json({ error: 'stipsUsername is required' });
    }

    const identifier = extractProfileIdentifier(stipsUsername);
    if (!identifier) {
      return res.status(400).json({ error: 'Could not extract a valid Stips username or ID from the provided input.' });
    }

    const token = extractSessionToken(req);

    // Anti-Hijacking Check (non-fatal – if DB is unavailable skip the check gracefully)
    try {
      const { isOwner, isClaimed, user: existingUser } = await checkAccountOwnership(identifier, token);
      if (isClaimed && !isOwner) {
        return res.status(403).json({
          success: false,
          error: `Account "${identifier}" is already verified and belongs to another user.`
        });
      }
    } catch (ownerCheckErr) {
      console.warn('[generate-code] Ownership check failed (non-fatal):', ownerCheckErr.message);
    }

    const verificationCode = generateUniqueCode();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    // Store pending verification (non-fatal if DB write fails)
    try {
      await db.collection('pending_verifications').doc(identifier.toLowerCase()).set({
        identifier: identifier,
        originalInput: stipsUsername.trim(),
        verificationCode: verificationCode,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString()
      });
    } catch (dbErr) {
      console.warn('[generate-code] DB write failed (non-fatal):', dbErr.message);
    }

    const profileUrl = `https://www.stips.co.il/profile/${encodeURIComponent(identifier)}`;

    return res.json({
      success: true,
      identifier: identifier,
      profileUrl: profileUrl,
      verificationCode: verificationCode,
      instructions: `Copy "${verificationCode}" and paste it into your Stips bio at ${profileUrl}, then click Verify.`
    });
  } catch (error) {
    console.error('[generate-code] Unexpected error:', error);
    return res.status(500).json({ error: 'Failed to generate verification code', detail: error.message });
  }
});

/**
 * POST /api/verify-stips
 * Receives: { stipsUsername, verificationCode }
 * 1. Verifies code exists in Stips profile bio.
 * 2. Generates a secure random session token.
 * 3. Saves session token in Firestore ('users' collection).
 * 4. Returns session token in the response (and sets an httpOnly cookie).
 */
router.post('/verify-stips', async (req, res) => {
  try {
    const { stipsUsername, verificationCode } = req.body;

    if (!stipsUsername || !verificationCode) {
      return res.status(400).json({ error: 'stipsUsername and verificationCode are required' });
    }

    const identifier = extractProfileIdentifier(stipsUsername);
    const code = verificationCode.trim();
    const incomingToken = extractSessionToken(req);

    // Anti-Hijacking Check: Verify ownership (non-fatal)
    try {
      const { isOwner, isClaimed } = await checkAccountOwnership(identifier, incomingToken);
      if (isClaimed && !isOwner) {
        return res.status(403).json({
          success: false,
          error: `Account "${identifier}" is already claimed. You do not hold the correct session token.`
        });
      }
    } catch (ownerErr) {
      console.warn('[verify-stips] Ownership check failed (non-fatal):', ownerErr.message);
    }

    // Verify against pending code if stored (non-fatal)
    try {
      const pendingDoc = await db.collection('pending_verifications').doc(identifier.toLowerCase()).get();
      if (pendingDoc.exists) {
        const pendingData = pendingDoc.data();
        if (pendingData.verificationCode !== code) {
          return res.status(400).json({
            success: false,
            error: 'Verification code mismatch. Please use the most recently generated code.'
          });
        }
      }
    } catch (pendingErr) {
      console.warn('[verify-stips] Pending doc check failed (non-fatal):', pendingErr.message);
    }

    const profileUrl = `https://www.stips.co.il/profile/${encodeURIComponent(identifier)}`;
    console.log(`[verify-stips] Verifying user: ${identifier} with code: ${code}`);

    let title = '';
    let avatar = '';
    let codeFound = false;

    // --- Strategy 1: Stips internal API (works for numeric user IDs) ---
    if (/^\d+$/.test(identifier)) {
      try {
        const statusPayload = JSON.stringify({ objType: 'user_profile_page', data: { userid: Number(identifier) } });
        const userPayload   = JSON.stringify({ objType: 'user',              data: { id:     Number(identifier) } });

        const baseUrl = 'https://stips.co.il/api?name=omniobj&rest_action=GET&omniobj=';
        const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'application/json' };

        const [statusRes, userRes] = await Promise.all([
          axios.get(baseUrl + encodeURIComponent(statusPayload), { headers, timeout: 10000 }).catch(e => { console.warn('[verify-stips] status API:', e.message); return null; }),
          axios.get(baseUrl + encodeURIComponent(userPayload),   { headers, timeout: 10000 }).catch(e => { console.warn('[verify-stips] user API:',   e.message); return null; })
        ]);

        if (statusRes && statusRes.data) {
          const omni = statusRes.data.data?.omniOmniObj;
          const textStatus = omni?.data?.text_status || omni?.extra?.text_status || '';
          const rawJson = JSON.stringify(statusRes.data);
          console.log(`[verify-stips] text_status: "${textStatus}"`);
          if (textStatus.includes(code) || rawJson.includes(code)) codeFound = true;
        }

        if (userRes && userRes.data) {
          const omni = userRes.data.data?.omniOmniObj;
          if (omni) {
            const data  = omni.data  || {};
            const extra = omni.extra || {};
            if (data.nickname) title = data.nickname;
            const rawJson = JSON.stringify(userRes.data);
            if (!codeFound && rawJson.includes(code)) codeFound = true;
            const photostamp = extra.photostamp || data.photo_updated_stamp || '';
            if ((data.has_photo || photostamp) && photostamp) {
              avatar = `https://stips.co.il/photos/user_profile/l/${identifier}/${photostamp}.jpg`;
            }
          }
        }
      } catch (apiErr) {
        console.warn('[verify-stips] Stips API check error:', apiErr.message);
      }
    }

    // --- Strategy 2: Fallback – raw HTML GET (may contain static meta/og tags) ---
    if (!codeFound) {
      try {
        const response = await axios.get(profileUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            'Accept': 'text/html,*/*',
            'Accept-Language': 'he,en;q=0.9'
          },
          timeout: 12000
        });
        const rawHtml = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        const $ = cheerio.load(rawHtml);

        const bodyText  = $('body').text();
        const metaDesc  = $('meta[name="description"]').attr('content') || '';
        const ogDesc    = $('meta[property="og:description"]').attr('content') || '';
        const ogTitle   = $('meta[property="og:title"]').attr('content') || '';
        const ogImg     = $('meta[property="og:image"]').attr('content') || '';

        if (!title && ogTitle) title = ogTitle;
        if (!avatar && ogImg)   avatar = ogImg.startsWith('/') ? `https://www.stips.co.il${ogImg}` : ogImg;

        const combined = bodyText + metaDesc + ogDesc + rawHtml;
        console.log(`[verify-stips] HTML fallback - code in page: ${combined.includes(code)}`);
        if (combined.includes(code)) codeFound = true;
      } catch (fetchErr) {
        console.warn(`[verify-stips] HTML GET failed: ${fetchErr.message}`);
      }
    }

    // Validation result
    if (!codeFound) {
      return res.status(400).json({
        success: false,
        error: `Verification code "${code}" was not found in profile "${identifier}". Please ensure the code is saved in your Stips bio.`,
        profileChecked: profileUrl
      });
    }

    // Extract clean display name
    let displayName = identifier;
    if (title) {
      displayName = title.replace(/\s*-\s*סטיפס.*/i, '').trim() || identifier;
    }

    // Generate unique cryptographically secure 256-bit session token
    const sessionToken = generateSecureSessionToken();

    const userData = {
      id: identifier,
      username: displayName,
      profilePic: avatar || 'https://stips.co.il/images/default-avatar.png',
      profileUrl: profileUrl,
      verified: true,
      verifiedAt: new Date().toISOString(),
      sessionToken: sessionToken,
      tokenCreatedAt: new Date().toISOString()
    };

    // Save user & sessionToken securely in Firestore collection 'users'
    try {
      await db.collection('users').doc(identifier.toLowerCase()).set(userData, { merge: true });
    } catch (dbErr) {
      console.warn('[verify-stips] DB user save failed (non-fatal):', dbErr.message);
    }

    // Clean up pending verification
    try {
      await db.collection('pending_verifications').doc(identifier.toLowerCase()).delete();
    } catch (cleanErr) {
      console.warn('[verify-stips] Pending cleanup failed (non-fatal):', cleanErr.message);
    }

    // Set secure HTTP-only cookie on the client response
    res.cookie('stips_session_token', sessionToken, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    // Return the session token and user data (for LocalStorage storage)
    return res.json({
      success: true,
      message: 'User verified successfully and session secured',
      sessionToken: sessionToken,
      user: {
        id: userData.id,
        username: userData.username,
        profilePic: userData.profilePic,
        profileUrl: userData.profileUrl,
        verified: userData.verified
      }
    });
  } catch (error) {
    console.error('Error during verification:', error);
    return res.status(500).json({ error: 'Server error during verification' });
  }
});

/**
 * GET /api/me
 * Receives the session token (via Authorization: Bearer <token>, cookie, or query ?token=)
 * Checks if it matches a verified user in Firestore 'users' collection
 * Returns user profile data (username, profilePic, id, profileUrl)
 */
router.get('/me', async (req, res) => {
  try {
    const token = extractSessionToken(req) || req.query.token;

    if (!token) {
      return res.status(401).json({ success: false, error: 'Unauthorized: No session token provided' });
    }

    const user = await findUserByToken(token);

    if (!user || !user.verified) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Session token is invalid or expired' });
    }

    return res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        profilePic: user.profilePic || 'https://stips.co.il/images/default-avatar.png',
        profileUrl: user.profileUrl || `https://stips.co.il/profile/${user.id}`,
        verified: user.verified
      }
    });
  } catch (error) {
    console.error('Error in GET /api/me:', error);
    return res.status(500).json({ error: 'Server error retrieving current user session' });
  }
});

/**
 * POST /api/validate-session
 * Receives session token in body or header, checks user in Firestore, returns user data.
 */
router.post('/validate-session', async (req, res) => {
  try {
    const token = extractSessionToken(req);

    if (!token) {
      return res.status(401).json({ success: false, error: 'Unauthorized: No session token provided' });
    }

    const user = await findUserByToken(token);

    if (!user || !user.verified) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Session token is invalid or expired' });
    }

    return res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        profilePic: user.profilePic || 'https://stips.co.il/images/default-avatar.png',
        profileUrl: user.profileUrl || `https://stips.co.il/profile/${user.id}`,
        verified: user.verified
      }
    });
  } catch (error) {
    console.error('Error in POST /api/validate-session:', error);
    return res.status(500).json({ error: 'Server error validating session' });
  }
});

/**
 * POST /api/verify-session (alias for backwards compatibility)
 */
router.post('/verify-session', async (req, res) => {
  try {
    const token = extractSessionToken(req);
    if (!token) return res.status(401).json({ success: false, error: 'No session token provided' });

    const user = await findUserByToken(token);
    if (!user || !user.verified) return res.status(401).json({ success: false, error: 'Session token invalid or expired' });

    return res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        profilePic: user.profilePic,
        profileUrl: user.profileUrl,
        verified: user.verified
      }
    });
  } catch (error) {
    console.error('Error verifying session:', error);
    return res.status(500).json({ error: 'Server error verifying session' });
  }
});

/**
 * POST /api/logout
 * Clears session cookie and invalidates session token in Firestore
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
    console.error('Error during logout:', error);
    return res.status(500).json({ error: 'Server error during logout' });
  }
});

module.exports = router;
