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