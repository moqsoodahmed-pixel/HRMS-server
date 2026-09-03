"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelRequest = exports.rejectRequest = exports.approveRequest = exports.getRequest = exports.listRequests = exports.createRequest = void 0;
const Payroll_1 = require("../models/Payroll");
const Employee_1 = require("../models/Employee");
const NotificationAudit_1 = require("../models/NotificationAudit");
const auditService_1 = require("../services/auditService");
const payrollController_1 = require("./payrollController");
const errorHandler_1 = require("../middleware/errorHandler");
const helpers_1 = require("../utils/helpers");
const roles_1 = require("../utils/roles");
const zod_1 = require("zod");

/**
 * Compensation Change Request workflow.
 *
 * HR_ADMIN (and, for completeness, the platform-administrator tier) may
 * REQUEST a change to an employee's basic salary or allowances. The live
 * SalaryStructure is never touched by a request — only an approval, applied
 * by a COMPENSATION_APPROVER_ROLES member (SUPER_ADMIN/CTO), ever writes to
 * it. This is the backend enforcement point for "HR can request, only
 * SUPER_ADMIN/CTO can approve" — there is no route or code path that lets a
 * request bypass approval, regardless of what the client sends.
 */

const money = zod_1.z.coerce.number().min(0, 'Must be zero or more').max(100000000);

const requestSchema = zod_1.z.object({
    employeeId: zod_1.z.string().min(1, 'Employee is required'),
    proposedBasic: money,
    proposedHra: money.default(0),
    proposedDa: money.default(0),
    proposedSpecialAllowance: money.default(0),
    proposedOtherAllowances: money.default(0),
    reason: zod_1.z.string().min(5, 'Explain the reason for this change'),
});

function round2(n) { return Math.round(n * 100) / 100; }

/** Snapshot of an employee's current active structure, defaulting to zero if none exists yet. */
async function currentCompensation(employeeId) {
    const active = await Payroll_1.SalaryStructure.findOne({ employee: employeeId, isActive: true }).lean();
    const basic = active?.basic || 0;
    const hra = active?.hra || 0;
    const da = active?.da || 0;
    const specialAllowance = active?.specialAllowance || 0;
    const otherAllowances = active?.otherAllowances || 0;
    return {
        active,
        basic, hra, da, specialAllowance, otherAllowances,
        gross: basic + hra + da + specialAllowance + otherAllowances,
        pf: active?.pf || 0, esi: active?.esi || 0, tds: active?.tds || 0, otherDeductions: active?.otherDeductions || 0,
    };
}

const createRequest = async (req, res, next) => {
    try {
        const data = requestSchema.parse(req.body);
        (0, helpers_1.assertObjectId)(data.employeeId, 'employeeId');
        const employee = await Employee_1.Employee.findById(data.employeeId).select('fullName employeeCode user');
        if (!employee) throw new errorHandler_1.AppError('Employee not found', 404, 'NOT_FOUND');

        const current = await currentCompensation(data.employeeId);
        const proposedGross = data.proposedBasic + data.proposedHra + data.proposedDa + data.proposedSpecialAllowance + data.proposedOtherAllowances;
        if (proposedGross === current.gross) {
            throw new errorHandler_1.AppError('The proposed compensation is identical to the current structure', 400, 'NO_CHANGE');
        }
        const existing = await Payroll_1.CompensationRequest.findOne({ employee: data.employeeId, status: 'PENDING' });
        if (existing) throw new errorHandler_1.AppError('There is already a pending compensation request for this employee', 409, 'DUPLICATE');

        const request = await Payroll_1.CompensationRequest.create({
            employee: data.employeeId,
            currentBasic: current.basic, currentHra: current.hra, currentDa: current.da,
            currentSpecialAllowance: current.specialAllowance, currentOtherAllowances: current.otherAllowances,
            currentGross: current.gross,
            proposedBasic: data.proposedBasic, proposedHra: data.proposedHra, proposedDa: data.proposedDa,
            proposedSpecialAllowance: data.proposedSpecialAllowance, proposedOtherAllowances: data.proposedOtherAllowances,
            proposedGross,
            changeAmount: round2(proposedGross - current.gross),
            changePercent: current.gross > 0 ? round2(((proposedGross - current.gross) / current.gross) * 100) : 100,
            reason: data.reason,
            status: 'PENDING',
            requestedBy: req.user?.userId,
        });

        // Notify every platform administrator so the approval queue is discoverable.
        const approvers = await require('../models/User').User.find({ role: { $in: roles_1.COMPENSATION_APPROVER_ROLES }, isActive: true }).select('_id').lean();
        await Promise.all(approvers.map((u) => NotificationAudit_1.Notification.create({
            user: u._id,
            type: 'COMPENSATION_REQUESTED',
            title: 'Compensation change awaiting approval',
            message: `${employee.fullName}: ${current.gross < proposedGross ? 'increase' : 'decrease'} of ₹${Math.abs(round2(proposedGross - current.gross))}.`,
            relatedModel: 'CompensationRequest',
            relatedId: request._id,
        }).catch((err) => console.error('Notification create failed:', err.message))));

        await auditService_1.auditService.log(req, {
            action: 'COMPENSATION_REQUESTED', module: 'PAYROLL',
            recordId: request._id.toString(), recordLabel: employee.fullName,
            newValue: { currentGross: current.gross, proposedGross, reason: data.reason },
        });
        res.status(201).json({ data: request });
    }
    catch (err) { next(err); }
};
exports.createRequest = createRequest;

const listRequests = async (req, res, next) => {
    try {
        const { page, limit, skip } = (0, helpers_1.parsePagination)(req.query, 20);
        const { status, employeeId } = req.query;
        const query = {};
        if (status) query.status = status;
        if (employeeId) {
            (0, helpers_1.assertObjectId)(employeeId, 'employeeId');
            query.employee = employeeId;
        }
        const [requests, total] = await Promise.all([
            Payroll_1.CompensationRequest.find(query)
                .populate('employee', 'fullName employeeCode department designation')
                .populate('requestedBy', 'email role')
                .populate('reviewedBy', 'email role')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Payroll_1.CompensationRequest.countDocuments(query),
        ]);
        res.json({ data: requests, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
    }
    catch (err) { next(err); }
};
exports.listRequests = listRequests;

const getRequest = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'request id');
        const request = await Payroll_1.CompensationRequest.findById(id)
            .populate('employee', 'fullName employeeCode department designation')
            .populate('requestedBy', 'email role')
            .populate('reviewedBy', 'email role');
        if (!request) throw new errorHandler_1.AppError('Compensation request not found', 404, 'NOT_FOUND');
        res.json({ data: request });
    }
    catch (err) { next(err); }
};
exports.getRequest = getRequest;

/**
 * Approves a pending request: applies the proposed figures to a new salary
 * structure (deductions carried forward unchanged from the current one),
 * links the two records, and audits every value that changed.
 */
const approveRequest = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'request id');
        // Belt-and-suspenders: even if a route were ever mis-configured, only an
        // elevated role may apply a compensation change.
        if (!roles_1.isElevated(req.user?.role)) {
            throw new errorHandler_1.AppError('Only a platform administrator can approve a compensation change', 403, 'FORBIDDEN');
        }
        const request = await Payroll_1.CompensationRequest.findById(id).populate('employee', 'fullName employeeCode user');
        if (!request) throw new errorHandler_1.AppError('Compensation request not found', 404, 'NOT_FOUND');
        if (request.status !== 'PENDING') {
            throw new errorHandler_1.AppError(`This request is already ${request.status.toLowerCase()}`, 400, 'INVALID_STATUS');
        }

        const current = await currentCompensation(request.employee._id);
        const structure = await payrollController_1.applySalaryChange({
            employeeId: request.employee._id,
            data: {
                effectiveFrom: new Date().toISOString(),
                basic: request.proposedBasic, hra: request.proposedHra, da: request.proposedDa,
                specialAllowance: request.proposedSpecialAllowance, otherAllowances: request.proposedOtherAllowances,
                pf: current.pf, esi: current.esi, tds: current.tds, otherDeductions: current.otherDeductions,
            },
            actorId: req.user?.userId,
        });

        request.status = 'APPROVED';
        request.reviewedBy = req.user?.userId;
        request.reviewedAt = new Date();
        request.reviewComments = req.body?.comments || undefined;
        request.resultingSalaryStructure = structure._id;
        await request.save();

        if (request.employee.user) {
            await NotificationAudit_1.Notification.create({
                user: request.employee.user,
                type: 'COMPENSATION_APPROVED',
                title: 'Compensation change approved',
                message: `Your compensation change (${request.currentGross} → ${request.proposedGross}) has been approved.`,
                relatedModel: 'CompensationRequest',
                relatedId: request._id,
            }).catch((err) => console.error('Notification create failed:', err.message));
        }
        await NotificationAudit_1.Notification.create({
            user: request.requestedBy,
            type: 'COMPENSATION_APPROVED',
            title: 'Compensation request approved',
            message: `Your request for ${request.employee.fullName} was approved.`,
            relatedModel: 'CompensationRequest',
            relatedId: request._id,
        }).catch((err) => console.error('Notification create failed:', err.message));

        await auditService_1.auditService.log(req, {
            action: 'COMPENSATION_APPROVED', module: 'PAYROLL',
            recordId: request._id.toString(), recordLabel: request.employee.fullName,
            oldValue: { gross: request.currentGross, basic: request.currentBasic },
            newValue: { gross: request.proposedGross, basic: request.proposedBasic, salaryStructureId: structure._id.toString() },
        });
        res.json({ data: request });
    }
    catch (err) { next(err); }
};
exports.approveRequest = approveRequest;

const rejectRequest = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'request id');
        if (!roles_1.isElevated(req.user?.role)) {
            throw new errorHandler_1.AppError('Only a platform administrator can reject a compensation change', 403, 'FORBIDDEN');
        }
        const reason = String(req.body?.comments || req.body?.reason || '').trim();
        if (!reason) throw new errorHandler_1.AppError('A rejection reason is required', 400, 'VALIDATION_ERROR');

        const request = await Payroll_1.CompensationRequest.findById(id).populate('employee', 'fullName');
        if (!request) throw new errorHandler_1.AppError('Compensation request not found', 404, 'NOT_FOUND');
        if (request.status !== 'PENDING') {
            throw new errorHandler_1.AppError(`This request is already ${request.status.toLowerCase()}`, 400, 'INVALID_STATUS');
        }

        request.status = 'REJECTED';
        request.reviewedBy = req.user?.userId;
        request.reviewedAt = new Date();
        request.reviewComments = reason;
        await request.save();

        await NotificationAudit_1.Notification.create({
            user: request.requestedBy,
            type: 'COMPENSATION_REJECTED',
            title: 'Compensation request rejected',
            message: `Your request for ${request.employee.fullName} was rejected: ${reason}`,
            relatedModel: 'CompensationRequest',
            relatedId: request._id,
        }).catch((err) => console.error('Notification create failed:', err.message));

        await auditService_1.auditService.log(req, {
            action: 'COMPENSATION_REJECTED', module: 'PAYROLL',
            recordId: id, recordLabel: request.employee.fullName, newValue: { reason },
        });
        res.json({ data: request, message: 'Compensation request rejected' });
    }
    catch (err) { next(err); }
};
exports.rejectRequest = rejectRequest;

/** A requester (or an admin) may withdraw a request that has not yet been decided. */
const cancelRequest = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'request id');
        const request = await Payroll_1.CompensationRequest.findById(id);
        if (!request) throw new errorHandler_1.AppError('Compensation request not found', 404, 'NOT_FOUND');
        if (request.status !== 'PENDING') {
            throw new errorHandler_1.AppError(`This request is already ${request.status.toLowerCase()}`, 400, 'INVALID_STATUS');
        }
        const isOwner = String(request.requestedBy) === String(req.user?.userId);
        if (!isOwner && !roles_1.isElevated(req.user?.role)) {
            throw new errorHandler_1.AppError('You can only cancel your own requests', 403, 'FORBIDDEN');
        }
        request.status = 'CANCELLED';
        await request.save();
        await auditService_1.auditService.log(req, { action: 'COMPENSATION_CANCELLED', module: 'PAYROLL', recordId: id });
        res.json({ data: request, message: 'Compensation request cancelled' });
    }
    catch (err) { next(err); }
};
exports.cancelRequest = cancelRequest;
