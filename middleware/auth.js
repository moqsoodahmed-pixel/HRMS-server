"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorizeOwnerOrAdmin = exports.authorize = exports.authenticate = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const { isElevated } = require("../utils/roles");

const authenticate = (req, res, next) => {
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
        return;
    }
    try {
        const payload = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        req.user = payload;
        next();
    }
    catch {
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
