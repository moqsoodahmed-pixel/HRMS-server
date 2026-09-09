"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.completeExitRequest = exports.rejectExitRequest = exports.approveExitRequest = exports.cancelExitRequest = exports.getExitRequest = exports.listExitRequests = exports.getMyExitRequests = exports.createExitRequest = void 0;
const { Employee } = require("../models/Employee");
const { ExitRequest } = require("../models/ExitRequest");
const { Notification } = require("../models/NotificationAudit");
const { AppError } = require("../middleware/errorHandler");
const { auditService } = require("../services/auditService");
const { searchRegex } = require("../utils/helpers");
const { seedTemplate } = require("./taskController");
const { z } = require("zod");

/**
 * Employee-initiated exit requests. See models/ExitRequest.js for how this
 * relates to the existing HR-run Offboarding module — approval here drives
 * the exact same Employee fields (dateOfExit/exitReason/status) and the same
 * seedTemplate('offboarding', ...) checklist as taskController.initiateOffboarding.
 */

const createSchema = z.object({
    reason: z.string().min(2, 'Please provide a reason').max(500),
    requestedLastWorkingDate: z.string().min(1, 'Last working date is required'),
    comments: z.string().max(1000).optional().or(z.literal('')),
});

const createExitRequest = async (req, res, next) => {
    try {
        const data = createSchema.parse(req.body);
        const employee = await Employee.findOne({ user: req.user.userId }).select('_id fullName noticePeriodDays');
        if (!employee) throw new AppError('No employee record is linked to your account', 404, 'NOT_FOUND');

        const existing = await ExitRequest.findOne({ employee: employee._id, status: { $in: ['PENDING', 'APPROVED'] } });
        if (existing) throw new AppError('You already have an active exit request', 409, 'ALREADY_EXISTS');

        const request = await ExitRequest.create({
            employee: employee._id,
            requestedBy: req.user.userId,
            reason: data.reason,
            requestedLastWorkingDate: new Date(data.requestedLastWorkingDate),
            comments: data.comments || undefined,
            noticePeriodDays: employee.noticePeriodDays,
        });

        await auditService.log(req, {
            action: 'EXIT_REQUEST_SUBMITTED', module: 'EXIT', recordId: String(request._id), recordLabel: employee.fullName,
        });
        res.status(201).json({ data: request });
    }
    catch (err) { next(err); }
};
exports.createExitRequest = createExitRequest;

/** Employee: their own exit request history (most recent first). */
const getMyExitRequests = async (req, res, next) => {
    try {
        const employee = await Employee.findOne({ user: req.user.userId }).select('_id');
        if (!employee) throw new AppError('No employee record is linked to your account', 404, 'NOT_FOUND');
        const requests = await ExitRequest.find({ employee: employee._id }).sort({ createdAt: -1 }).lean();
        res.json({ data: requests });
    }
    catch (err) { next(err); }
};
exports.getMyExitRequests = getMyExitRequests;

/** HR/Admin: list, optionally filtered by status/department/search. */
const listExitRequests = async (req, res, next) => {
    try {
        const { status, department, search } = req.query;
        const filter = {};
        if (status) filter.status = status;

        if (department || search) {
            const empQuery = {};
            if (department) empQuery.department = department;
            if (search) empQuery.$or = [{ fullName: searchRegex(search) }, { employeeCode: searchRegex(search) }];
            const ids = await Employee.find(empQuery).select('_id').lean();
            filter.employee = { $in: ids.map((i) => i._id) };
        }

        const requests = await ExitRequest.find(filter)
            .populate('employee', 'fullName employeeCode department designation noticePeriodDays')
            .populate('reviewedBy', 'email')
            .sort({ createdAt: -1 })
            .lean();
        res.json({ data: requests });
    }
    catch (err) { next(err); }
};
exports.listExitRequests = listExitRequests;

const getExitRequest = async (req, res, next) => {
    try {
        const request = await ExitRequest.findById(req.params.id)
            .populate('employee', 'fullName employeeCode department designation noticePeriodDays dateOfJoining')
            .populate('reviewedBy', 'email');
        if (!request) throw new AppError('Exit request not found', 404, 'NOT_FOUND');
        res.json({ data: request });
    }
    catch (err) { next(err); }
};
exports.getExitRequest = getExitRequest;

/** Employee: cancel their own still-pending request. */
const cancelExitRequest = async (req, res, next) => {
    try {
        const employee = await Employee.findOne({ user: req.user.userId }).select('_id');
        if (!employee) throw new AppError('No employee record is linked to your account', 404, 'NOT_FOUND');
        const request = await ExitRequest.findOne({ _id: req.params.id, employee: employee._id });
        if (!request) throw new AppError('Exit request not found', 404, 'NOT_FOUND');
        if (request.status !== 'PENDING') throw new AppError('Only a pending request can be cancelled', 400, 'INVALID_STATUS');

        request.status = 'CANCELLED';
        await request.save();
        await auditService.log(req, { action: 'EXIT_REQUEST_CANCELLED', module: 'EXIT', recordId: String(request._id) });
        res.json({ data: request });
    }
    catch (err) { next(err); }
};
exports.cancelExitRequest = cancelExitRequest;

/** Throws if the reviewer's own linked employee record is the one under review. */
async function assertNotSelfReview(req, targetEmployeeId) {
    const own = await Employee.findOne({ user: req.user.userId }).select('_id').lean();
    if (own && String(own._id) === String(targetEmployeeId)) {
        throw new AppError('You cannot approve or reject your own exit request', 403, 'SELF_REVIEW_FORBIDDEN');
    }
}

const approveExitRequest = async (req, res, next) => {
    try {
        const request = await ExitRequest.findById(req.params.id);
        if (!request) throw new AppError('Exit request not found', 404, 'NOT_FOUND');
        if (request.status !== 'PENDING') throw new AppError('This request has already been reviewed', 400, 'ALREADY_REVIEWED');
        await assertNotSelfReview(req, request.employee);

        const employee = await Employee.findById(request.employee);
        if (!employee) throw new AppError('Employee not found', 404, 'NOT_FOUND');

        // Exactly the same fields/checklist-seeding as the existing HR-initiated
        // taskController.initiateOffboarding — approval here is the employee-
        // requested path onto that same mechanism, not a second one.
        employee.dateOfExit = request.requestedLastWorkingDate;
        employee.exitReason = request.reason;
        employee.status = 'NOTICE_PERIOD';
        await employee.save();
        const tasksCreated = await seedTemplate('offboarding', employee, employee.dateOfExit);

        request.status = 'APPROVED';
        request.reviewedBy = req.user.userId;
        request.reviewedAt = new Date();
        await request.save();

        if (employee.user) {
            await Notification.create({
                user: employee.user, type: 'EXIT_REQUEST_APPROVED', title: 'Exit request approved',
                message: `Your exit request has been approved. Last working day: ${employee.dateOfExit.toLocaleDateString('en-IN')}.`,
                relatedModel: 'Employee', relatedId: employee._id,
            }).catch((e) => console.error('Notification create failed:', e.message));
        }
        await auditService.log(req, {
            action: 'EXIT_REQUEST_APPROVED', module: 'EXIT', recordId: String(request._id),
            recordLabel: employee.fullName, newValue: { dateOfExit: employee.dateOfExit, tasksCreated },
        });
        res.json({ data: request });
    }
    catch (err) { next(err); }
};
exports.approveExitRequest = approveExitRequest;

const rejectSchema = z.object({ reason: z.string().min(1, 'A rejection reason is required').max(500) });

const rejectExitRequest = async (req, res, next) => {
    try {
        const { reason } = rejectSchema.parse(req.body);
        const request = await ExitRequest.findById(req.params.id);
        if (!request) throw new AppError('Exit request not found', 404, 'NOT_FOUND');
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
                user: employee.user, type: 'EXIT_REQUEST_REJECTED', title: 'Exit request rejected', message: reason,
                relatedModel: 'Employee', relatedId: employee._id,
            }).catch((e) => console.error('Notification create failed:', e.message));
        }
        await auditService.log(req, { action: 'EXIT_REQUEST_REJECTED', module: 'EXIT', recordId: String(request._id), recordLabel: employee?.fullName });
        res.json({ data: request });
    }
    catch (err) { next(err); }
};
exports.rejectExitRequest = rejectExitRequest;

/** HR/Admin: confirm the exit is fully processed. Does not archive the account — see archiveEmployee for that separate, existing action. */
const completeExitRequest = async (req, res, next) => {
    try {
        const request = await ExitRequest.findById(req.params.id);
        if (!request) throw new AppError('Exit request not found', 404, 'NOT_FOUND');
        if (request.status !== 'APPROVED') throw new AppError('Only an approved exit can be marked complete', 400, 'INVALID_STATUS');
        await assertNotSelfReview(req, request.employee);

        request.status = 'COMPLETED';
        request.completedAt = new Date();
        await request.save();

        const employee = await Employee.findById(request.employee).select('fullName status');
        if (employee && employee.status !== 'INACTIVE') {
            employee.status = 'INACTIVE';
            await employee.save();
        }
        await auditService.log(req, { action: 'EXIT_REQUEST_COMPLETED', module: 'EXIT', recordId: String(request._id), recordLabel: employee?.fullName });
        res.json({ data: request });
    }
    catch (err) { next(err); }
};
exports.completeExitRequest = completeExitRequest;
