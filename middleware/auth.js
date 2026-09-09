"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorizeOwnerOrAdmin = exports.authorize = exports.authenticate = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const { isElevated } = require("../utils/roles");
const { AUTH_COOKIE_NAME } = require("../utils/cookieConfig");

/**
 * Safe, secret-free diagnostics for the exact failure mode described in the
 * "login succeeds, everything after 401s" bug class: whether a cookie/header
 * arrived at all (a cross-site cookie / CORS / proxy problem) vs. whether one
 * arrived but failed verification (a JWT_SECRET / clock / expiry problem).
 * NEVER logs the token, the secret, or any request body/header value itself.
 */
function logAuthFailure(req, { tokenPresent, errName }) {
    const detail = tokenPresent ? `token present, verification failed (${errName})` : 'no token present';
    console.warn(`[auth] 401 on ${req.method} ${req.originalUrl} — ${detail}`);
}

const authenticate = (req, res, next) => {
    const token = req.cookies?.[AUTH_COOKIE_NAME] || req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
        logAuthFailure(req, { tokenPresent: false });
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
        return;
    }
    try {
        const payload = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        req.user = payload;
        next();
    }
    catch (err) {
        logAuthFailure(req, { tokenPresent: true, errName: err.name });
        res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
    }
};
exports.authenticate = authenticate;

/**
 * Gates a route to a specific role list. Platform administrators (SUPER_ADMIN
 * and any role granted the same effective power, e.g. CTO — see utils/roles.js)
 * always pass, regardless of what the route's own list contains. This is the
 * single mechanism that gives an elevated role full access everywhere without
 * every route having to remember to list it.
 */
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
            return;
        }
        if (!isElevated(req.user.role) && !roles.includes(req.user.role)) {
            res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } });
            return;
        }
        next();
    };
};
exports.authorize = authorize;

/**
 * Blocks an EMPLOYEE-role account from operational modules (attendance, leave,
 * payroll, documents, etc.) until their onboarding has been APPROVED by
 * HR/Admin. Deliberately re-reads Employee.onboardingStatus from the database
 * on every request rather than trusting anything on the JWT/request — the
 * whole point is that a client cannot unlock itself by editing local state,
 * cookies, or the request payload.
 *
 * Only ever gates the EMPLOYEE role. HR_ADMIN, every elevated role, and every
 * other administrative/manager role pass straight through, matching the
 * requirement that onboarding-lock never applies to admin/HR/founder access.
 */
const requireOnboardingApproved = () => {
    return async (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
            return;
        }
        if (req.user.role !== 'EMPLOYEE') {
            next();
            return;
        }
        try {
            const { Employee } = require('../models/Employee');
            const employee = await Employee.findOne({ user: req.user.userId }).select('onboardingStatus');
            if (!employee || employee.onboardingStatus !== 'APPROVED') {
                res.status(403).json({
                    error: {
                        code: 'ONBOARDING_INCOMPLETE',
                        message: 'Complete your onboarding and wait for HR/Admin approval before accessing this module.',
                    },
                });
                return;
            }
            next();
        }
        catch (err) {
            next(err);
        }
    };
};
exports.requireOnboardingApproved = requireOnboardingApproved;

const authorizeOwnerOrAdmin = (getUserId) => {
    return (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
            return;
        }
        const targetId = getUserId(req);
        const isAdmin = isElevated(req.user.role) || ['HR_ADMIN', 'FINANCE'].includes(req.user.role);
        const isOwner = req.user.userId === targetId;
        if (!isAdmin && !isOwner) {
            res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
            return;
        }
        next();
    };
};
exports.authorizeOwnerOrAdmin = authorizeOwnerOrAdmin;
