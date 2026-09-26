"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unlockAccount = exports.lockAccount = exports.listLockedAccounts = exports.searchAccounts = void 0;
const { z } = require("zod");
const { User } = require("../models/User");
const { Employee } = require("../models/Employee");
const { AppError } = require("../middleware/errorHandler");
const { auditService } = require("../services/auditService");
const { isElevated } = require("../utils/roles");

/**
 * Manual account lock/unlock — lets HR, CTO, PROJECT_HEAD and FOUNDER_CEO
 * (see routes/index.js ACCOUNT_ACCESS = HR_ROLES, and utils/roles.js
 * HR_ROLES = ELEVATED_ROLES [FOUNDER_CEO, CTO, SUPER_ADMIN] + HR_ADMIN +
 * PROJECT_HEAD — exactly the "HR, CTO, Project Head and CEO" set) either
 * restore access to an account the automatic 5-failed-attempts lockout
 * (controllers/authController.js login()) has temporarily locked, or
 * deliberately lock an account themselves (e.g. a lost device, an employee
 * under investigation, an account they suspect is compromised).
 *
 * This is deliberately separate from the day-to-day RBAC in utils/roles.js —
 * it does not grant these roles any new route permission, only the ability
 * to flip one account's `lockedUntil`/`failedLoginAttempts` — and separate
 * from Employee.status/User.isActive (offboarding/deactivation, see
 * employeeController.js), which is a permanent, different kind of "this
 * person can no longer sign in at all".
 */

// A manual lock has no fixed 30-minute expiry like the automatic one — it
// stays locked until an admin explicitly unlocks it. Modeled as a far-future
// `lockedUntil` (rather than a separate boolean) so the existing
// `lockedUntil > now` check in authController.login() needs no change at
// all to also honor manual locks.
const MANUAL_LOCK_UNTIL = new Date('2099-12-31T23:59:59.999Z');

const lockSchema = z.object({
    reason: z.string().trim().max(500).optional(),
});

/**
 * Lists every account currently locked — automatically (5 failed attempts)
 * or manually — so HR/CTO/Project Head/CEO have one place to see and act on
 * them, instead of only discovering a lockout when the affected employee
 * reports it.
 */
const listLockedAccounts = async (req, res, next) => {
    try {
        const users = await User.find({ lockedUntil: { $gt: new Date() } })
            .select('email role isActive lockedUntil failedLoginAttempts lockReason lockedBy employee')
            .populate('employee', 'fullName employeeCode department designation')
            .populate('lockedBy', 'email')
            .sort({ lockedUntil: -1 })
            .lean();
        const data = users.map((u) => ({
            ...u,
            manuallyLocked: Boolean(u.lockReason || u.lockedBy),
        }));
        res.json({ data });
    }
    catch (err) { next(err); }
};
exports.listLockedAccounts = listLockedAccounts;

/**
 * Company-wide employee search for the "lock an account" picker, unscoped
 * by department/team (unlike GET /employees, see remoteWorkController.js
 * searchEmployeesForApproval for the identical reasoning) and returning each
 * employee's linked `user` id so the frontend can call lockAccount(userId)
 * directly. Gated to the same ACCOUNT_ACCESS roles at the route level.
 */
const searchAccounts = async (req, res, next) => {
    try {
        const search = String(req.query.search || '').trim();
        if (search.length < 2) { res.json({ data: [] }); return; }
        const { searchRegex } = require('../utils/helpers');
        const employees = await Employee.find({
            isArchived: false,
            $or: [
                { fullName: searchRegex(search) },
                { employeeCode: searchRegex(search) },
            ],
        })
            .select('fullName employeeCode department designation user')
            .populate('user', 'email role isActive lockedUntil')
            .sort({ fullName: 1 })
            .limit(20)
            .lean();
        res.json({ data: employees.filter((e) => e.user) });
    }
    catch (err) { next(err); }
};
exports.searchAccounts = searchAccounts;

/**
 * Deliberately locks an account, effective immediately. Two safety rails
 * (mirroring the separation-of-duties pattern already used for compensation
 * approval and permanent employee delete elsewhere in this codebase):
 *   - you can never lock your own account (avoids an admin accidentally
 *     locking themselves out with no one else signed in to undo it)
 *   - a non-elevated grantor (HR_ADMIN/PROJECT_HEAD) can never lock an
 *     elevated (FOUNDER_CEO/CTO/SUPER_ADMIN) account — only another
 *     elevated account can do that.
 */
const lockAccount = async (req, res, next) => {
    try {
        const { reason } = lockSchema.parse(req.body || {});
        const target = await User.findById(req.params.userId);
        if (!target) throw new AppError('User not found', 404, 'NOT_FOUND');
        if (String(target._id) === String(req.user.userId)) {
            throw new AppError('You cannot lock your own account', 400, 'VALIDATION_ERROR');
        }
        if (isElevated(target.role) && !isElevated(req.user.role)) {
            throw new AppError('Only a CEO/CTO-level account can lock another CEO/CTO-level account', 403, 'FORBIDDEN');
        }

        target.lockedUntil = MANUAL_LOCK_UNTIL;
        target.lockReason = reason || undefined;
        target.lockedBy = req.user.userId;
        await target.save();

        await auditService.log(req, {
            action: 'ACCOUNT_LOCKED_MANUALLY',
            module: 'SECURITY',
            recordId: String(target._id),
            recordLabel: target.email,
            newValue: { reason: reason || null },
        });
        res.json({ data: { id: target._id, lockedUntil: target.lockedUntil, lockReason: target.lockReason } });
    }
    catch (err) { next(err); }
};
exports.lockAccount = lockAccount;

/**
 * Restores access to a locked account — clears both the automatic-lockout
 * fields (failedLoginAttempts/lockedUntil) and the manual-lock fields
 * (lockReason/lockedBy) at once, since from the affected employee's side
 * "I'm locked out" looks the same either way and this is the one action
 * that should always fix it.
 */
const unlockAccount = async (req, res, next) => {
    try {
        const target = await User.findById(req.params.userId);
        if (!target) throw new AppError('User not found', 404, 'NOT_FOUND');

        target.lockedUntil = undefined;
        target.failedLoginAttempts = 0;
        target.lockReason = undefined;
        target.lockedBy = undefined;
        await target.save();

        await auditService.log(req, {
            action: 'ACCOUNT_UNLOCKED',
            module: 'SECURITY',
            recordId: String(target._id),
            recordLabel: target.email,
        });
        res.json({ data: { id: target._id, lockedUntil: null } });
    }
    catch (err) { next(err); }
};
exports.unlockAccount = unlockAccount;