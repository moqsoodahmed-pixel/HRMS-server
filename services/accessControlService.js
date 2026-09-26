"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

/**
 * Attribute-Based Access Control for login — PARTS 1, 2, 3 and 4 of the
 * Mobile Device Restriction / Geo-Fencing feature, all in one place so the
 * decision logic has exactly one source of truth (controllers/authController.js
 * login() calls `evaluateLoginAccess()` and nothing else re-implements this).
 *
 * This EXTENDS the existing RBAC (role → route permission, in middleware/auth.js
 * and utils/roles.js) rather than replacing it: RBAC still decides what an
 * authenticated user can DO; this decides whether the login attempt itself,
 * given the role plus device/location/approval/account attributes, is even
 * allowed to reach the point of issuing a session. Nothing here changes how
 * `authorize()` or `isElevated()` work.
 *
 * Attributes evaluated (PART 4):
 *   - role                     (User.role)
 *   - device type              (utils/deviceDetection.js, from real request headers)
 *   - current GPS location     (from the login request body, browser Geolocation API)
 *   - approved remote work     (models/RemoteWorkApproval.js, active for today)
 *   - account status           (User.isActive — already enforced earlier in login())
 *   - employment status        (Employee.status, when an Employee record exists)
 *   - authentication state     (this runs AFTER password verification succeeds,
 *                                so it never fires for a wrong password — see
 *                                controllers/authController.js for why)
 */
const { RemoteWorkApproval } = require('../models/RemoteWorkApproval');
const { isDeviceLocationExempt } = require('../utils/roles');
const { classifyDevice } = require('../utils/deviceDetection');
const { distanceMeters, isValidCoordinate } = require('../utils/geo');

// GPS fixes worse than this are treated as "not accurate enough to trust"
// rather than silently allowed/denied on unreliable data. Not part of the
// spec's explicitly-configurable list (radius/coordinates/enable-toggles
// are), so it's a documented constant here rather than a hidden magic number
// inline.
//
// THIS MUST BE DEVICE-TYPE-AWARE. A phone/tablet has a real GPS chip and
// `enableHighAccuracy: true` (lib/geolocation.js) routinely gets it well
// under 150m. A desktop/laptop has NO GPS hardware at all — the browser can
// only ever do Wi-Fi/IP-based network positioning there, which the W3C
// Geolocation spec itself documents as typically hundreds of meters to a
// few kilometers, even standing still on strong known Wi-Fi. Using the same
// 150m ceiling for both meant every desktop/laptop login was rejected at
// this accuracy check before the actual office-radius distance was ever
// looked at — this is the reported "still can't log in from the office on
// any desktop/laptop, even from 25m away" bug: it was never reaching the
// distance comparison at all. Desktops get a much larger, network-
// positioning-appropriate ceiling; only a fix bad enough to be non-
// actionable (multiple km) is rejected outright. Mobile/tablet keep the
// original, GPS-appropriate ceiling.
const MAX_ACCEPTABLE_ACCURACY_METERS = 150;
const MAX_ACCEPTABLE_ACCURACY_METERS_DESKTOP = 3000;

/**
 * True if `employee` has an ACTIVE RemoteWorkApproval whose [startDate,
 * endDate] window contains `now` (inclusive, compared at day granularity so
 * "today" always matches regardless of time-of-day). Pure date comparison —
 * no background job needed for expiry, see models/RemoteWorkApproval.js.
 */
async function hasActiveRemoteWorkApproval(employeeId, now = new Date()) {
    if (!employeeId) return false;
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now); dayEnd.setHours(23, 59, 59, 999);
    const approval = await RemoteWorkApproval.findOne({
        employee: employeeId,
        status: 'ACTIVE',
        startDate: { $lte: dayEnd },
        endDate: { $gte: dayStart },
    }).select('_id').lean();
    return Boolean(approval);
}
exports.hasActiveRemoteWorkApproval = hasActiveRemoteWorkApproval;

/**
 * Evaluates whether a login attempt (already past password verification)
 * should be allowed to complete. Returns:
 *   { allowed: true }
 *   { allowed: false, code, message, reason, details }
 *
 * `reason`/`details` are for the audit log (controllers/authController.js
 * logs them, never sent to the client). `message` is the user-facing string
 * — professional, non-technical, per spec.
 *
 * Parameters:
 *   role      - User.role
 *   employee  - the linked Employee doc (or null) — used for employment
 *               status and the remote-work-approval lookup
 *   req       - the Express request (read-only: headers, for device
 *               classification)
 *   location  - { latitude, longitude, accuracy } from the login request
 *               body, or null if geolocation wasn't available/granted
 *   settings  - OrgSettings.security sub-document
 */
async function evaluateLoginAccess({ role, employee, req, location, settings }) {
    // Employment status: only INACTIVE (Employee.js status enum) is treated
    // as login-blocking here — ACTIVE, ON_LEAVE, PROBATION and NOTICE_PERIOD
    // are all normal, currently-employed states that must keep logging in
    // exactly as before. This augments, it never weakens, the existing
    // User.isActive check already enforced earlier in authController.login().
    if (employee && employee.status === 'INACTIVE') {
        return {
            allowed: false,
            code: 'EMPLOYMENT_STATUS_RESTRICTED',
            message: 'Access Denied\n\nThis account is not currently eligible to sign in. Please contact HR.',
            reason: 'Employment status restricted',
            details: { employmentStatus: employee.status },
        };
    }

    // CEO / CTO / Project Head (and SUPER_ADMIN, see utils/roles.js) — no
    // device or location restriction, ever, per spec PART 1 and PART 2.
    if (isDeviceLocationExempt(role)) {
        return { allowed: true, exempt: true };
    }

    const sec = settings || {};
    const device = classifyDevice(req);

    // ── PART 1: Mobile Device Restriction ──────────────────────────────
    if (sec.mobileRestrictionEnabled && device.isMobile) {
        return {
            allowed: false,
            code: 'DEVICE_RESTRICTED',
            message: 'Access Denied\n\nFor security reasons, HRMS can only be accessed from an authorized desktop or laptop device. Please use a company-approved desktop or laptop to continue.',
            reason: 'Mobile Device Restricted',
            details: { deviceType: device.deviceType, browser: device.browser, os: device.os, embeddedWebview: device.isEmbeddedWebview },
        };
    }

    // ── Mandatory location for mobile-restricted logins ─────────────────
    // Pure UA/Client-Hints device sniffing has one gap it can never fully
    // close on its own: a device that rewrites its own User-Agent to look
    // like a desktop (Android Chrome's "Request Desktop Site", or iPadOS
    // Safari's default Mac-identifying UA — see utils/deviceDetection.js's
    // doc comment). The X-Device-Signal touch/screen heuristic there closes
    // most of that gap, but it is still a client-reported value. Requiring
    // a real GPS fix here closes the rest of it: it turns "deny location to
    // try to sneak past the device check" into an automatic denial instead
    // of a silent bypass, and a direct/manual API request (no browser, no
    // geolocation to send) is denied the same way. This is independent of
    // whether geo-fencing's distance check (geoRestrictionEnabled) is also
    // turned on — that is a separate, further-restrictive setting.
    if (sec.mobileRestrictionEnabled && (!location || !isValidCoordinate(location.latitude, location.longitude))) {
        return {
            allowed: false,
            code: 'LOCATION_REQUIRED',
            message: 'Access Denied\n\nHRMS requires location access to verify your device before signing in. Please enable location permission for this site in your browser settings and try again.',
            reason: 'Location Access Required',
            details: { deviceType: device.deviceType, browser: device.browser, os: device.os },
        };
    }

    // ── PART 2: Geo-Fencing ─────────────────────────────────────────────
    if (sec.geoRestrictionEnabled) {
        // PART 3: an approved remote-work exception bypasses geo-fencing
        // entirely for its date range — checked before location is even
        // required, so an approved remote employee isn't asked to be
        // physically near a GPS signal that would fail anyway.
        const remoteApproved = await hasActiveRemoteWorkApproval(employee?._id);
        if (remoteApproved) {
            return { allowed: true, remoteWorkApproved: true };
        }

        if (!location) {
            return {
                allowed: false,
                code: 'LOCATION_PERMISSION_DENIED',
                message: 'Access Denied\n\nLocation access is required to sign in to HRMS from this device. Please enable location permission and try again.',
                reason: 'Location Permission Denied',
                details: {},
            };
        }

        const { latitude, longitude, accuracy } = location;
        if (!isValidCoordinate(latitude, longitude)) {
            return {
                allowed: false,
                code: 'LOCATION_PERMISSION_DENIED',
                message: 'Access Denied\n\nLocation access is required to sign in to HRMS from this device. Please enable location permission and try again.',
                reason: 'Location Permission Denied',
                details: { latitude, longitude },
            };
        }
        const accuracyCeiling = device.isMobile ? MAX_ACCEPTABLE_ACCURACY_METERS : MAX_ACCEPTABLE_ACCURACY_METERS_DESKTOP;
        if (typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy > accuracyCeiling) {
            return {
                allowed: false,
                code: 'LOCATION_ACCURACY_TOO_LOW',
                message: 'Access Denied\n\nYour device could not determine a precise enough location. Please move to an area with a clearer GPS/network signal and try again.',
                reason: 'Poor GPS Accuracy',
                details: { latitude, longitude, accuracy, accuracyCeiling, deviceType: device.deviceType },
            };
        }

        const officeLat = sec.officeLatitude;
        const officeLng = sec.officeLongitude;
        if (!isValidCoordinate(officeLat, officeLng)) {
            // Geo-fencing is turned on but office coordinates were never
            // configured — fail closed (deny) rather than silently allow
            // everyone through, but with a distinct, diagnosable reason.
            return {
                allowed: false,
                code: 'OFFICE_LOCATION_NOT_CONFIGURED',
                message: 'Access Denied\n\nHRMS location-based access is not fully configured yet. Please contact your administrator.',
                reason: 'Office coordinates not configured',
                details: {},
            };
        }

        const radius = Number.isFinite(sec.allowedRadiusMeters) ? sec.allowedRadiusMeters : 25;
        const distance = distanceMeters(latitude, longitude, officeLat, officeLng);

        // A reported fix isn't a single point — `accuracy` is the browser's own
        // radius of uncertainty around it (W3C Geolocation spec: the true
        // position is "likely" within `accuracy` meters of the reported one).
        // For a phone/tablet with a real GPS chip that circle is small, so
        // comparing the raw distance straight against the configured office
        // radius is fine (kept exactly as before for mobile/tablet).
        //
        // A desktop/laptop has no GPS at all — every fix here is Wi-Fi/IP
        // network positioning, which the accuracy ceiling above already
        // accepts up to MAX_ACCEPTABLE_ACCURACY_METERS_DESKTOP (3000m) as
        // "not accurate enough to reject outright". But this distance check
        // was still comparing that same noisy fix against the tiny 25m
        // default office radius with zero tolerance — so two desktops sitting
        // side-by-side in the office, both correctly reporting ~150-400m of
        // accuracy, pass or fail this check purely on which one's network fix
        // happened to land closer to the true office point. That is the
        // reported "some desktops still show Access Denied even though
        // they're in the same location [as ones that work]" bug: it was never
        // about location at all, it was this check having no room for the
        // desktop network-positioning error every desktop login already has.
        //
        // Fix: for non-mobile devices, treat the office as "within range" if
        // the office point falls inside the reported fix's own uncertainty
        // circle — i.e. allow up to (radius + accuracy), capped at the same
        // desktop accuracy ceiling so a wildly-off fix still can't buy its way
        // in. Mobile/tablet get no such allowance (accuracy is already small
        // and precise there, so the original strict radius still applies).
        const positionUncertainty = (typeof accuracy === 'number' && Number.isFinite(accuracy)) ? Math.max(accuracy, 0) : 0;
        const uncertaintyAllowance = device.isMobile ? 0 : Math.min(positionUncertainty, MAX_ACCEPTABLE_ACCURACY_METERS_DESKTOP);
        const effectiveRadius = radius + uncertaintyAllowance;

        if (distance > effectiveRadius) {
            return {
                allowed: false,
                code: 'OUTSIDE_OFFICE_RADIUS',
                message: 'Access Denied\n\nHRMS can only be accessed from within the office premises. Please try again once you are on-site, or contact HR for remote work approval.',
                reason: 'Outside Office Radius',
                details: {
                    latitude, longitude, accuracy, distanceMeters: Math.round(distance),
                    allowedRadiusMeters: radius, effectiveRadiusMeters: Math.round(effectiveRadius),
                    deviceType: device.deviceType,
                },
            };
        }
    }

    return { allowed: true };
}
exports.evaluateLoginAccess = evaluateLoginAccess;
exports.MAX_ACCEPTABLE_ACCURACY_METERS = MAX_ACCEPTABLE_ACCURACY_METERS;