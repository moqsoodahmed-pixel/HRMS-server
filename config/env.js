"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateEnv = validateEnv;

/**
 * Fails fast at startup when a security-critical secret is missing or
 * obviously weak, rather than letting jsonwebtoken/crypto fall back to a
 * hardcoded default deep inside a request handler (CWE-798). There is no
 * safe default for a signing key or an encryption key — an unset value must
 * stop the process, not quietly downgrade security.
 */
function validateEnv() {
    const problems = [];

    if (!process.env.JWT_SECRET) {
        problems.push('JWT_SECRET is not set');
    } else if (process.env.JWT_SECRET.length < 32) {
        problems.push('JWT_SECRET is shorter than 32 characters — use a long, random value');
    }

    if (!process.env.ENCRYPTION_KEY) {
        problems.push('ENCRYPTION_KEY is not set');
    } else if (!/^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY)) {
        problems.push('ENCRYPTION_KEY must be 64 hex characters (a 256-bit key)');
    }

    // `credentials: true` CORS responses can never use a `*` origin — the
    // browser rejects that combination outright — so a wildcard here isn't a
    // lesser security posture, it's a configuration that cannot work at all.
    if ((process.env.CLIENT_URL || '').split(',').map((s) => s.trim()).includes('*')) {
        problems.push("CLIENT_URL cannot be '*' — CORS with credentials requires an exact origin (or comma-separated list of exact origins)");
    }

    if (problems.length) {
        console.error('❌ Refusing to start: unsafe security configuration —');
        for (const p of problems) console.error(`   - ${p}`);
        process.exit(1);
    }

    // Safe, secret-free confirmation that signing/verification will actually
    // agree at runtime — never the secret value itself, only its presence and length.
    console.log(`🔐 JWT secret configured: yes (length ${process.env.JWT_SECRET.length})`);
    console.log(`🍪 Cookie mode: ${process.env.COOKIE_CROSS_SITE === 'true' ? 'cross-site (SameSite=None; Secure)' : 'same-site (SameSite=Lax)'}`);
    if (process.env.COOKIE_CROSS_SITE === 'true' && process.env.NODE_ENV !== 'production') {
        console.warn('⚠️  COOKIE_CROSS_SITE=true forces Secure cookies, which browsers refuse over plain HTTP — cross-site cookies will not work here unless this is served over HTTPS.');
    }
}
