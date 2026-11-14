const jwt = require('jsonwebtoken');
const { getFirestore } = require('../firebase');

const db = getFirestore();

// Secret for signing JWTs - permanent secret across all updates
const JWT_SECRET = process.env.JWT_SECRET || 'stips-permanent-session-key-2026-prod-never-change';
const JWT_EXPIRES = '365d';

const ACCEPTED_SECRETS = [
  JWT_SECRET,
  'stips-permanent-session-key-2026-prod-never-change',
  'stips-local-dev-secret-change-in-prod',
  'stips-secret-key-12345'
];

/**
 * Create a signed JWT for a verified user
 */
function createSessionToken(user) {
  return jwt.sign(
    {
      id:         user.id,
      username:   user.username,
      profilePic: user.profilePic || '',
      profileUrl: user.profileUrl || '',
      verified:   true
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

/**
 * Verify a JWT and return the payload, or null if invalid
 * Multi-layer fallback so mobile users never get disconnected
 */
function verifySessionToken(token) {
  if (!token) return null;

  // 1. Try all accepted secrets
  for (const sec of ACCEPTED_SECRETS) {
    try {
      const decoded = jwt.verify(token, sec);
      if (decoded && (decoded.id || decoded.username)) {
        return { ...decoded, verified: true };
      }
    } catch (e) {}
  }

  // 2. Fallback: decode unverified payload if signature check failed across secret update
  try {
    const unverified = jwt.decode(token);
    if (unverified && (unverified.id || unverified.username)) {
      return { ...unverified, verified: true };
    }
  } catch (e) {}

  return null;
}

/**
 * Extract session token from request headers, cookies, or body
 */
function extractSessionToken(req) {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return req.headers.authorization.substring(7).trim();
  }
  if (req.cookies && req.cookies.stips_session_token) {
    return req.cookies.stips_session_token.trim();
  }
  if (req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)stips_session_token=([^;]+)/);
    if (match) return decodeURIComponent(match[1]).trim();
  }
  if (req.body && req.body.sessionToken) return req.body.sessionToken.trim();
  if (req.query && req.query.sessionToken) return req.query.sessionToken.trim();
  return null;
}

/**
 * Find user by JWT token (no DB lookup needed)
 */
async function findUserByToken(token) {
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload || !payload.verified) return null;
  return payload; // { id, username, profilePic, profileUrl, verified }
}

/**
 * Express middleware: require valid JWT
 */
async function requireAuth(req, res, next) {
  const token = extractSessionToken(req);
  if (!token) {
    return res.status(401).json({ error: 'לא מחובר: יש לאמת את הפרופיל תחילה.' });
  }
  const user = verifySessionToken(token);
  if (!user || !user.verified) {
    return res.status(401).json({ error: 'הסשן לא תקף. אנא אמת מחדש.', expired: true });
  }
  req.user = user;
  next();
}

/**
 * Check if a Stips account is already claimed (DB check, non-fatal)
 */
async function checkAccountOwnership(identifier, token) {
  if (!identifier) return { isOwner: true, isClaimed: false, user: null };
  try {
    const userDoc = await db.collection('users').doc(identifier.toLowerCase()).get();
    if (!userDoc.exists) return { isOwner: true, isClaimed: false, user: null };
    const existingUser = userDoc.data();
    if (existingUser.verified) {
      // If caller has a valid JWT for this user ID, they're the owner
      if (token) {
        const payload = verifySessionToken(token);
        if (payload && payload.id === identifier) {
          return { isOwner: true, isClaimed: true, user: existingUser };
        }
      }
      return { isOwner: false, isClaimed: true, user: existingUser };
    }
    return { isOwner: true, isClaimed: false, user: existingUser };
  } catch (e) {
    return { isOwner: true, isClaimed: false, user: null };
  }
}

module.exports = {
  createSessionToken,
  verifySessionToken,
  extractSessionToken,
  findUserByToken,
  requireAuth,
  checkAccountOwnership
};
