"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markAttendance = exports.getMyToday = exports.getAttendanceStats = exports.updateAttendance = exports.checkOut = exports.checkIn = exports.getAttendance = void 0;
const Attendance_1 = require("../models/Attendance");
const Employee_1 = require("../models/Employee");
const Leave_1 = require("../models/Leave");
const auditService_1 = require("../services/auditService");
const errorHandler_1 = require("../middleware/errorHandler");
const helpers_1 = require("../utils/helpers");
const zod_1 = require("zod");

const WORK_START_HOUR = parseInt(process.env.WORK_START_HOUR || '9', 10);
const WORK_START_MINUTE = parseInt(process.env.WORK_START_MINUTE || '30', 10);
const WORK_END_HOUR = parseInt(process.env.WORK_END_HOUR || '18', 10);
const WORK_END_MINUTE = parseInt(process.env.WORK_END_MINUTE || '30', 10);

const STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'WORK_FROM_HOME', 'HOLIDAY', 'WEEKEND', 'ON_LEAVE'];

const updateSchema = zod_1.z.object({
    checkIn: zod_1.z.string().optional().nullable().or(zod_1.z.literal('')),
    checkOut: zod_1.z.string().optional().nullable().or(zod_1.z.literal('')),
    status: zod_1.z.enum(STATUSES).optional(),
    notes: zod_1.z.string().max(500).optional().or(zod_1.z.literal('')),
    editReason: zod_1.z.string().min(1, 'An edit reason is required'),
});

const markSchema = zod_1.z.object({
    employee: zod_1.z.string().min(1),
    date: zod_1.z.string().min(1),
    status: zod_1.z.enum(STATUSES),
    checkIn: zod_1.z.string().optional().or(zod_1.z.literal('')),
    checkOut: zod_1.z.string().optional().or(zod_1.z.literal('')),
    notes: zod_1.z.string().max(500).optional().or(zod_1.z.literal('')),
});

function workStartFor(date) {
    const d = new Date(date);
    d.setHours(WORK_START_HOUR, WORK_START_MINUTE, 0, 0);
    return d;
}
function workEndFor(date) {
    const d = new Date(date);
    d.setHours(WORK_END_HOUR, WORK_END_MINUTE, 0, 0);
    return d;
}

/** Combines a `YYYY-MM-DD` day with an `HH:mm` (or full ISO) time value. */
function combineDateTime(day, value) {
    if (!value) return undefined;
    if (String(value).includes('T')) return new Date(value);
    const [h, m] = String(value).split(':');
    const d = new Date(day);
    d.setHours(parseInt(h, 10) || 0, parseInt(m, 10) || 0, 0, 0);
    return d;
}

function recomputeDerivedFields(record) {
    if (record.checkIn) {
        const start = workStartFor(record.date);
        record.isLate = record.checkIn > start;
        record.lateMinutes = record.isLate
            ? Math.floor((record.checkIn.getTime() - start.getTime()) / 60000)
            : 0;
    } else {
        record.isLate = false;
        record.lateMinutes = 0;
    }
    if (record.checkIn && record.checkOut) {
        const end = workEndFor(record.date);
        record.isEarlyExit = record.checkOut < end;
        record.earlyExitMinutes = record.isEarlyExit
            ? Math.floor((end.getTime() - record.checkOut.getTime()) / 60000)
            : 0;
        record.workHours = Math.round(((record.checkOut.getTime() - record.checkIn.getTime()) / 3600000) * 100) / 100;
    } else {
        record.workHours = record.checkIn ? record.workHours : undefined;
    }
}

/** Employee ids matching a department / free-text search, or null when unfiltered. */
async function employeeIdsFor({ department, search }) {
    if (!department && !search) return null;
    const q = { isArchived: false };
    if (department) q.department = department;
    if (search) {
        q.$or = [
            { fullName: (0, helpers_1.searchRegex)(search) },
            { employeeCode: (0, helpers_1.searchRegex)(search) },
            { officialEmail: (0, helpers_1.searchRegex)(search) },
        ];
    }
    const rows = await Employee_1.Employee.find(q).select('_id').lean();
    return rows.map((r) => r._id);
}

/** Narrows `query.employee` to the intersection of the caller's scope and a filter. */
function applyEmployeeFilter(query, scope, ids, employeeId) {
    const clauses = [];
    if (scope !== undefined) clauses.push(scope === null ? { $in: [] } : scope);
    if (ids) clauses.push({ $in: ids });
    if (employeeId) clauses.push(employeeId);

    if (clauses.length === 0) return;
    if (clauses.length === 1) {
        query.employee = clauses[0];
        return;
    }
    // Multiple constraints — express them as an $and over the employee field.
    query.$and = clauses.map((c) => ({ employee: c }));
}

const getAttendance = async (req, res, next) => {
    try {
        const { page, limit, skip } = (0, helpers_1.parsePagination)(req.query, 30);
        const { employeeId, startDate, endDate, date, status, department, search } = req.query;

        const query = {};
        if (date) {
            query.date = { $gte: (0, helpers_1.startOfDay)(date), $lte: (0, helpers_1.endOfDay)(date) };
        } else {
            const range = (0, helpers_1.dateRangeQuery)(startDate, endDate);
            if (range) query.date = range;
        }
        if (status) query.status = status;

        const { scope } = await (0, helpers_1.resolveEmployeeScope)(req.user);
        const ids = await employeeIdsFor({ department, search });
        if (employeeId) (0, helpers_1.assertObjectId)(employeeId, 'employeeId');
        applyEmployeeFilter(query, scope, ids, employeeId);

        const [records, total] = await Promise.all([
            Attendance_1.Attendance.find(query)
                .populate('employee', 'fullName employeeCode department designation')
                .populate('editedBy', 'email')
                .sort({ date: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Attendance_1.Attendance.countDocuments(query),
        ]);
        res.json({ data: records, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
    }
    catch (err) { next(err); }
};
exports.getAttendance = getAttendance;

const checkIn = async (req, res, next) => {
    try {
        const emp = await Employee_1.Employee.findOne({ user: req.user?.userId });
        if (!emp) throw new errorHandler_1.AppError('No employee profile is linked to your account', 404, 'NO_EMPLOYEE_PROFILE');
        const todayStart = (0, helpers_1.startOfDay)(new Date());
        const existing = await Attendance_1.Attendance.findOne({ employee: emp._id, date: { $gte: todayStart } });
        if (existing?.checkIn) {
            res.status(400).json({ error: { code: 'ALREADY_CHECKED_IN', message: 'You have already checked in today' } });
            return;
        }
        const checkInTime = new Date();
        const start = workStartFor(checkInTime);
        const isLate = checkInTime > start;
        const record = await Attendance_1.Attendance.findOneAndUpdate({ employee: emp._id, date: { $gte: todayStart } }, {
            employee: emp._id,
            date: todayStart,
            checkIn: checkInTime,
            status: isLate ? 'LATE' : 'PRESENT',
            isLate,
            lateMinutes: isLate ? Math.floor((checkInTime.getTime() - start.getTime()) / 60000) : 0,
        }, { upsert: true, new: true, setDefaultsOnInsert: true });
        await auditService_1.auditService.log(req, { action: 'ATTENDANCE_CHECK_IN', module: 'ATTENDANCE', recordId: record._id.toString(), recordLabel: emp.fullName });
        res.json({ data: record });
    }
    catch (err) { next(err); }
};
exports.checkIn = checkIn;

const checkOut = async (req, res, next) => {
    try {
        const emp = await Employee_1.Employee.findOne({ user: req.user?.userId });
        if (!emp) throw new errorHandler_1.AppError('No employee profile is linked to your account', 404, 'NO_EMPLOYEE_PROFILE');
        const todayStart = (0, helpers_1.startOfDay)(new Date());
        const record = await Attendance_1.Attendance.findOne({ employee: emp._id, date: { $gte: todayStart } });
        if (!record?.checkIn) {
            res.status(400).json({ error: { code: 'NOT_CHECKED_IN', message: 'You have not checked in today' } });
            return;
        }
        if (record.checkOut) {
            res.status(400).json({ error: { code: 'ALREADY_CHECKED_OUT', message: 'You have already checked out today' } });
            return;
        }
        record.checkOut = new Date();
        recomputeDerivedFields(record);
        await record.save();
        await auditService_1.auditService.log(req, { action: 'ATTENDANCE_CHECK_OUT', module: 'ATTENDANCE', recordId: record._id.toString(), recordLabel: emp.fullName });
        res.json({ data: record });
    }
    catch (err) { next(err); }
};
exports.checkOut = checkOut;

const updateAttendance = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'attendance id');
        const data = updateSchema.parse(req.body);
        const record = await Attendance_1.Attendance.findById(id);
        if (!record) throw new errorHandler_1.AppError('Attendance record not found', 404, 'NOT_FOUND');

        const oldValue = {
            checkIn: record.checkIn, checkOut: record.checkOut,
            status: record.status, notes: record.notes,
        };

        if (data.checkIn !== undefined) record.checkIn = data.checkIn ? combineDateTime(record.date, data.checkIn) : undefined;
        if (data.checkOut !== undefined) record.checkOut = data.checkOut ? combineDateTime(record.date, data.checkOut) : undefined;
        if (record.checkIn && record.checkOut && record.checkOut <= record.checkIn) {
            throw new errorHandler_1.AppError('Check-out must be later than check-in', 400, 'INVALID_RANGE');
        }
        if (data.status) record.status = data.status;
        if (data.notes !== undefined) record.notes = data.notes;
        record.editedBy = req.user?.userId;
        record.editedAt = new Date();
        record.editReason = data.editReason;
        recomputeDerivedFields(record);
        await record.save();

        await auditService_1.auditService.log(req, {
            action: 'ATTENDANCE_EDITED',
            module: 'ATTENDANCE',
            recordId: id,
            oldValue,
            newValue: { checkIn: record.checkIn, checkOut: record.checkOut, status: record.status, notes: record.notes, reason: data.editReason },
        });
        const populated = await Attendance_1.Attendance.findById(id).populate('employee', 'fullName employeeCode department');
        res.json({ data: populated });
    }
    catch (err) { next(err); }
};
exports.updateAttendance = updateAttendance;

/** Creates or overwrites an attendance record for one employee on one day (HR/Admin). */
const markAttendance = async (req, res, next) => {
    try {
        const data = markSchema.parse(req.body);
        (0, helpers_1.assertObjectId)(data.employee, 'employee id');
        const employee = await Employee_1.Employee.findById(data.employee);
        if (!employee) throw new errorHandler_1.AppError('Employee not found', 404, 'NOT_FOUND');
        const day = (0, helpers_1.startOfDay)(data.date);

        let record = await Attendance_1.Attendance.findOne({ employee: data.employee, date: day });
        if (!record) record = new Attendance_1.Attendance({ employee: data.employee, date: day });
        record.status = data.status;
        record.checkIn = data.checkIn ? combineDateTime(day, data.checkIn) : undefined;
        record.checkOut = data.checkOut ? combineDateTime(day, data.checkOut) : undefined;
        if (record.checkIn && record.checkOut && record.checkOut <= record.checkIn) {
            throw new errorHandler_1.AppError('Check-out must be later than check-in', 400, 'INVALID_RANGE');
        }
        record.notes = data.notes;
        record.editedBy = req.user?.userId;
        record.editedAt = new Date();
        record.editReason = 'Manual entry by administrator';
        recomputeDerivedFields(record);
        await record.save();

        await auditService_1.auditService.log(req, {
            action: 'ATTENDANCE_MARKED', module: 'ATTENDANCE',
            recordId: record._id.toString(), recordLabel: employee.fullName,
            newValue: { date: day, status: data.status },
        });
        res.status(201).json({ data: record });
    }
    catch (err) { next(err); }
};
exports.markAttendance = markAttendance;

/** Headline counts for one day, scoped to what the caller may see. */
const getAttendanceStats = async (req, res, next) => {
    try {
        const day = req.query.date ? new Date(req.query.date) : new Date();
        const from = (0, helpers_1.startOfDay)(day);
        const to = (0, helpers_1.endOfDay)(day);

        const { scope } = await (0, helpers_1.resolveEmployeeScope)(req.user);
        const employeeFilter = {};
        const attendanceFilter = { date: { $gte: from, $lte: to } };
        if (scope !== undefined) {
            const clause = scope === null ? { $in: [] } : scope;
            attendanceFilter.employee = clause;
            employeeFilter._id = clause;
        }

        const [byStatus, totalEmployees, onLeave] = await Promise.all([
            Attendance_1.Attendance.aggregate([
                { $match: attendanceFilter },
                { $group: { _id: '$status', count: { $sum: 1 } } },
            ]),
            Employee_1.Employee.countDocuments({ ...employeeFilter, isArchived: false, status: { $ne: 'INACTIVE' } }),
            Leave_1.LeaveRequest.countDocuments({
                status: 'APPROVED',
                startDate: { $lte: to },
                endDate: { $gte: from },
                ...(scope !== undefined ? { employee: scope === null ? { $in: [] } : scope } : {}),
            }),
        ]);

        const counts = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
        const present = (counts.PRESENT || 0) + (counts.LATE || 0) + (counts.WORK_FROM_HOME || 0) + (counts.HALF_DAY || 0);
        const marked = byStatus.reduce((sum, s) => sum + s.count, 0);

        res.json({
            data: {
                date: from,
                totalEmployees,
                present,
                late: counts.LATE || 0,
                workFromHome: counts.WORK_FROM_HOME || 0,
                halfDay: counts.HALF_DAY || 0,
                onLeave: Math.max(onLeave, counts.ON_LEAVE || 0),
                // Anyone without a record for the day counts as unaccounted-for/absent.
                absent: (counts.ABSENT || 0) + Math.max(0, totalEmployees - marked),
                notMarked: Math.max(0, totalEmployees - marked),
                byStatus: counts,
            },
        });
    }
    catch (err) { next(err); }
};
exports.getAttendanceStats = getAttendanceStats;

/** The signed-in user's own record for today, used by the check-in/out widget. */
const getMyToday = async (req, res, next) => {
    try {
        const emp = await Employee_1.Employee.findOne({ user: req.user?.userId }).select('_id fullName employeeCode department designation');
        if (!emp) {
            res.json({ data: { employee: null, record: null, shift: { start: `${String(WORK_START_HOUR).padStart(2, '0')}:${String(WORK_START_MINUTE).padStart(2, '0')}`, end: `${String(WORK_END_HOUR).padStart(2, '0')}:${String(WORK_END_MINUTE).padStart(2, '0')}` } } });
            return;
        }
        const todayStart = (0, helpers_1.startOfDay)(new Date());
        const record = await Attendance_1.Attendance.findOne({ employee: emp._id, date: { $gte: todayStart } });
        res.json({
            data: {
                employee: emp,
                record,
                shift: {
                    start: `${String(WORK_START_HOUR).padStart(2, '0')}:${String(WORK_START_MINUTE).padStart(2, '0')}`,
                    end: `${String(WORK_END_HOUR).padStart(2, '0')}:${String(WORK_END_MINUTE).padStart(2, '0')}`,
                },
            },
        });
    }
    catch (err) { next(err); }
};
exports.getMyToday = getMyToday;
