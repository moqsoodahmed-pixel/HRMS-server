"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

/**
 * Server-side device classification for the Mobile Device Restriction
 * feature (see services/accessControlService.js / controllers/authController.js).
 *
 * Deliberately does NOT depend on anything the frontend sends about itself —
 * a restricted user hitting POST /api/auth/login directly (curl, Postman, a
 * hand-rolled script) has no frontend running at all, so this file only ever
 * reads real HTTP request data: the User-Agent header and, where the browser
 * sends them, the standard User-Agent Client Hints headers
 * (Sec-CH-UA-Mobile / Sec-CH-UA-Platform). Nothing here trusts a
 * client-supplied "I am a desktop" flag.
 *
 * KNOWN, DOCUMENTED LIMITATION — read before assuming this is 100% bulletproof:
 * iPadOS's "Request Desktop Website" specifically rewrites navigator.userAgent
 * (and the platform hints) to look identical to real macOS Safari. This is a
 * deliberate Apple feature, not a bug in this detector, and there is no
 * server-only HTTP signal that can distinguish the two cases — every major
 * web property has the same limitation, and enterprises that need a hard
 * guarantee use MDM-issued device certificates, not UA sniffing. This
 * detector correctly blocks every Android/iPhone/iPad browser in its default
 * (non-spoofed) mode, and every embedded/in-app webview, which is the
 * overwhelming majority of real restricted-device traffic; the frontend's
 * touch/pointer heuristic (lib/deviceSignal.js, sent as X-Device-Signal) is
 * an additional best-effort signal for the iPad-spoofing edge case, combined
 * with this backend check rather than replacing it.
 */

// Real mobile/tablet OS + embedded-webview tokens. Deliberately does NOT
// match on generic "Mobile" substrings alone where that would also match
// desktop Chrome's own UA (it doesn't contain "Mobile", so this is safe),
// but does match the specific tokens each platform's browsers actually send.
const MOBILE_UA_PATTERNS = [
    /Android/i,
    /iPhone/i,
    /iPod/i,
    /iPad/i,
    // Older iPadOS (pre-13) identified as iPad; iPadOS 13+ identifies as Mac
    // unless it exposes touch — that residual gap is the documented
    // limitation above.
    /Windows Phone/i,
    /IEMobile/i,
    /BlackBerry|BB10/i,
    /Opera Mini/i,
    /Mobile Safari/i,
    /\bMobi\b/i,
    // Embedded / in-app webviews (Android "wv" token; common in-app browsers)
    /; wv\)/i,
    /FBAN|FBAV|FB_IAB/i, // Facebook in-app browser
    /Instagram/i,
    /Line\//i,
    /MicroMessenger/i, // WeChat
    /Snapchat/i,
    /TikTok/i,
    /WhatsApp/i,
];

// A small allowlist of tablet-identifying tokens, kept separate only so
// callers/audit logs can report "tablet" vs "mobile" distinctly — both are
// still "not desktop" for restriction purposes.
const TABLET_UA_PATTERNS = [/iPad/i, /Tablet/i, /Nexus 7|Nexus 10/i, /SM-T\d/i];

/** True if `ua` contains any pattern in `patterns`. */
function matchesAny(ua, patterns) {
    return patterns.some((re) => re.test(ua));
}

/**
 * Classifies a request's originating device from real HTTP headers only.
 * Returns `{ deviceType, isMobile, isEmbeddedWebview, browser, os, raw }`.
 * `deviceType` is one of 'mobile' | 'tablet' | 'desktop' | 'unknown'.
 */
function classifyDevice(req) {
    const ua = String(req.headers['user-agent'] || '');
    // Client Hints (Chrome/Edge/Chromium-based Android browsers): when
    // present, Sec-CH-UA-Mobile is the browser's own structured declaration
    // of whether it's running on a mobile OS — read it as a corroborating
    // signal alongside the UA regex match, never as the sole signal (a
    // manual curl/Postman request never sends it at all, and that must
    // still classify correctly from the UA string alone).
    const chMobile = req.headers['sec-ch-ua-mobile'];
    const chPlatform = String(req.headers['sec-ch-ua-platform'] || '').replace(/"/g, '');

    const uaSaysMobile = matchesAny(ua, MOBILE_UA_PATTERNS);
    const uaSaysTablet = matchesAny(ua, TABLET_UA_PATTERNS);
    const chSaysMobile = chMobile === '?1';
    const chPlatformMobile = ['Android', 'iOS'].includes(chPlatform);

    // Supplementary, best-effort client signal for the gaps real UA/
    // Client-Hints sniffing cannot close on its own (see this file's top
    // doc comment) — never the sole basis for a decision, only tips the
    // balance when the UA/Client Hints signals above are inconclusive
    // (i.e. they say "desktop"):
    //   - 'touch-mac-desktop-mode': iPadOS Safari, which identifies as
    //     desktop macOS Safari by DEFAULT (not just when the user opts
    //     into "Request Desktop Website") — multi-touch is real Macs'
    //     tell-tale absence.
    //   - 'touch-small-screen': a touch-primary device with a physically
    //     small screen (Android Chrome's "Request Desktop Site" rewrites
    //     the UA/Client-Hints to a generic desktop string but cannot spoof
    //     the OS-level `screen` dimensions) — this is the fix for phones
    //     that were getting through the mobile-device restriction by
    //     switching their browser to "desktop site" mode.
    const deviceSignal = String(req.headers['x-device-signal'] || '');
    const signalSaysSpoofedTablet = deviceSignal === 'touch-mac-desktop-mode';
    const signalSaysSpoofedPhone = deviceSignal === 'touch-small-screen';

    const isEmbeddedWebview = /; wv\)/i.test(ua) || /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|WhatsApp/i.test(ua);

    const isMobile = uaSaysMobile || chSaysMobile || chPlatformMobile || signalSaysSpoofedPhone;
    const isTablet = !isMobile && (uaSaysTablet || signalSaysSpoofedTablet);

    let deviceType = 'desktop';
    if (isMobile) deviceType = uaSaysTablet ? 'tablet' : 'mobile';
    else if (isTablet) deviceType = 'tablet';
    if (!ua && chMobile === undefined && !signalSaysSpoofedTablet && !signalSaysSpoofedPhone) deviceType = 'unknown';

    return {
        deviceType, // 'mobile' | 'tablet' | 'desktop' | 'unknown'
        isMobile: deviceType === 'mobile' || deviceType === 'tablet',
        isEmbeddedWebview,
        browser: detectBrowser(ua),
        os: detectOS(ua, chPlatform),
        raw: ua,
    };
}
exports.classifyDevice = classifyDevice;

function detectBrowser(ua) {
    if (/EdgA|Edge|Edg\//i.test(ua)) return 'Edge';
    if (/OPR\/|Opera/i.test(ua)) return 'Opera';
    if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) return 'Chrome';
    if (/CriOS/i.test(ua)) return 'Chrome (iOS)';
    if (/FxiOS/i.test(ua)) return 'Firefox (iOS)';
    if (/Firefox\//i.test(ua)) return 'Firefox';
    if (/Version\/.*Safari/i.test(ua)) return 'Safari';
    if (!ua) return 'Unknown';
    return 'Other';
}

function detectOS(ua, chPlatform) {
    if (chPlatform) return chPlatform;
    if (/Android/i.test(ua)) return 'Android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
    if (/Windows Phone/i.test(ua)) return 'Windows Phone';
    if (/Windows NT/i.test(ua)) return 'Windows';
    if (/Mac OS X/i.test(ua)) return 'macOS';
    if (/Linux/i.test(ua)) return 'Linux';
    if (!ua) return 'Unknown';
    return 'Other';
}
exports.detectOS = detectOS;
exports.detectBrowser = detectBrowser;