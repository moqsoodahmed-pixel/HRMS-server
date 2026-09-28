"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

/**
 * Great-circle distance between two lat/lng points in meters, via the
 * Haversine formula. Used by services/accessControlService.js to compare a
 * login attempt's reported location against the configured office
 * coordinates (OrgSettings.security). Earth radius uses the standard mean
 * radius (6,371,000m) — accurate to well under a meter of error at the
 * ~25m-radius scale this feature operates at.
 */
const EARTH_RADIUS_METERS = 6371000;

function toRadians(deg) {
    return (deg * Math.PI) / 180;
}

/** Distance in meters between (lat1,lng1) and (lat2,lng2). */
function distanceMeters(lat1, lng1, lat2, lng2) {
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_METERS * c;
}
exports.distanceMeters = distanceMeters;

/** True when both values are finite numbers within valid lat/lng ranges. */
function isValidCoordinate(lat, lng) {
    return (
        typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
        typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180
    );
}
exports.isValidCoordinate = isValidCoordinate;

/**
 * Strips the "::ffff:" prefix Node adds to an IPv4 address when it arrives
 * over an IPv6-capable socket (very common behind a proxy/load balancer,
 * e.g. Railway) — without this, "::ffff:203.0.113.5" would never match a
 * configured allowlist entry of "203.0.113.5".
 */
function normalizeIp(ip) {
    const s = String(ip || '').trim();
    return s.startsWith('::ffff:') ? s.slice(7) : s;
}
exports.normalizeIp = normalizeIp;

/** True for a syntactically valid dotted-quad IPv4 address. */
function isIPv4(ip) {
    const parts = String(ip).split('.');
    if (parts.length !== 4) return false;
    return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function ipv4ToInt(ip) {
    return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

/**
 * True if IPv4 address `ip` falls inside CIDR range `cidr` (e.g.
 * "203.0.113.0/24"). Returns false (never throws) for anything malformed.
 */
function ipv4InCidr(ip, cidr) {
    const [rangeIp, bitsStr] = String(cidr).split('/');
    if (!isIPv4(ip) || !isIPv4(rangeIp)) return false;
    const bits = Number(bitsStr);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipv4ToInt(ip) & mask) === (ipv4ToInt(rangeIp) & mask);
}

/**
 * True if `ip` matches any entry in `allowlist` — each entry may be an
 * exact IPv4/IPv6 address or an IPv4 CIDR range (e.g. "203.0.113.0/24").
 * Used by services/accessControlService.js as an alternate, much more
 * reliable proof of "this login is coming from the office" than browser
 * Wi-Fi/IP-based geolocation, which routinely misreports (or fails outright)
 * for office Wi-Fi access points that simply aren't in the browser's
 * crowd-sourced location database — see the doc comment on
 * OrgSettings.security.officeIpAllowlist for the full reasoning. Comparison
 * is exact-string for IPv6 (no CIDR support there — out of scope, since
 * offices overwhelmingly report a single public IPv4 address to their ISP)
 * and exact-or-CIDR for IPv4. Never throws; a malformed entry is silently
 * skipped rather than crashing the login request.
 */
function isIpAllowlisted(ip, allowlist) {
    if (!ip || !Array.isArray(allowlist) || allowlist.length === 0) return false;
    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp) return false;
    return allowlist.some((entry) => {
        const value = normalizeIp(String(entry || '').trim());
        if (!value) return false;
        if (value.includes('/')) return ipv4InCidr(normalizedIp, value);
        return value === normalizedIp;
    });
}
exports.isIpAllowlisted = isIpAllowlisted;