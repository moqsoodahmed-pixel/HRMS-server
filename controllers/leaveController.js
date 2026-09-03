"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLeaveStats = exports.deleteHoliday = exports.createHoliday = exports.getHolidays = exports.getMyLeaveBalances = exports.getLeaveBalances = exports.cancelLeave = exports.rejectLeave = exports.approveLeave = exports.createLeaveRequest = exports.getLeaveRequests = exports.updateLeaveType = exports.createLeaveType = exports.getLeaveTypes = void 0;
const mongoose_1 = require("mongoose");
const Leave_1 = require("../models/Leave");
const Employee_1 = require("../models/Employee");
const NotificationAudit_1 = require("../models/NotificationAudit");
const auditService_1 = require("../services/auditService");
const errorHandler_1 = require("../middleware/errorHandler");
const helpers_1 = require("../utils/helpers");
const zod_1 = require("zod");
const roles_1 = require("../utils/roles");

const APPROVER_ROLES = roles_1.LEAVE_APPROVER_ROLES;

const leaveRequestSchema = zod_1.z.object({
    leaveType: zod_1.z.string().min(1, 'Leave type is required'),
    startDate: zod_1.z.string().min(1, 'Start date is required'),
    endDate: zod_1.z.string().min(1, 'End date is required'),
    reason: zod_1.z.string().min(3, 'Please give a reason of at least 3 characters'),
    isHalfDay: zod_1.z.boolean().optional(),
    halfDayType: zod_1.z.enum(['FIRST_HALF', 'SECOND_HALF']).optional().or(zod_1.z.literal('')),
    employee: zod_1.z.string().optional(),
});

const leaveTypeSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'Name is required'),
    code: zod_1.z.string().min(1, 'Code is required').max(6),
    description: zod_1.z.string().optional().or(zod_1.z.literal('')),
    maxDaysPerYear: zod_1.z.coerce.number().min(0).max(365),
    isPaid: zod_1.z.boolean().optional(),
    isCarryForward: zod_1.z.boolean().optional(),
    maxCarryForwardDays: zod_1.z.coerce.number().min(0).optional(),
    isActive: zod_1.z.boolean().optional(),
});

const holidaySchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'Name is required'),
    date: zod_1.z.string().min(1, 'Date is required'),
    type: zod_1.z.enum(['NATIONAL', 'OPTIONAL', 'COMPANY']).optional(),
});

function toObjectId(value) {
    return typeof value === 'string' ? new mongoose_1.Types.ObjectId(value) : value;
}

/** Whole days between two dates, inclusive of both ends. */
function countDays(start, end) {
    const a = (0, helpers_1.startOfDay)(start).getTime();
    const b = (0, helpers_1.startOfDay)(end).getTime();
    return Math.floor((b - a) / 86400000) + 1;
}

/**
 * Recomputes a balance row from the leave requests themselves rather than
 * incrementing counters, so approvals/rejections/cancellations can never drift.
 */
async function recalcBalance(employeeId, leaveTypeId, year) {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);
    const [type, agg] = await Promise.all([
        Leave_1.LeaveType.findById(leaveTypeId).lean(),
        Leave_1.LeaveRequest.aggregate([
            {
                $match: {
                    employee: toObjectId(employeeId),
                    leaveType: toObjectId(leaveTypeId),
                    startDate: { $gte: yearStart, $lte: yearEnd },
                    status: { $in: ['PENDING', 'APPROVED'] },
                },
            },
            { $group: { _id: '$status', days: { $sum: '$totalDays' } } },
        ]),
    ]);
    if (!type) return null;
    const byStatus = Object.fromEntries(agg.map((a) => [a._id, a.days]));
    const usedDays = byStatus.APPROVED || 0;
    const pendingDays = byStatus.PENDING || 0;
    const totalDays = type.maxDaysPerYear || 0;
    return Leave_1.LeaveBalance.findOneAndUpdate({ employee: employeeId, leaveType: leaveTypeId, year }, {
        employee: employeeId,
        leaveType: leaveTypeId,
        year,
        totalDays,
        usedDays,
        pendingDays,
        remainingDays: Math.max(0, totalDays - usedDays - pendingDays),
    }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

/** Ensures a balance row exists for every active leave type for the given year. */
async function ensureBalances(employeeId, year) {
    const types = await Leave_1.LeaveType.find({ isActive: true }).lean();
    await Promise.all(types.map((t) => recalcBalance(employeeId, t._id, year)));
}

async function notify(userId, payload) {
    if (!userId) return;
    try {
        await NotificationAudit_1.Notification.create({ user: userId, ...payload });
    } catch (err) {
        console.error('Notification create failed:', err.message);
    }
}

const getLeaveTypes = async (req, res, next) => {
    try {
        const includeInactive = req.query.includeInactive === 'true'
            && roles_1.HR_ROLES.includes(req.user?.role);
        const types = await Leave_1.LeaveType.find(includeInactive ? {} : { isActive: true }).sort({ name: 1 });
        res.json({ data: types });
    }
    catch (err) { next(err); }
};
exports.getLeaveTypes = getLeaveTypes;

const createLeaveType = async (req, res, next) => {
    try {
        const data = leaveTypeSchema.parse(req.body);
        const code = data.code.toUpperCase();
        const existing = await Leave_1.LeaveType.findOne({ code });
        if (existing) throw new errorHandler_1.AppError(`A leave type with code ${code} already exists`, 409, 'DUPLICATE');
        const type = await Leave_1.LeaveType.create({ ...data, code, isActive: data.isActive !== false });
        await auditService_1.auditService.log(req, { action: 'LEAVE_TYPE_CREATED', module: 'LEAVE', recordId: type._id.toString(), recordLabel: type.name });
        res.status(201).json({ data: type });
    }
    catch (err) { next(err); }
};
exports.createLeaveType = createLeaveType;

const updateLeaveType = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'leave type id');
        const data = leaveTypeSchema.partial().parse(req.body);
        if (data.code) data.code = data.code.toUpperCase();
        const type = await Leave_1.LeaveType.findByIdAndUpdate(id, data, { new: true, runValidators: true });
        if (!type) throw new errorHandler_1.AppError('Leave type not found', 404, 'NOT_FOUND');
        await auditService_1.auditService.log(req, { action: 'LEAVE_TYPE_UPDATED', module: 'LEAVE', recordId: id, recordLabel: type.name });
        res.json({ data: type });
    }
    catch (err) { next(err); }
};
exports.updateLeaveType = updateLeaveType;

const getLeaveRequests = async (req, res, next) => {
    try {
        const { page, limit, skip } = (0, helpers_1.parsePagination)(req.query, 20);
        const { status, employeeId, leaveType, startDate, endDate, department, search } = req.query;

        const query = {};
        if (status) query.status = status;
        if (leaveType) {
            (0, helpers_1.assertObjectId)(leaveType, 'leave type id');
            query.leaveType = leaveType;
        }
        // A request overlaps the window when it starts before the end and ends after the start.
        if (startDate) query.endDate = { $gte: (0, helpers_1.startOfDay)(startDate) };
        if (endDate) query.startDate = { $lte: (0, helpers_1.endOfDay)(endDate) };

        const { scope } = await (0, helpers_1.resolveEmployeeScope)(req.user);
        const employeeClauses = [];
        if (scope !== undefined) employeeClauses.push(scope === null ? { $in: [] } : scope);
        if (employeeId) {
            (0, helpers_1.assertObjectId)(employeeId, 'employeeId');
            employeeClauses.push(employeeId);
        }
        if (department || search) {
            const empQuery = { isArchived: false };
            if (department) empQuery.department = department;
            if (search) {
                empQuery.$or = [
                    { fullName: (0, helpers_1.searchRegex)(search) },
                    { employeeCode: (0, helpers_1.searchRegex)(search) },
                ];
            }
            const ids = await Employee_1.Employee.find(empQuery).select('_id').lean();
            employeeClauses.push({ $in: ids.map((i) => i._id) });
        }
        if (employeeClauses.length === 1) query.employee = employeeClauses[0];
        else if (employeeClauses.length > 1) query.$and = employeeClauses.map((c) => ({ employee: c }));

        const [requests, total] = await Promise.all([
            Leave_1.LeaveRequest.find(query)
                .populate('employee', 'fullName employeeCode department designation')
                .populate('leaveType', 'name code isPaid')
                .populate('approvedBy', 'email')
                .populate('rejectedBy', 'email')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Leave_1.LeaveRequest.countDocuments(query),
        ]);
        res.json({ data: requests, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
    }
    catch (err) { next(err); }
};
exports.getLeaveRequests = getLeaveRequests;

const createLeaveRequest = async (req, res, next) => {
    try {
        const data = leaveRequestSchema.parse(req.body);
        (0, helpers_1.assertObjectId)(data.leaveType, 'leave type id');

        let employeeId = data.employee;
        const canFileForOthers = roles_1.HR_ROLES.includes(req.user?.role);
        if (!canFileForOthers || !employeeId) {
            const emp = await Employee_1.Employee.findOne({ user: req.user?.userId });
            if (!emp) throw new errorHandler_1.AppError('No employee profile is linked to your account', 404, 'NO_EMPLOYEE_PROFILE');
            employeeId = emp._id.toString();
        }
        (0, helpers_1.assertObjectId)(employeeId, 'employee id');

        const type = await Leave_1.LeaveType.findById(data.leaveType);
        if (!type || !type.isActive) throw new errorHandler_1.AppError('Leave type is not available', 400, 'INVALID_LEAVE_TYPE');

        const startDate = (0, helpers_1.startOfDay)(data.startDate);
        const endDate = (0, helpers_1.startOfDay)(data.endDate);
        if (endDate < startDate) throw new errorHandler_1.AppError('End date cannot be before the start date', 400, 'INVALID_RANGE');
        if (data.isHalfDay && endDate.getTime() !== startDate.getTime()) {
            throw new errorHandler_1.AppError('A half day must start and end on the same date', 400, 'INVALID_RANGE');
        }
        const totalDays = data.isHalfDay ? 0.5 : countDays(startDate, endDate);

        const overlap = await Leave_1.LeaveRequest.findOne({
            employee: employeeId,
            status: { $in: ['PENDING', 'APPROVED'] },
            startDate: { $lte: endDate },
            endDate: { $gte: startDate },
        });
        if (overlap) throw new errorHandler_1.AppError('You already have a leave request covering these dates', 409, 'OVERLAPPING_LEAVE');

        const year = startDate.getFullYear();
        const balance = await recalcBalance(employeeId, data.leaveType, year);
        if (balance && balance.totalDays > 0 && totalDays > balance.remainingDays) {
            throw new errorHandler_1.AppError(`Only ${balance.remainingDays} day(s) of ${type.name} remain for ${year}`, 400, 'INSUFFICIENT_BALANCE');
        }

        const request = await Leave_1.LeaveRequest.create({
            employee: employeeId,
            leaveType: data.leaveType,
            startDate,
            endDate,
            totalDays,
            isHalfDay: data.isHalfDay || false,
            halfDayType: data.halfDayType || undefined,
            reason: data.reason,
            status: 'PENDING',
        });
        await recalcBalance(employeeId, data.leaveType, year);

        const employee = await Employee_1.Employee.findById(employeeId).populate('manager', 'user fullName');
        if (employee?.manager?.user) {
            await notify(employee.manager.user, {
                type: 'LEAVE_REQUEST',
                title: 'New leave request',
                message: `${employee.fullName} requested ${totalDays} day(s) of ${type.name}.`,
                relatedModel: 'LeaveRequest',
                relatedId: request._id,
            });
        }
        await auditService_1.auditService.log(req, {
            action: 'LEAVE_REQUESTED', module: 'LEAVE',
            recordId: request._id.toString(), recordLabel: employee?.fullName,
            newValue: { leaveType: type.name, startDate, endDate, totalDays },
        });
        res.status(201).json({ data: request });
    }
    catch (err) { next(err); }
};
exports.createLeaveRequest = createLeaveRequest;

/** Managers may only act on their own direct reports, and never on their own request. */
async function assertCanApprove(req, request) {
    if (roles_1.HR_ROLES.includes(req.user?.role)) return;
    const self = await Employee_1.Employee.findOne({ user: req.user?.userId }).select('_id').lean();
    if (!self) throw new errorHandler_1.AppError('No employee profile is linked to your account', 403, 'FORBIDDEN');
    if (String(request.employee._id || request.employee) === String(self._id)) {
        throw new errorHandler_1.AppError('You cannot action your own leave request', 403, 'FORBIDDEN');
    }
    const target = await Employee_1.Employee.findById(request.employee._id || request.employee).select('manager').lean();
    if (!target || String(target.manager || '') !== String(self._id)) {
        throw new errorHandler_1.AppError('You can only action leave for your direct reports', 403, 'FORBIDDEN');
    }
}

const approveLeave = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'leave request id');
        const request = await Leave_1.LeaveRequest.findById(id);
        if (!request) throw new errorHandler_1.AppError('Leave request not found', 404, 'NOT_FOUND');
        if (request.status !== 'PENDING') {
            throw new errorHandler_1.AppError(`This request is already ${request.status.toLowerCase()}`, 400, 'INVALID_STATUS');
        }
        await assertCanApprove(req, request);

        request.status = 'APPROVED';
        request.approvedBy = req.user?.userId;
        request.approvedAt = new Date();
        request.managerNote = req.body?.note;
        await request.save();
        await recalcBalance(request.employee, request.leaveType, new Date(request.startDate).getFullYear());

        const employee = await Employee_1.Employee.findById(request.employee).select('fullName user');
        await notify(employee?.user, {
            type: 'LEAVE_APPROVED',
            title: 'Leave approved',
            message: `Your leave from ${new Date(request.startDate).toLocaleDateString('en-IN')} was approved.`,
            relatedModel: 'LeaveRequest',
            relatedId: request._id,
        });
        await auditService_1.auditService.log(req, { action: 'LEAVE_APPROVED', module: 'LEAVE', recordId: id, recordLabel: employee?.fullName });
        res.json({ data: request, message: 'Leave approved' });
    }
    catch (err) { next(err); }
};
exports.approveLeave = approveLeave;

const rejectLeave = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'leave request id');
        const reason = String(req.body?.reason || '').trim();
        if (!reason) throw new errorHandler_1.AppError('A rejection reason is required', 400, 'VALIDATION_ERROR');
        const request = await Leave_1.LeaveRequest.findById(id);
        if (!request) throw new errorHandler_1.AppError('Leave request not found', 404, 'NOT_FOUND');
        if (request.status !== 'PENDING') {
            throw new errorHandler_1.AppError(`This request is already ${request.status.toLowerCase()}`, 400, 'INVALID_STATUS');
        }
        await assertCanApprove(req, request);

        request.status = 'REJECTED';
        request.rejectedBy = req.user?.userId;
        request.rejectedAt = new Date();
        request.rejectionReason = reason;
        await request.save();
        await recalcBalance(request.employee, request.leaveType, new Date(request.startDate).getFullYear());

        const employee = await Employee_1.Employee.findById(request.employee).select('fullName user');
        await notify(employee?.user, {
            type: 'LEAVE_REJECTED',
            title: 'Leave rejected',
            message: `Your leave request was rejected: ${reason}`,
            relatedModel: 'LeaveRequest',
            relatedId: request._id,
        });
        await auditService_1.auditService.log(req, { action: 'LEAVE_REJECTED', module: 'LEAVE', recordId: id, recordLabel: employee?.fullName });
        res.json({ data: request, message: 'Leave rejected' });
    }
    catch (err) { next(err); }
};
exports.rejectLeave = rejectLeave;

/** Owners may cancel their own pending requests; HR/Admin may cancel pending or approved ones. */
const cancelLeave = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'leave request id');
        const request = await Leave_1.LeaveRequest.findById(id);
        if (!request) throw new errorHandler_1.AppError('Leave request not found', 404, 'NOT_FOUND');

        const isAdmin = roles_1.HR_ROLES.includes(req.user?.role);
        const self = await Employee_1.Employee.findOne({ user: req.user?.userId }).select('_id').lean();
        const isOwner = self && String(self._id) === String(request.employee);
        if (!isAdmin && !isOwner) {
            throw new errorHandler_1.AppError('You can only cancel your own leave requests', 403, 'FORBIDDEN');
        }
        if (!['PENDING', 'APPROVED'].includes(request.status)) {
            throw new errorHandler_1.AppError(`This request is already ${request.status.toLowerCase()}`, 400, 'INVALID_STATUS');
        }
        if (request.status === 'APPROVED' && !isAdmin) {
            throw new errorHandler_1.AppError('Approved leave can only be cancelled by HR', 403, 'FORBIDDEN');
        }

        request.status = 'CANCELLED';
        await request.save();
        await recalcBalance(request.employee, request.leaveType, new Date(request.startDate).getFullYear());
        await auditService_1.auditService.log(req, { action: 'LEAVE_CANCELLED', module: 'LEAVE', recordId: id });
        res.json({ data: request, message: 'Leave cancelled' });
    }
    catch (err) { next(err); }
};
exports.cancelLeave = cancelLeave;

const getLeaveBalances = async (req, res, next) => {
    try {
        const { employeeId } = req.params;
        const year = parseInt(req.query.year, 10) || new Date().getFullYear();
        let targetEmployeeId = employeeId;

        if (req.user?.role === 'EMPLOYEE') {
            const emp = await Employee_1.Employee.findOne({ user: req.user.userId }).select('_id').lean();
            if (!emp) throw new errorHandler_1.AppError('No employee profile is linked to your account', 404, 'NO_EMPLOYEE_PROFILE');
            targetEmployeeId = emp._id.toString();
        }
        (0, helpers_1.assertObjectId)(targetEmployeeId, 'employee id');
        await ensureBalances(targetEmployeeId, year);
        const balances = await Leave_1.LeaveBalance.find({ employee: targetEmployeeId, year })
            .populate('leaveType', 'name code isPaid maxDaysPerYear')
            .lean();
        res.json({ data: balances.filter((b) => b.leaveType) });
    }
    catch (err) { next(err); }
};
exports.getLeaveBalances = getLeaveBalances;

/** Balances for whoever is signed in — the page does not need to know its own employee id. */
const getMyLeaveBalances = async (req, res, next) => {
    try {
        const year = parseInt(req.query.year, 10) || new Date().getFullYear();
        const emp = await Employee_1.Employee.findOne({ user: req.user?.userId }).select('_id').lean();
        if (!emp) {
            res.json({ data: [] });
            return;
        }
        await ensureBalances(emp._id, year);
        const balances = await Leave_1.LeaveBalance.find({ employee: emp._id, year })
            .populate('leaveType', 'name code isPaid maxDaysPerYear')
            .lean();
        res.json({ data: balances.filter((b) => b.leaveType) });
    }
    catch (err) { next(err); }
};
exports.getMyLeaveBalances = getMyLeaveBalances;

const getHolidays = async (req, res, next) => {
    try {
        const year = parseInt(req.query.year, 10) || new Date().getFullYear();
        const holidays = await Leave_1.Holiday.find({ year, isActive: true }).sort({ date: 1 });
        res.json({ data: holidays });
    }
    catch (err) { next(err); }
};
exports.getHolidays = getHolidays;

const createHoliday = async (req, res, next) => {
    try {
        const data = holidaySchema.parse(req.body);
        const date = (0, helpers_1.startOfDay)(data.date);
        const year = date.getFullYear();
        const existing = await Leave_1.Holiday.findOne({ date, isActive: true });
        if (existing) throw new errorHandler_1.AppError('A holiday is already recorded for this date', 409, 'DUPLICATE');
        const holiday = await Leave_1.Holiday.create({ name: data.name, date, type: data.type || 'NATIONAL', year, isActive: true });
        await auditService_1.auditService.log(req, { action: 'HOLIDAY_CREATED', module: 'LEAVE', recordId: holiday._id.toString(), recordLabel: holiday.name });
        res.status(201).json({ data: holiday });
    }
    catch (err) { next(err); }
};
exports.createHoliday = createHoliday;

const deleteHoliday = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'holiday id');
        const holiday = await Leave_1.Holiday.findByIdAndUpdate(id, { isActive: false }, { new: true });
        if (!holiday) throw new errorHandler_1.AppError('Holiday not found', 404, 'NOT_FOUND');
        await auditService_1.auditService.log(req, { action: 'HOLIDAY_REMOVED', module: 'LEAVE', recordId: id, recordLabel: holiday.name });
        res.json({ message: 'Holiday removed' });
    }
    catch (err) { next(err); }
};
exports.deleteHoliday = deleteHoliday;

/** Request counts plus the caller's own balance totals, for the summary cards. */
const getLeaveStats = async (req, res, next) => {
    try {
        const year = parseInt(req.query.year, 10) || new Date().getFullYear();
        const { scope, employee } = await (0, helpers_1.resolveEmployeeScope)(req.user);
        const match = {};
        if (scope !== undefined) match.employee = scope === null ? { $in: [] } : scope;

        const yearStart = new Date(year, 0, 1);
        const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);
        const byStatus = await Leave_1.LeaveRequest.aggregate([
            { $match: { ...match, startDate: { $gte: yearStart, $lte: yearEnd } } },
            { $group: { _id: '$status', count: { $sum: 1 }, days: { $sum: '$totalDays' } } },
        ]);
        const counts = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
        const days = Object.fromEntries(byStatus.map((s) => [s._id, s.days]));

        let available = 0;
        let used = 0;
        if (employee) {
            await ensureBalances(employee._id, year);
            const balances = await Leave_1.LeaveBalance.find({ employee: employee._id, year }).lean();
            available = balances.reduce((sum, b) => sum + (b.remainingDays || 0), 0);
            used = balances.reduce((sum, b) => sum + (b.usedDays || 0), 0);
        }

        res.json({
            data: {
                year,
                pending: counts.PENDING || 0,
                approved: counts.APPROVED || 0,
                rejected: counts.REJECTED || 0,
                cancelled: counts.CANCELLED || 0,
                approvedDays: days.APPROVED || 0,
                availableDays: available,
                usedDays: used,
                hasOwnBalance: Boolean(employee),
            },
        });
    }
    catch (err) { next(err); }
};
exports.getLeaveStats = getLeaveStats;
exports.APPROVER_ROLES = APPROVER_ROLES;
