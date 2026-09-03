"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAuditFilters = exports.getAuditLog = exports.getAuditLogs = exports.markAllRead = exports.markNotificationRead = exports.getNotifications = void 0;
const NotificationAudit_1 = require("../models/NotificationAudit");
const errorHandler_1 = require("../middleware/errorHandler");
const helpers_1 = require("../utils/helpers");

const getNotifications = async (req, res, next) => {
    try {
        const { page, limit, skip } = (0, helpers_1.parsePagination)(req.query, 20, 50);
        const query = { user: req.user?.userId };
        if (req.query.unreadOnly === 'true') query.isRead = false;

        const [notifications, total, unreadCount] = await Promise.all([
            NotificationAudit_1.Notification.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            NotificationAudit_1.Notification.countDocuments(query),
            NotificationAudit_1.Notification.countDocuments({ user: req.user?.userId, isRead: false }),
        ]);
        res.json({
            data: notifications,
            meta: { total, page, limit, totalPages: Math.ceil(total / limit), unreadCount },
        });
    }
    catch (err) { next(err); }
};
exports.getNotifications = getNotifications;

const markNotificationRead = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'notification id');
        // Scoped by user so one account can never mark another's notification read.
        const notification = await NotificationAudit_1.Notification.findOneAndUpdate({ _id: id, user: req.user?.userId }, { isRead: true, readAt: new Date() }, { new: true });
        if (!notification) throw new errorHandler_1.AppError('Notification not found', 404, 'NOT_FOUND');
        res.json({ data: notification });
    }
    catch (err) { next(err); }
};
exports.markNotificationRead = markNotificationRead;

const markAllRead = async (req, res, next) => {
    try {
        const result = await NotificationAudit_1.Notification.updateMany({ user: req.user?.userId, isRead: false }, { isRead: true, readAt: new Date() });
        res.json({ message: 'All notifications marked as read', data: { updated: result.modifiedCount } });
    }
    catch (err) { next(err); }
};
exports.markAllRead = markAllRead;

// ---------------------------------------------------------------------------
// Audit log — read-only by design. There is deliberately no create/update/delete
// route: the model itself also refuses updates and deletes.
// ---------------------------------------------------------------------------

const getAuditLogs = async (req, res, next) => {
    try {
        const { page, limit, skip } = (0, helpers_1.parsePagination)(req.query, 50, 200);
        const { module, action, userId, userEmail, search, startDate, endDate } = req.query;

        const query = {};
        if (module) query.module = module;
        if (action) query.action = action;
        if (userId) {
            (0, helpers_1.assertObjectId)(userId, 'userId');
            query.userId = userId;
        }
        if (userEmail) query.userEmail = (0, helpers_1.searchRegex)(userEmail);
        const range = (0, helpers_1.dateRangeQuery)(startDate, endDate);
        if (range) query.createdAt = range;
        if (search) {
            query.$or = [
                { recordLabel: (0, helpers_1.searchRegex)(search) },
                { recordId: (0, helpers_1.searchRegex)(search) },
                { userEmail: (0, helpers_1.searchRegex)(search) },
                { action: (0, helpers_1.searchRegex)(search) },
            ];
        }

        const [logs, total] = await Promise.all([
            NotificationAudit_1.AuditLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            NotificationAudit_1.AuditLog.countDocuments(query),
        ]);
        res.json({ data: logs, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
    }
    catch (err) { next(err); }
};
exports.getAuditLogs = getAuditLogs;

const getAuditLog = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'audit log id');
        const log = await NotificationAudit_1.AuditLog.findById(id).lean();
        if (!log) throw new errorHandler_1.AppError('Audit entry not found', 404, 'NOT_FOUND');
        res.json({ data: log });
    }
    catch (err) { next(err); }
};
exports.getAuditLog = getAuditLog;

/** Distinct values so the audit filters offer only what actually exists. */
const getAuditFilters = async (_req, res, next) => {
    try {
        const [modules, actions, users] = await Promise.all([
            NotificationAudit_1.AuditLog.distinct('module'),
            NotificationAudit_1.AuditLog.distinct('action'),
            NotificationAudit_1.AuditLog.distinct('userEmail'),
        ]);
        res.json({
            data: {
                modules: modules.filter(Boolean).sort(),
                actions: actions.filter(Boolean).sort(),
                users: users.filter(Boolean).sort(),
            },
        });
    }
    catch (err) { next(err); }
};
exports.getAuditFilters = getAuditFilters;
