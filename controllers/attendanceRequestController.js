"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rejectRequest = exports.approveRequest = exports.getRequest = exports.listRequests = exports.createRequest = void 0;
const { Employee } = require("../models/Employee");
const { Attendance } = require("../models/Attendance");
const { AttendanceRequest } = require("../models/AttendanceRequest");
const { Notification } = require("../models/NotificationAudit");
const { AppError } = require("../middleware/errorHandler");
const { auditService } = require("../services/auditService");
const { startOfDay, searchRegex } = require("../utils/helpers");
const { z } = require("zod");

/** See models/AttendanceRequest.js for why this minimal flow exists. */

const createSchema = z.object({
    type: z.enum(['CORRECTION', 'UNLOCK']),
    date: z.string().min(1, 'Date is required'),
    reason: z.string().min(1, 'A reason is required').max(500),
    requestedCheckIn: z.string().optional().or(z.literal('')),
    requestedCheckOut: z.string().optional().or(z.literal('')),
    requestedStatus: z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'WORK_FROM_HOME', 'ON_LEAVE']).optional(),
});

const createRequest = async (req, res, next) => {
    try {
        const data = createSchema.parse(req.body);
        const employee = await Employee.findOne({ user: req.user.userId }).select('_id fullName');
        if (!employee) throw new AppError('No employee record is linked to your account', 404, 'NOT_FOUND');

        const request = await AttendanceRequest.create({
            employee: employee._id,
            requestedBy: req.user.userId,
            type: data.type,
            date: startOfDay(data.date),
            reason: data.reason,
            requestedCheckIn: data.requestedCheckIn || undefined,
            requestedCheckOut: data.requestedCheckOut || undefined,
            requestedStatus: data.requestedStatus,
        });

        await auditService.log(req, {
            action: 'ATTENDANCE_REQUEST_SUBMITTED', module: 'ATTENDANCE',
            recordId: String(request._id), recordLabel: employee.fullName,
        });
        res.status(201).json({ data: request });
    }
    catch (err) { next(err); }
};
exports.createRequest = createRequest;

/** HR/Admin: list requests, optionally filtered by status/type/department/search. */
const listRequests = async (req, res, next) => {
    try {
        const { status, type, department, search } = req.query;
        const filter = {};
        if (status) filter.status = status;
        if (type) filter.type = type;

        if (department || search) {
            const empQuery = { isArchived: false };
            if (department) empQuery.department = department;
            if (search) {
                empQuery.$or = [{ fullName: searchRegex(search) }, { employeeCode: searchRegex(search) }];
            }
            const ids = await Employee.find(empQuery).select('_id').lean();
            filter.employee = { $in: ids.map((i) => i._id) };
        }

        const requests = await AttendanceRequest.find(filter)
            .populate('employee', 'fullName employeeCode department designation')
            .populate('reviewedBy', 'email')
            .sort({ createdAt: -1 })
            .lean();
        res.json({ data: requests });
    }
    catch (err) { next(err); }
};
exports.listRequests = listRequests;

const getRequest = async (req, res, next) => {
    try {
        const request = await AttendanceRequest.findById(req.params.id)
            .populate('employee', 'fullName employeeCode department designation')
            .populate('reviewedBy', 'email');
        if (!request) throw new AppError('Request not found', 404, 'NOT_FOUND');
        res.json({ data: request });
    }
    catch (err) { next(err); }
};
exports.getRequest = getRequest;

/** Throws if the reviewer's own linked employee record is the one under review. */
async function assertNotSelfReview(req, targetEmployeeId) {
    const own = await Employee.findOne({ user: req.user.userId }).select('_id').lean();
    if (own && String(own._id) === String(targetEmployeeId)) {
        throw new AppError('You cannot approve or reject your own request', 403, 'SELF_REVIEW_FORBIDDEN');
    }
}

function combineDateTime(day, value) {
    if (!value) return undefined;
    const [h, m] = String(value).split(':');
    const d = new Date(day);
    d.setHours(parseInt(h, 10) || 0, parseInt(m, 10) || 0, 0, 0);
    return d;
}

const approveRequest = async (req, res, next) => {
    try {
        const request = await AttendanceRequest.findById(req.params.id);
        if (!request) throw new AppError('Request not found', 404, 'NOT_FOUND');
        if (request.status !== 'PENDING') throw new AppError('This request has already been reviewed', 400, 'ALREADY_REVIEWED');
        await assertNotSelfReview(req, request.employee);

        const employee = await Employee.findById(request.employee).select('fullName user');
        if (!employee) throw new AppError('Employee not found', 404, 'NOT_FOUND');

        // CORRECTION approval writes straight to the existing Attendance model —
        // the exact same record checkIn/checkOut/checkout write to, never a
        // parallel store. UNLOCK approval intentionally does not touch
        // Attendance; HR still edits by hand via the existing, audited
        // updateAttendance endpoint afterwards.
        if (request.type === 'CORRECTION') {
            const day = startOfDay(request.date);
            let record = await Attendance.findOne({ employee: request.employee, date: day });
            if (!record) record = new Attendance({ employee: request.employee, date: day });
            if (request.requestedStatus) record.status = request.requestedStatus;
            if (request.requestedCheckIn) record.checkIn = combineDateTime(day, request.requestedCheckIn);
            if (request.requestedCheckOut) record.checkOut = combineDateTime(day, request.requestedCheckOut);
            if (record.checkIn && record.checkOut) {
                record.workHours = Math.round(((record.checkOut.getTime() - record.checkIn.getTime()) / 3600000) * 100) / 100;
            }
            record.editedBy = req.user.userId;
            record.editedAt = new Date();
            record.editReason = `Approved attendance correction request (${request._id})`;
            await record.save();
        }

        request.status = 'APPROVED';
        request.reviewedBy = req.user.userId;
        request.reviewedAt = new Date();
        await request.save();

        if (employee.user) {
            await Notification.create({
                user: employee.user, type: 'ATTENDANCE_REQUEST_APPROVED',
                title: 'Attendance request approved',
                message: request.type === 'CORRECTION' ? 'Your attendance correction has been applied.' : 'Your unlock request has been approved.',
                relatedModel: 'Employee', relatedId: employee._id,
            }).catch((err) => console.error('Notification create failed:', err.message));
        }
        await auditService.log(req, {
            action: 'ATTENDANCE_REQUEST_APPROVED', module: 'ATTENDANCE',
            recordId: String(request._id), recordLabel: employee.fullName,
        });
        res.json({ data: request });
    }
    catch (err) { next(err); }
};
exports.approveRequest = approveRequest;

const rejectSchema = z.object({ reason: z.string().min(1, 'A rejection reason is required').max(500) });

const rejectRequest = async (req, res, next) => {
    try {
        const { reason } = rejectSchema.parse(req.body);
        const request = await AttendanceRequest.findById(req.params.id);
        if (!request) throw new AppError('Request not found', 404, 'NOT_FOUND');
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
                user: employee.user, type: 'ATTENDANCE_REQUEST_REJECTED',
                title: 'Attendance request rejected', message: reason,
                relatedModel: 'Employee', relatedId: employee._id,
            }).catch((err) => console.error('Notification create failed:', err.message));
        }
        await auditService.log(req, {
            action: 'ATTENDANCE_REQUEST_REJECTED', module: 'ATTENDANCE',
            recordId: String(request._id), recordLabel: employee?.fullName,
        });
        res.json({ data: request });
    }
    catch (err) { next(err); }
};
exports.rejectRequest = rejectRequest;
