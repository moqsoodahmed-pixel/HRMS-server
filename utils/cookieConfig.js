"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAuthCookieOptions = getAuthCookieOptions;
exports.getClearCookieOptions = getClearCookieOptions;
exports.isCrossSiteCookies = isCrossSiteCookies;
exports.resolveSessionDurations = resolveSessionDurations;

const AUTH_COOKIE_NAME = 'token';
exports.AUTH_COOKIE_NAME = AUTH_COOKIE_NAME;

const isProd = process.env.NODE_ENV === 'production';

/**
 * Whether the auth cookie must be usable across two different sites — a
 * separately-hosted frontend and backend in production (e.g. a Render static
 * site calling a different *.onrender.com backend). This is NEVER guessed
 * from request headers or NODE_ENV alone: it is controlled by an explicit
 * COOKIE_CROSS_SITE env var, because the deployment topology (same-origin vs
 * cross-site) is a deliberate architectural fact, not something safe to infer.
 * Defaults to false — the same-site, more restrictive cookie policy — which
 * is also what already worked for the local dev / same-origin case.
 */
function isCrossSiteCookies() {
    return process.env.COOKIE_CROSS_SITE === 'true';
}

/**
 * The ONE place the auth cookie's transport attributes are decided, for both
 * setting and clearing it. Cookie creation and cookie clearing must always
 * agree on `path`/`domain`/`sameSite`/`secure` — a mismatch means the browser
 * treats the clear-cookie call as a different cookie and the old one lingers
 * (or, more commonly with this bug class, the browser never attaches the
 * cookie to the request that actually needed it).
 *
 *  - Same-site deployment (default, COOKIE_CROSS_SITE unset/false):
 *    SameSite=Lax. This is what the frontend calling `/api` on the same
 *    origin (directly, or via the Vite dev proxy / a single Render service
 *    serving both) needs, and nothing more permissive is required.
 *  - Cross-site deployment (COOKIE_CROSS_SITE=true): SameSite=None, which
 *    per spec MUST be paired with Secure — there is no insecure cross-site
 *    option, by design, so `secure` is forced true here regardless of
 *    NODE_ENV whenever cross-site cookies are requested. If you see this
 *    return secure:true while running over plain HTTP, the cookie will not
 *    be stored at all (browsers refuse Secure cookies on non-HTTPS origins)
 *    — that's the browser protecting you, not a bug; test cross-site mode
 *    over HTTPS (e.g. the actual Render deployment) rather than plain HTTP.
 *
 * No `domain` attribute is ever set: the cookie is host-only, scoped to
 * whichever host actually issued it. That is the correct default for both
 * topologies above and avoids ever guessing a shared parent domain (e.g.
 * accidentally scoping a cookie to all of `.onrender.com`, which would leak
 * it to every other app hosted there).
 */
function baseCookieAttributes() {
    if (isCrossSiteCookies()) {
        return { sameSite: 'none', secure: true };
    }
    return { sameSite: 'lax', secure: isProd };
}

/** Options for `res.cookie('token', jwt, options)`. Pass `maxAge` in milliseconds. */
function getAuthCookieOptions({ maxAge } = {}) {
    return {
        httpOnly: true,
        path: '/',
        ...baseCookieAttributes(),
        ...(maxAge !== undefined ? { maxAge } : {}),
    };
}

/**
 * Options for `res.clearCookie('token', options)`. Must describe the exact
 * same cookie (same path/domain/sameSite/secure) that `getAuthCookieOptions`
 * creates, or the browser will not recognize it as the cookie to remove.
 */
function getClearCookieOptions() {
    return getAuthCookieOptions();
}

const DURATION_RE = /^(\d+)\s*(ms|s|m|h|d)$/i;
const UNIT_MS = { ms: 1, s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };

/**
 * Resolves a duration override to `{ expiresIn, maxAge }` where `expiresIn`
 * is always the exact string handed to `jwt.sign` and `maxAge` (ms) is
 * always parsed from that SAME string — they can never drift apart. An
 * override that doesn't match `<number><ms|s|m|h|d>` is rejected wholesale
 * (falling back to the given default) rather than letting a malformed
 * `expiresIn` reach `jwt.sign` while the cookie silently uses a different duration.
 */
function resolveDuration(envValue, defaultStr, defaultMs) {
    const raw = String(envValue || defaultStr).trim();
    const match = DURATION_RE.exec(raw);
    if (!match) return { expiresIn: defaultStr, maxAge: defaultMs };
    const maxAge = parseInt(match[1], 10) * UNIT_MS[match[2].toLowerCase()];
    return { expiresIn: raw, maxAge };
}

/**
 * Session and "remember me" durations, configurable via env without changing
 * the default behavior (30 minutes / 7 days). The JWT `exp` claim and the
 * cookie's `Max-Age` are derived from the SAME parsed value so they can never
 * drift apart — an invalid override falls back to the documented default
 * rather than silently producing a cookie that outlives (or expires before)
 * the token it carries.
 */
function resolveSessionDurations() {
    return {
        session: resolveDuration(process.env.JWT_SESSION_EXPIRES_IN, '30m', 30 * 60 * 1000),
        remember: resolveDuration(process.env.JWT_REMEMBER_EXPIRES_IN, '7d', 7 * 24 * 60 * 60 * 1000),
    };
}
