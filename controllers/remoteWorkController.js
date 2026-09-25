"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.revokeApproval = exports.listApprovals = exports.createApproval = void 0;
const { Employee } = require("../models/Employee");
const { RemoteWorkApproval } = require("../models/RemoteWorkApproval");
const { AppError } = require("../middleware/errorHandler");
const { auditService } = require("../services/auditService");
const { startOfDay } = require("../utils/helpers");
const { z } = require("zod");

/**
 * PART 3 — Temporary Remote Work Access. Grantors (HR_ADMIN, PROJECT_HEAD,
 * or elevated — see routes/index.js `REMOTE_WORK` and utils/roles.js
 * REMOTE_WORK_APPROVER_ROLES) create a time-bounded exception here; it is
 * consumed by services/accessControlService.hasActiveRemoteWorkApproval()
 * at login time. See models/RemoteWorkApproval.js for the expiry model
 * (plain date comparison, no background job).
 */

const createSchema = z.object({
    employeeId: z.string().min(1, 'Employee is required'),
    startDate: z.string().min(1, 'Start date is required'),
    endDate: z.string().min(1, 'End date is required'),
    reason: z.string().min(1, 'A reason is required').max(500),
});

const createApproval = async (req, res, next) => {
    try {
        const data = createSchema.parse(req.body);
        const employee = await Employee.findById(data.employeeId).select('_id fullName employeeCode');
        if (!employee) throw new AppError('Employee not found', 404, 'NOT_FOUND');

        const startDate = startOfDay(data.startDate);
        const endDate = startOfDay(data.endDate);
        if (endDate < startDate) {
            throw new AppError('End date cannot be before start date', 400, 'VALIDATION_ERROR');
        }

        const approval = await RemoteWorkApproval.create({
            employee: employee._id,
            startDate,
            endDate,
            reason: data.reason,
            approvedBy: req.user.userId,
            approvedAt: new Date(),
            status: 'ACTIVE',
        });

        await auditService.log(req, {
            action: 'REMOTE_WORK_APPROVED',
            module: 'SECURITY',
            recordId: String(approval._id),
            recordLabel: employee.fullName,
            newValue: { employeeId: String(employee._id), startDate, endDate, reason: data.reason },
        });

        res.status(201).json({ data: approval });
    }
    catch (err) { next(err); }
};
exports.createApproval = createApproval;

/**
 * Lists remote-work approvals. Grantor roles (HR_ADMIN, PROJECT_HEAD,
 * elevated — see routes/index.js REMOTE_WORK_APPROVER) may see anyone's
 * approvals and filter by `employeeId`; every other authenticated user is
 * force-scoped to their own linked Employee record regardless of what
 * `employeeId` they pass — never trusting a client-supplied filter for who
 * else's remote-work records (which include a free-text reason) they can see.
 */
const listApprovals = async (req, res, next) => {
    try {
        const { isElevated } = require('../utils/roles');
        const { REMOTE_WORK_APPROVER_ROLES } = require('../utils/roles');
        const canSeeAll = isElevated(req.user.role) || REMOTE_WORK_APPROVER_ROLES.includes(req.user.role);

        const filter = {};
        if (canSeeAll) {
            if (req.query.employeeId) filter.employee = req.query.employeeId;
        } else {
            const self = await Employee.findOne({ user: req.user.userId }).select('_id');
            filter.employee = self ? self._id : null; // null → matches nothing rather than everything
        }
        if (req.query.status) filter.status = req.query.status;

        const approvals = await RemoteWorkApproval.find(filter)
            .populate('employee', 'fullName employeeCode department')
            .populate('approvedBy', 'email')
            .sort({ createdAt: -1 })
            .limit(200);
        res.json({ data: approvals });
    }
    catch (err) { next(err); }
};
exports.listApprovals = listApprovals;

/**
 * Company-wide employee search for the Remote Work Access picker.
 *
 * BUGFIX: the picker in Settings.jsx used to call the general
 * GET /employees endpoint, whose results are scoped by
 * utils/helpers.resolveEmployeeScope() — for a PROJECT_HEAD (a
 * TEAM_SCOPED role) that scope is silently narrowed to "self + direct
 * reports only" (the `managerCompanyWide` special-case there only covers
 * the MANAGER role, not PROJECT_HEAD). A Project Head granting remote
 * work access would then only ever see their own reports in the search
 * results, which looked like "some employee details are not showing" —
 * the records weren't missing, the search was quietly filtered.
 *
 * This endpoint is a separate, unscoped search used ONLY for the
 * remote-work picker, and is itself gated to REMOTE_WORK_APPROVER_ROLES
 * at the route level (routes/index.js) — the same roles who are already
 * allowed to grant/revoke remote work for any employee, so widening the
 * search here does not expose anyone who couldn't already be granted an
 * exception by this same caller.
 */
const searchEmployeesForApproval = async (req, res, next) => {
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
            .select('fullName employeeCode department designation')
            .sort({ fullName: 1 })
            .limit(20)
            .lean();
        res.json({ data: employees });
    }
    catch (err) { next(err); }
};
exports.searchEmployeesForApproval = searchEmployeesForApproval;

/** Manually ends an approval before its end date (independent of automatic date-based expiry). */
const revokeApproval = async (req, res, next) => {
    try {
        const approval = await RemoteWorkApproval.findById(req.params.id);
        if (!approval) throw new AppError('Approval not found', 404, 'NOT_FOUND');
        if (approval.status === 'REVOKED') {
            res.json({ data: approval });
            return;
        }
        approval.status = 'REVOKED';
        approval.revokedBy = req.user.userId;
        approval.revokedAt = new Date();
        await approval.save();

        await auditService.log(req, {
            action: 'REMOTE_WORK_REVOKED', module: 'SECURITY', recordId: String(approval._id),
        });
        res.json({ data: approval });
    }
    catch (err) { next(err); }
};
exports.revokeApproval = revokeApproval;