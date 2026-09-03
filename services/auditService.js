"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditService = void 0;
const NotificationAudit_1 = require("../models/NotificationAudit");
exports.auditService = {
    async log(req, options) {
        try {
            const authReq = req;
            await NotificationAudit_1.AuditLog.create({
                userId: authReq.user?.userId,
                userEmail: authReq.user?.email,
                action: options.action,
                module: options.module,
                recordId: options.recordId,
                recordLabel: options.recordLabel,
                oldValue: options.oldValue,
                newValue: options.newValue,
                ipAddress: req.ip || req.socket?.remoteAddress,
                userAgent: req.headers['user-agent'],
            });
        }
        catch (err) {
            // Log failures should never crash the main operation
            console.error('Audit log failed:', err);
        }
    },
};
//# sourceMappingURL=auditService.js.map