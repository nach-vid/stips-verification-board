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
    const token = extractSessionToken(req);

    // Anti-Hijacking Check: Has this account already been claimed?
    const { isOwner, isClaimed, user: existingUser } = await checkAccountOwnership(identifier, token);
    if (isClaimed && !isOwner) {
      return res.status(403).json({
        success: false,
        error: `Account Hijacking Blocked: Stips account "${identifier}" (${existingUser.username || ''}) is already verified and owned by another user. You cannot generate a verification code for an already claimed account.`
      });
    }

    const verificationCode = generateUniqueCode();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes expiration

    // Store in Firestore under collection 'pending_verifications'
    await db.collection('pending_verifications').doc(identifier.toLowerCase()).set({
      identifier: identifier,
      originalInput: stipsUsername.trim(),
      verificationCode: verificationCode,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString()
    });

    const profileUrl = `https://www.stips.co.il/profile/${encodeURIComponent(identifier)}`;

    return res.json({
      success: true,
      identifier: identifier,
      profileUrl: profileUrl,
      verificationCode: verificationCode,
      instructions: `Please copy "${verificationCode}" and paste it into your Stips profile bio at ${profileUrl}, then click Verify.`
    });
  } catch (error) {
    console.error('Error generating verification code:', error);
    return res.status(500).json({ error: 'Failed to generate verification code' });
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

    // Anti-Hijacking Check: Verify ownership
    const { isOwner, isClaimed } = await checkAccountOwnership(identifier, incomingToken);
    if (isClaimed && !isOwner) {
      return res.status(403).json({
        success: false,
        error: `Account Hijacking Blocked: Stips account "${identifier}" is already claimed. You do not possess the valid session token for this account.`
      });
    }

    // Verify against pending code if stored
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

    const profileUrl = `https://www.stips.co.il/profile/${encodeURIComponent(identifier)}`;
    console.log(`Verifying Stips user: ${identifier} with code: ${code}`);

    let rawHtml = '';
    let bodyText = '';
    let title = '';
    let avatar = '';
    let codeFound = false;

    // 1. Fetch raw HTML page with standard Axios
    try {
      const response = await axios.get(profileUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'he,en;q=0.9',
          'Cache-Control': 'no-cache'
        },
        timeout: 12000
      });

      rawHtml = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      const $ = cheerio.load(rawHtml);

      bodyText = $('body').text();
      title = $('title').text() || $('meta[property="og:title"]').attr('content') || '';
      avatar = $('meta[property="og:image"]').attr('content') ||
               $('.profile-avatar img, .avatar img, img[class*="avatar"]').attr('src') ||
               '';

      if (avatar && avatar.startsWith('/')) {
        avatar = `https://www.stips.co.il${avatar}`;
      }

      if (bodyText.includes(code) || rawHtml.includes(code)) {
        codeFound = true;
      }
    } catch (fetchErr) {
      console.warn(`Axios GET ${profileUrl} error:`, fetchErr.message);
    }

    // 2. Direct lightweight HTTP check (pure Axios GET fallback for Stips user data)
    if (!codeFound && /^\d+$/.test(identifier)) {
      try {
        const statusPayload = JSON.stringify({
          objType: 'user_profile_page',
          data: { userid: Number(identifier) }
        });
        const userPayload = JSON.stringify({
          objType: 'user',
          data: { id: Number(identifier) }
        });

        const [statusRes, userRes] = await Promise.all([
          axios.get(`https://stips.co.il/api?name=omniobj&rest_action=GET&omniobj=${encodeURIComponent(statusPayload)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 8000
          }).catch(() => null),
          axios.get(`https://stips.co.il/api?name=omniobj&rest_action=GET&omniobj=${encodeURIComponent(userPayload)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 8000
          }).catch(() => null)
        ]);

        if (statusRes && statusRes.data && statusRes.data.data && statusRes.data.data.omniOmniObj) {
          const textStatus = statusRes.data.data.omniOmniObj.data?.text_status || '';
          if (textStatus.includes(code)) {
            codeFound = true;
          }
        }

        if (userRes && userRes.data && userRes.data.data && userRes.data.data.omniOmniObj) {
          const userData = userRes.data.data.omniOmniObj.data || {};
          const extra = userRes.data.data.omniOmniObj.extra || {};
          if (userData.nickname) {
            title = userData.nickname;
          }
          const photostamp = extra.photostamp || userData.photo_updated_stamp || '';
          if (userData.has_photo && photostamp) {
            avatar = `https://stips.co.il/photos/user_profile/l/${identifier}/${photostamp}.jpg`;
          }
        }
      } catch (apiErr) {
        console.warn('Direct Stips HTTP check warning:', apiErr.message);
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
    await db.collection('users').doc(identifier.toLowerCase()).set(userData, { merge: true });

    // Clean up pending verification
    await db.collection('pending_verifications').doc(identifier.toLowerCase()).delete();

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
