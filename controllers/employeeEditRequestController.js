"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rejectEditRequest = exports.approveEditRequest = exports.getEditRequest = exports.listEditRequests = exports.createEditRequest = void 0;
const { Employee } = require("../models/Employee");
const { EmployeeEditRequest } = require("../models/EmployeeEditRequest");
const { Notification } = require("../models/NotificationAudit");
const { AppError } = require("../middleware/errorHandler");
const { auditService } = require("../services/auditService");
const { z } = require("zod");

/**
 * Minimal employee self-service "request a profile change" flow — this did
 * not exist in the codebase before this step. Deliberately scoped to a small,
 * low-risk set of fields; anything more sensitive (salary, designation,
 * department, employment status) still requires HR to use the existing
 * employeeController.updateEmployee directly.
 */
const ALLOWED_FIELDS = ['personalEmail', 'personalMobile', 'workLocation'];

const changeSchema = z.object(
    Object.fromEntries(ALLOWED_FIELDS.map((f) => [f, z.string().max(120).optional().or(z.literal(''))])),
).refine((data) => ALLOWED_FIELDS.some((f) => data[f] !== undefined), {
    message: `At least one of ${ALLOWED_FIELDS.join(', ')} is required`,
});

const rejectSchema = z.object({ reason: z.string().min(1, 'A rejection reason is required').max(500) });

function projectRequest(doc) {
    return doc;
}

const createEditRequest = async (req, res, next) => {
    try {
        const data = changeSchema.parse(req.body);
        const changes = Object.fromEntries(ALLOWED_FIELDS.filter((f) => data[f] !== undefined).map((f) => [f, data[f]]));

        const employee = await Employee.findOne({ user: req.user.userId }).select('_id fullName');
        if (!employee) throw new AppError('No employee record is linked to your account', 404, 'NOT_FOUND');

        const request = await EmployeeEditRequest.create({
            employee: employee._id,
            requestedBy: req.user.userId,
            changes,
        });

        await auditService.log(req, {
            action: 'EDIT_REQUEST_SUBMITTED', module: 'EMPLOYEES',
            recordId: String(request._id), recordLabel: employee.fullName,
        });

        res.status(201).json({ data: projectRequest(request) });
    }
    catch (err) { next(err); }
};
exports.createEditRequest = createEditRequest;

/** HR/Admin: list edit requests, optionally filtered by status. */
const listEditRequests = async (req, res, next) => {
    try {
        const filter = {};
        if (req.query.status) filter.status = req.query.status;
        const requests = await EmployeeEditRequest.find(filter)
            .populate('employee', 'fullName employeeCode department designation personalEmail personalMobile workLocation')
            .populate('requestedBy', 'email')
            .populate('reviewedBy', 'email')
            .sort({ createdAt: -1 })
            .lean();
        res.json({ data: requests });
    }
    catch (err) { next(err); }
};
exports.listEditRequests = listEditRequests;

const getEditRequest = async (req, res, next) => {
    try {
        const request = await EmployeeEditRequest.findById(req.params.id)
            .populate('employee', 'fullName employeeCode department designation personalEmail personalMobile workLocation')
            .populate('requestedBy', 'email')
            .populate('reviewedBy', 'email');
        if (!request) throw new AppError('Edit request not found', 404, 'NOT_FOUND');
        res.json({ data: request });
    }
    catch (err) { next(err); }
};
exports.getEditRequest = getEditRequest;

/** Throws if the reviewer's own linked employee record is the one under review — nobody approves their own request. */
async function assertNotSelfReview(req, targetEmployeeId) {
    const own = await Employee.findOne({ user: req.user.userId }).select('_id').lean();
    if (own && String(own._id) === String(targetEmployeeId)) {
        throw new AppError('You cannot approve or reject your own request', 403, 'SELF_REVIEW_FORBIDDEN');
    }
}

const approveEditRequest = async (req, res, next) => {
    try {
        const request = await EmployeeEditRequest.findById(req.params.id);
        if (!request) throw new AppError('Edit request not found', 404, 'NOT_FOUND');
        if (request.status !== 'PENDING') throw new AppError('This request has already been reviewed', 400, 'ALREADY_REVIEWED');
        await assertNotSelfReview(req, request.employee);

        const employee = await Employee.findById(request.employee);
        if (!employee) throw new AppError('Employee not found', 404, 'NOT_FOUND');
        ALLOWED_FIELDS.forEach((f) => {
            if (request.changes[f] !== undefined) employee[f] = request.changes[f];
        });
        await employee.save();

        request.status = 'APPROVED';
        request.reviewedBy = req.user.userId;
        request.reviewedAt = new Date();
        await request.save();

        if (employee.user) {
            await Notification.create({
                user: employee.user,
                type: 'EDIT_REQUEST_APPROVED',
                title: 'Profile update approved',
                message: 'Your requested profile changes have been applied.',
                relatedModel: 'Employee',
                relatedId: employee._id,
            }).catch((err) => console.error('Notification create failed:', err.message));
        }
        await auditService.log(req, {
            action: 'EDIT_REQUEST_APPROVED', module: 'EMPLOYEES',
            recordId: String(request._id), recordLabel: employee.fullName, newValue: request.changes,
        });

        res.json({ data: request });
    }
    catch (err) { next(err); }
};
exports.approveEditRequest = approveEditRequest;

const rejectEditRequest = async (req, res, next) => {
    try {
        const { reason } = rejectSchema.parse(req.body);
        const request = await EmployeeEditRequest.findById(req.params.id);
        if (!request) throw new AppError('Edit request not found', 404, 'NOT_FOUND');
        if (request.status !== 'PENDING') throw new AppError('This request has already been reviewed', 400, 'ALREADY_REVIEWED');
        await assertNotSelfReview(req, request.employee);

        request.status = 'REJECTED';
        request.rejectionReason = reason;
        request.reviewedBy = req.user.userId;
        request.reviewedAt = new Date();
        await request.save();

        const employee = await Employee.findById(request.employee).select('fullName user');
        if (employee?.user) {
            await Notification.create({
                user: employee.user,
                type: 'EDIT_REQUEST_REJECTED',
                title: 'Profile update rejected',
                message: reason,
                relatedModel: 'Employee',
                relatedId: employee._id,
            }).catch((err) => console.error('Notification create failed:', err.message));
        }
        await auditService.log(req, {
            action: 'EDIT_REQUEST_REJECTED', module: 'EMPLOYEES',
            recordId: String(request._id), recordLabel: employee?.fullName,
        });

        res.json({ data: request });
    }
    catch (err) { next(err); }
};
exports.rejectEditRequest = rejectEditRequest;
