// ===========================================================================
// ADMIN AUTH — password hashing, signed session cookies, and login throttling.
// No session-store dependency: the cookie itself is the session, signed with
// HMAC-SHA256 so it can't be forged or edited without SESSION_SECRET.
// ===========================================================================
const crypto = require('crypto');
const db = require('./supabase');

const COOKIE_NAME  = 'countdown_admin';
const SESSION_TTL  = 30 * 24 * 60 * 60 * 1000; // 30 days

let sessionSecret = null;

/** Load SESSION_SECRET from the environment, or fall back to one persisted in
 *  Supabase (generated once) so logins survive a redeploy without needing the
 *  env var set. If Supabase isn't configured either, generate one for this
 *  process only — admins will just need to log in again after every restart. */
async function init() {
    if (process.env.SESSION_SECRET) {
        sessionSecret = process.env.SESSION_SECRET;
        return;
    }
    const stored = await db.getSetting('session_secret');
    if (stored && stored.secret) {
        sessionSecret = stored.secret;
        return;
    }
    const generated = crypto.randomBytes(48).toString('hex');
    await db.setSetting('session_secret', { secret: generated });
    sessionSecret = generated;
}

// ---------------------------------------------------------------------------
// Password hashing (scrypt — no extra native dependency required)
// ---------------------------------------------------------------------------
function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 64);
    return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

function verifyPassword(password, saltHex, hashHex) {
    try {
        const salt = Buffer.from(saltHex, 'hex');
        const expected = Buffer.from(hashHex, 'hex');
        const actual = crypto.scryptSync(password, salt, expected.length);
        return crypto.timingSafeEqual(actual, expected);
    } catch (_) {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Signed session cookie
// ---------------------------------------------------------------------------
function sign(payload) {
    return crypto.createHmac('sha256', sessionSecret).update(payload).digest('hex');
}

function createSessionToken() {
    const payload = JSON.stringify({ exp: Date.now() + SESSION_TTL });
    const encoded = Buffer.from(payload).toString('base64url');
    return `${encoded}.${sign(encoded)}`;
}

function verifySessionToken(token) {
    if (!token || !sessionSecret) return false;
    const [encoded, sig] = token.split('.');
    if (!encoded || !sig) return false;
    const expected = sign(encoded);
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
    try {
        const { exp } = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        return typeof exp === 'number' && Date.now() < exp;
    } catch (_) {
        return false;
    }
}

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    header.split(';').forEach(part => {
        const idx = part.indexOf('=');
        if (idx === -1) return;
        out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    });
    return out;
}

function isRequestAuthenticated(req) {
    const cookies = parseCookies(req.headers.cookie);
    return verifySessionToken(cookies[COOKIE_NAME]);
}

function isSocketAuthenticated(socket) {
    const cookies = parseCookies(socket.handshake.headers.cookie);
    return verifySessionToken(cookies[COOKIE_NAME]);
}

function setSessionCookie(res) {
    const token = createSessionToken();
    const maxAgeSec = Math.floor(SESSION_TTL / 1000);
    res.setHeader('Set-Cookie',
        `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}; Path=/`);
}

function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`);
}

// ---------------------------------------------------------------------------
// Express middleware
// ---------------------------------------------------------------------------
function requireAdminPage(req, res, next) {
    if (isRequestAuthenticated(req)) return next();
    res.redirect('/login.html');
}

function requireAdminApi(req, res, next) {
    if (isRequestAuthenticated(req)) return next();
    // A distinct `code` lets the client tell "your session expired" apart from an ordinary
    // 401 like a wrong current-password on the change-password endpoint.
    res.status(401).json({ error: 'Not authenticated', code: 'AUTH_REQUIRED' });
}

// ---------------------------------------------------------------------------
// Simple login-attempt throttling (in-memory; fine for a single-instance app)
// ---------------------------------------------------------------------------
const attempts = new Map(); // ip -> { count, lockUntil }
const MAX_ATTEMPTS = 6;
const LOCK_MS = 5 * 60 * 1000;

function checkRateLimit(ip) {
    const rec = attempts.get(ip);
    if (!rec) return { allowed: true };
    if (rec.lockUntil && Date.now() < rec.lockUntil) {
        return { allowed: false, retryAfterMs: rec.lockUntil - Date.now() };
    }
    return { allowed: true };
}

function recordFailure(ip) {
    const rec = attempts.get(ip) || { count: 0, lockUntil: 0 };
    rec.count += 1;
    if (rec.count >= MAX_ATTEMPTS) {
        rec.lockUntil = Date.now() + LOCK_MS;
        rec.count = 0;
    }
    attempts.set(ip, rec);
}

function recordSuccess(ip) {
    attempts.delete(ip);
}

// ---------------------------------------------------------------------------
// Admin password (stored hashed in Supabase settings under 'admin_auth')
// ---------------------------------------------------------------------------
async function verifyAdminPassword(password) {
    const record = await db.getSetting('admin_auth');
    if (!record || !record.salt || !record.hash) return false;
    return verifyPassword(password, record.salt, record.hash);
}

async function setAdminPassword(password) {
    const { salt, hash } = hashPassword(password);
    await db.setSetting('admin_auth', { salt, hash });
}

module.exports = {
    init,
    setSessionCookie,
    clearSessionCookie,
    isRequestAuthenticated,
    isSocketAuthenticated,
    requireAdminPage,
    requireAdminApi,
    checkRateLimit,
    recordFailure,
    recordSuccess,
    verifyAdminPassword,
    setAdminPassword
};
