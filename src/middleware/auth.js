const { getFirestore } = require('../firebase');

const db = getFirestore();

/**
 * Extracts session token from headers, cookies, or body
 */
function extractSessionToken(req) {
  // 1. Authorization header: Bearer <token>
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return req.headers.authorization.substring(7).trim();
  }

  // 2. Cookie parser parsed cookies
  if (req.cookies && req.cookies.stips_session_token) {
    return req.cookies.stips_session_token.trim();
  }

  // 3. Raw Cookie header fallback parsing
  if (req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)stips_session_token=([^;]+)/);
    if (match) {
      return decodeURIComponent(match[1]).trim();
    }
  }

  // 4. Request body or query
  if (req.body && req.body.sessionToken) {
    return req.body.sessionToken.trim();
  }
  if (req.query && req.query.sessionToken) {
    return req.query.sessionToken.trim();
  }

  return null;
}

/**
 * Finds user in Firestore by their secret session token
 */
async function findUserByToken(token) {
  if (!token) return null;

  const snapshot = await db.collection('users')
    .where('sessionToken', '==', token)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() };
}

/**
 * Express middleware to enforce authentication for sensitive actions
 */
async function requireAuth(req, res, next) {
  try {
    const token = extractSessionToken(req);

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized: Missing session token. Please verify your Stips account.'
      });
    }

    const user = await findUserByToken(token);

    if (!user || !user.verified) {
      return res.status(401).json({
        error: 'Unauthorized: Invalid or expired session token. Please verify your Stips account.'
      });
    }

    req.user = user;
    req.sessionToken = token;
    next();
  } catch (err) {
    console.error('Authentication middleware error:', err);
    return res.status(500).json({ error: 'Internal authentication error' });
  }
}

/**
 * Verifies if an existing Stips account is already claimed by someone else.
 * Prevents account hijacking.
 */
async function checkAccountOwnership(identifier, token) {
  if (!identifier) return { isOwner: true, isClaimed: false, user: null };

  const userDoc = await db.collection('users').doc(identifier.toLowerCase()).get();

  if (!userDoc.exists) {
    return { isOwner: true, isClaimed: false, user: null };
  }

  const existingUser = userDoc.data();

  // If user is verified and has an existing session token
  if (existingUser.verified && existingUser.sessionToken) {
    // If the caller provided the exact matching token, they are the verified owner
    if (token && existingUser.sessionToken === token) {
      return { isOwner: true, isClaimed: true, user: existingUser };
    }
    // Otherwise, someone else is attempting to claim/hijack this verified account
    return { isOwner: false, isClaimed: true, user: existingUser };
  }

  return { isOwner: true, isClaimed: false, user: existingUser };
}

module.exports = {
  extractSessionToken,
  findUserByToken,
  requireAuth,
  checkAccountOwnership
};
