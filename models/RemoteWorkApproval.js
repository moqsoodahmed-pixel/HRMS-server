"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoteWorkApproval = void 0;
const mongoose = require("mongoose");

/**
 * PART 3 — Temporary Remote Work Access. A time-bounded exception that lets
 * a specific employee bypass office geo-fencing (see
 * services/accessControlService.js) between `startDate` and `endDate`
 * inclusive. Granted by HR_ADMIN, PROJECT_HEAD, or an elevated role (see
 * utils/roles.js REMOTE_WORK_APPROVER_ROLES) — CEO/CTO/PROJECT_HEAD never
 * need one themselves, since they're already permanently exempt via
 * DEVICE_LOCATION_EXEMPT_ROLES.
 *
 * "Automatic expiry" per spec is a plain date-range comparison against
 * `new Date()` done at login time (see accessControlService.hasActiveRemoteWorkApproval) —
 * no background job, no separate "expire" cron/write. The moment today's
 * date falls outside [startDate, endDate], the approval simply stops
 * matching and geo-fencing re-applies on the very next login, with nothing
 * to run and nothing that can fail to run. `status` still exists as an
 * explicit manual-revoke lever (HR/admin can flip an approval to REVOKED
 * before its end date without deleting the audit trail), independent of the
 * date-based expiry.
 */
const remoteWorkApprovalSchema = new mongoose.Schema({
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    approvedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['ACTIVE', 'REVOKED'], default: 'ACTIVE', index: true },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    revokedAt: { type: Date },
}, { timestamps: true });

remoteWorkApprovalSchema.index({ employee: 1, status: 1, startDate: 1, endDate: 1 });

// endDate must never be before startDate — validated at the schema level so
// every write path (including any future one) gets this for free.
remoteWorkApprovalSchema.pre('validate', function (next) {
    if (this.startDate && this.endDate && this.endDate < this.startDate) {
        this.invalidate('endDate', 'End date cannot be before start date');
    }
    next();
});

exports.RemoteWorkApproval = mongoose.model('RemoteWorkApproval', remoteWorkApprovalSchema);