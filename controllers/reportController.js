"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLifecycleReport = exports.getAssetReport = exports.getPayrollReport = exports.getLeaveReport = exports.getAttendanceReport = exports.getEmployeeReport = void 0;
const Employee_1 = require("../models/Employee");
const Attendance_1 = require("../models/Attendance");
const Leave_1 = require("../models/Leave");
const Payroll_1 = require("../models/Payroll");
const AssetOnboarding_1 = require("../models/AssetOnboarding");
const helpers_1 = require("../utils/helpers");

/** Shared employee filter for every report (department / status / free text). */
function employeeFilter(query) {
    const filter = { isArchived: false };
    if (query.department) filter.department = query.department;
    if (query.status) filter.status = query.status;
    if (query.employeeId) {
        (0, helpers_1.assertObjectId)(query.employeeId, 'employeeId');
        filter._id = query.employeeId;
    }
    if (query.search) {
        filter.$or = [
            { fullName: (0, helpers_1.searchRegex)(query.search) },
            { employeeCode: (0, helpers_1.searchRegex)(query.search) },
        ];
    }
    return filter;
}

/** Resolves the report window, defaulting to the current month. */
function reportRange(query) {
    const now = new Date();
    const from = query.startDate
        ? (0, helpers_1.startOfDay)(query.startDate)
        : (0, helpers_1.startOfDay)(new Date(now.getFullYear(), now.getMonth(), 1));
    const to = query.endDate
        ? (0, helpers_1.endOfDay)(query.endDate)
        : (0, helpers_1.endOfDay)(now);
    return { from, to };
}

const getEmployeeReport = async (req, res, next) => {
    try {
        const filter = employeeFilter(req.query);
        const [employees, byDepartment, byStatus, byType, byGender] = await Promise.all([
            Employee_1.Employee.find(filter)
                .select('employeeCode fullName officialEmail department designation status employmentType dateOfJoining dateOfExit workLocation')
                .populate('manager', 'fullName')
                .sort({ department: 1, fullName: 1 })
                .limit(1000)
                .lean(),
            Employee_1.Employee.aggregate([{ $match: filter }, { $group: { _id: '$department', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
            Employee_1.Employee.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
            Employee_1.Employee.aggregate([{ $match: filter }, { $group: { _id: '$employmentType', count: { $sum: 1 } } }]),
            Employee_1.Employee.aggregate([{ $match: filter }, { $group: { _id: '$gender', count: { $sum: 1 } } }]),
        ]);

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const [joinedThisMonth, exitedThisMonth] = await Promise.all([
            Employee_1.Employee.countDocuments({ ...filter, dateOfJoining: { $gte: monthStart } }),
            Employee_1.Employee.countDocuments({ ...filter, dateOfExit: { $gte: monthStart, $lte: now } }),
        ]);

        res.json({
            data: {
                summary: {
                    total: employees.length,
                    active: byStatus.find((s) => s._id === 'ACTIVE')?.count || 0,
                    onLeave: byStatus.find((s) => s._id === 'ON_LEAVE')?.count || 0,
                    probation: byStatus.find((s) => s._id === 'PROBATION')?.count || 0,
                    noticePeriod: byStatus.find((s) => s._id === 'NOTICE_PERIOD')?.count || 0,
                    inactive: byStatus.find((s) => s._id === 'INACTIVE')?.count || 0,
                    joinedThisMonth,
                    exitedThisMonth,
                },
                byDepartment,
                byStatus,
                byEmploymentType: byType,
                byGender: byGender.filter((g) => g._id),
                employees,
            },
        });
    }
    catch (err) { next(err); }
};
exports.getEmployeeReport = getEmployeeReport;

const getAttendanceReport = async (req, res, next) => {
    try {
        const { from, to } = reportRange(req.query);
        const empFilter = employeeFilter(req.query);
        const employees = await Employee_1.Employee.find(empFilter).select('fullName employeeCode department').lean();
        const ids = employees.map((e) => e._id);
        const match = { date: { $gte: from, $lte: to }, employee: { $in: ids } };

        const [byStatus, perEmployee, byDay] = await Promise.all([
            Attendance_1.Attendance.aggregate([
                { $match: match },
                { $group: { _id: '$status', count: { $sum: 1 }, hours: { $sum: '$workHours' } } },
            ]),
            Attendance_1.Attendance.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: '$employee',
                        present: { $sum: { $cond: [{ $in: ['$status', ['PRESENT', 'LATE', 'WORK_FROM_HOME']] }, 1, 0] } },
                        absent: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } },
                        late: { $sum: { $cond: [{ $eq: ['$status', 'LATE'] }, 1, 0] } },
                        halfDay: { $sum: { $cond: [{ $eq: ['$status', 'HALF_DAY'] }, 1, 0] } },
                        onLeave: { $sum: { $cond: [{ $eq: ['$status', 'ON_LEAVE'] }, 1, 0] } },
                        workHours: { $sum: '$workHours' },
                        records: { $sum: 1 },
                    },
                },
            ]),
            Attendance_1.Attendance.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
                        present: { $sum: { $cond: [{ $in: ['$status', ['PRESENT', 'LATE', 'WORK_FROM_HOME']] }, 1, 0] } },
                        absent: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } },
                        onLeave: { $sum: { $cond: [{ $eq: ['$status', 'ON_LEAVE'] }, 1, 0] } },
                    },
                },
                { $sort: { _id: 1 } },
            ]),
        ]);

        const empById = new Map(employees.map((e) => [String(e._id), e]));
        const counts = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
        res.json({
            data: {
                range: { from, to },
                summary: {
                    present: (counts.PRESENT || 0) + (counts.LATE || 0) + (counts.WORK_FROM_HOME || 0),
                    absent: counts.ABSENT || 0,
                    late: counts.LATE || 0,
                    halfDay: counts.HALF_DAY || 0,
                    onLeave: counts.ON_LEAVE || 0,
                    workFromHome: counts.WORK_FROM_HOME || 0,
                    totalWorkHours: Math.round(byStatus.reduce((sum, s) => sum + (s.hours || 0), 0) * 10) / 10,
                    records: byStatus.reduce((sum, s) => sum + s.count, 0),
                },
                byStatus,
                byDay,
                perEmployee: perEmployee
                    .map((r) => ({ ...r, employee: empById.get(String(r._id)) || null }))
                    .filter((r) => r.employee)
                    .sort((a, b) => b.present - a.present),
            },
        });
    }
    catch (err) { next(err); }
};
exports.getAttendanceReport = getAttendanceReport;

const getLeaveReport = async (req, res, next) => {
    try {
        const { from, to } = reportRange(req.query);
        const empFilter = employeeFilter(req.query);
        const employees = await Employee_1.Employee.find(empFilter).select('fullName employeeCode department').lean();
        const ids = employees.map((e) => e._id);
        const match = { employee: { $in: ids }, startDate: { $lte: to }, endDate: { $gte: from } };

        const [byStatus, byType, byDepartment, topUsers] = await Promise.all([
            Leave_1.LeaveRequest.aggregate([
                { $match: match },
                { $group: { _id: '$status', count: { $sum: 1 }, days: { $sum: '$totalDays' } } },
            ]),
            Leave_1.LeaveRequest.aggregate([
                { $match: { ...match, status: 'APPROVED' } },
                { $group: { _id: '$leaveType', days: { $sum: '$totalDays' }, count: { $sum: 1 } } },
                { $lookup: { from: 'leavetypes', localField: '_id', foreignField: '_id', as: 'type' } },
                { $unwind: { path: '$type', preserveNullAndEmptyArrays: true } },
                { $project: { name: '$type.name', code: '$type.code', days: 1, count: 1 } },
                { $sort: { days: -1 } },
            ]),
            Leave_1.LeaveRequest.aggregate([
                { $match: { ...match, status: 'APPROVED' } },
                { $lookup: { from: 'employees', localField: 'employee', foreignField: '_id', as: 'emp' } },
                { $unwind: '$emp' },
                { $group: { _id: '$emp.department', days: { $sum: '$totalDays' }, count: { $sum: 1 } } },
                { $sort: { days: -1 } },
            ]),
            Leave_1.LeaveRequest.aggregate([
                { $match: { ...match, status: 'APPROVED' } },
                { $group: { _id: '$employee', days: { $sum: '$totalDays' }, count: { $sum: 1 } } },
                { $sort: { days: -1 } },
                { $limit: 10 },
            ]),
        ]);

        const empById = new Map(employees.map((e) => [String(e._id), e]));
        const counts = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
        const days = Object.fromEntries(byStatus.map((s) => [s._id, s.days]));
        res.json({
            data: {
                range: { from, to },
                summary: {
                    total: byStatus.reduce((sum, s) => sum + s.count, 0),
                    pending: counts.PENDING || 0,
                    approved: counts.APPROVED || 0,
                    rejected: counts.REJECTED || 0,
                    cancelled: counts.CANCELLED || 0,
                    approvedDays: days.APPROVED || 0,
                    pendingDays: days.PENDING || 0,
                },
                byStatus,
                byType,
                byDepartment,
                topUsers: topUsers
                    .map((r) => ({ ...r, employee: empById.get(String(r._id)) || null }))
                    .filter((r) => r.employee),
            },
        });
    }
    catch (err) { next(err); }
};
exports.getLeaveReport = getLeaveReport;

const getPayrollReport = async (req, res, next) => {
    try {
        const now = new Date();
        const month = parseInt(req.query.month, 10) || (now.getMonth() + 1);
        const year = parseInt(req.query.year, 10) || now.getFullYear();
        const empFilter = employeeFilter(req.query);
        const employees = await Employee_1.Employee.find(empFilter).select('fullName employeeCode department designation').lean();
        const ids = employees.map((e) => e._id);
        const match = { month, year, employee: { $in: ids } };

        const [totals, byStatus, byDepartment, rows, yearTrend] = await Promise.all([
            Payroll_1.Payslip.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: null,
                        count: { $sum: 1 },
                        gross: { $sum: '$grossSalary' },
                        deductions: { $sum: '$totalDeductions' },
                        net: { $sum: '$netSalary' },
                        pf: { $sum: '$pf' },
                        tds: { $sum: '$tds' },
                        esi: { $sum: '$esi' },
                    },
                },
            ]),
            Payroll_1.Payslip.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 }, net: { $sum: '$netSalary' } } }]),
            Payroll_1.Payslip.aggregate([
                { $match: match },
                { $lookup: { from: 'employees', localField: 'employee', foreignField: '_id', as: 'emp' } },
                { $unwind: '$emp' },
                { $group: { _id: '$emp.department', gross: { $sum: '$grossSalary' }, net: { $sum: '$netSalary' }, count: { $sum: 1 } } },
                { $sort: { net: -1 } },
            ]),
            Payroll_1.Payslip.find(match)
                .populate('employee', 'fullName employeeCode department designation')
                .sort({ netSalary: -1 })
                .limit(500)
                .lean(),
            Payroll_1.Payslip.aggregate([
                { $match: { year, employee: { $in: ids } } },
                { $group: { _id: '$month', net: { $sum: '$netSalary' }, gross: { $sum: '$grossSalary' }, count: { $sum: 1 } } },
                { $sort: { _id: 1 } },
            ]),
        ]);

        const t = totals[0] || { count: 0, gross: 0, deductions: 0, net: 0, pf: 0, tds: 0, esi: 0 };
        res.json({
            data: {
                month, year,
                summary: {
                    payslips: t.count,
                    grossPayroll: t.gross,
                    totalDeductions: t.deductions,
                    netPayroll: t.net,
                    pf: t.pf, tds: t.tds, esi: t.esi,
                    averageNet: t.count ? Math.round(t.net / t.count) : 0,
                },
                byStatus,
                byDepartment,
                yearTrend,
                payslips: rows.filter((p) => p.employee),
            },
        });
    }
    catch (err) { next(err); }
};
exports.getPayrollReport = getPayrollReport;

const getAssetReport = async (req, res, next) => {
    try {
        const [byStatus, byType, valueByType, assigned, unreturned] = await Promise.all([
            AssetOnboarding_1.Asset.aggregate([{ $match: { isActive: true } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
            AssetOnboarding_1.Asset.aggregate([{ $match: { isActive: true } }, { $group: { _id: '$type', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
            AssetOnboarding_1.Asset.aggregate([
                { $match: { isActive: true } },
                { $group: { _id: '$type', value: { $sum: '$purchaseValue' } } },
                { $sort: { value: -1 } },
            ]),
            AssetOnboarding_1.Asset.find({ isActive: true, status: 'ASSIGNED' })
                .populate('assignedTo', 'fullName employeeCode department')
                .select('assetCode name type assignedTo assignedAt purchaseValue condition location')
                .sort({ assignedAt: -1 })
                .limit(500)
                .lean(),
            AssetOnboarding_1.AssetAssignment.countDocuments({ returnedAt: { $exists: false } }),
        ]);

        const counts = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
        const totalValue = valueByType.reduce((sum, v) => sum + (v.value || 0), 0);
        res.json({
            data: {
                summary: {
                    total: byStatus.reduce((sum, s) => sum + s.count, 0),
                    available: counts.AVAILABLE || 0,
                    assigned: counts.ASSIGNED || 0,
                    maintenance: (counts.MAINTENANCE || 0) + (counts.UNDER_REPAIR || 0),
                    retired: (counts.RETIRED || 0) + (counts.DISPOSED || 0),
                    returned: counts.RETURNED || 0,
                    outstanding: unreturned,
                    totalValue,
                },
                byStatus,
                byType,
                valueByType,
                assigned: assigned.filter((a) => a.assignedTo),
            },
        });
    }
    catch (err) { next(err); }
};
exports.getAssetReport = getAssetReport;

/** Onboarding and offboarding progress across the organisation. */
const getLifecycleReport = async (req, res, next) => {
    try {
        const empFilter = employeeFilter(req.query);
        const employees = await Employee_1.Employee.find(empFilter).select('fullName employeeCode department dateOfJoining dateOfExit status').lean();
        const ids = employees.map((e) => e._id);

        const [onTasks, offTasks] = await Promise.all([
            AssetOnboarding_1.OnboardingTask.find({ employee: { $in: ids } }).select('employee status').lean(),
            AssetOnboarding_1.OffboardingTask.find({ employee: { $in: ids } }).select('employee status').lean(),
        ]);

        const summarise = (tasks) => {
            const byEmp = new Map();
            tasks.forEach((t) => {
                const key = String(t.employee);
                if (!byEmp.has(key)) byEmp.set(key, { total: 0, completed: 0 });
                const row = byEmp.get(key);
                row.total += 1;
                if (['COMPLETED', 'SKIPPED'].includes(t.status)) row.completed += 1;
            });
            const rows = [...byEmp.entries()].map(([id, r]) => ({
                employee: employees.find((e) => String(e._id) === id) || null,
                total: r.total,
                completed: r.completed,
                percent: r.total ? Math.round((r.completed / r.total) * 100) : 0,
            })).filter((r) => r.employee);
            return {
                employees: rows.length,
                completed: rows.filter((r) => r.percent === 100).length,
                inProgress: rows.filter((r) => r.percent > 0 && r.percent < 100).length,
                notStarted: rows.filter((r) => r.percent === 0).length,
                totalTasks: tasks.length,
                completedTasks: tasks.filter((t) => ['COMPLETED', 'SKIPPED'].includes(t.status)).length,
                rows: rows.sort((a, b) => a.percent - b.percent),
            };
        };

        res.json({ data: { onboarding: summarise(onTasks), offboarding: summarise(offTasks) } });
    }
    catch (err) { next(err); }
};
exports.getLifecycleReport = getLifecycleReport;
