"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorizeOwnerOrAdmin = exports.authorize = exports.authenticate = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const { isElevated } = require("../utils/roles");
const { AUTH_COOKIE_NAME } = require("../utils/cookieConfig");
const { User } = require("../models/User");

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

const authenticate = async (req, res, next) => {
    const token = req.cookies?.[AUTH_COOKIE_NAME] || req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
        logAuthFailure(req, { tokenPresent: false });
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
        return;
    }
    try {
        const payload = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        // Re-read this account's CURRENT role (and active state) from the
        // database on every request instead of trusting whatever role was
        // baked into the JWT back when the person logged in. Without this,
        // promoting someone (e.g. Employee -> HR Admin, or granting a
        // Sales Lead their team access) had no effect until they happened
        // to log out and back in — every request in between kept using the
        // stale role from the old token and authorize() below rejected them
        // with "You do not have permission to perform this action" even
        // though the database already had the correct role. Same
        // "never trust the client/token for this" principle as
        // requireOnboardingApproved()'s DB read further down this file.
        const account = await User.findById(payload.userId).select('role isActive').lean();
        if (!account || !account.isActive) {
            res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'This account is no longer active' } });
            return;
        }
        req.user = { ...payload, role: account.role };
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