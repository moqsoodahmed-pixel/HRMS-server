"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardStats = void 0;
const Employee_1 = require("../models/Employee");
const Leave_1 = require("../models/Leave");
const Attendance_1 = require("../models/Attendance");
const Document_1 = require("../models/Document");
const Payroll_1 = require("../models/Payroll");
const AssetOnboarding_1 = require("../models/AssetOnboarding");
const PolicyAnnouncement_1 = require("../models/PolicyAnnouncement");
const NotificationAudit_1 = require("../models/NotificationAudit");
const { CompensationRequest } = require("../models/Payroll");
const helpers_1 = require("../utils/helpers");
const roles_1 = require("../utils/roles");

const PAYROLL_ROLES = roles_1.PAYROLL_VIEW_ROLES;
const ACTIVITY_ROLES = roles_1.ACTIVITY_FEED_ROLES;

/** True when an announcement targets the given employee — mirrors contentController's rule. */
function targetsEmployee(announcement, employee) {
    if (!announcement.targetAudience || announcement.targetAudience === 'ALL') return true;
    if (!employee) return false;
    if (announcement.targetAudience === 'DEPARTMENT') return (announcement.targetDepartments || []).includes(employee.department);
    if (announcement.targetAudience === 'DESIGNATION') return (announcement.targetDesignations || []).includes(employee.designation);
    if (announcement.targetAudience === 'SPECIFIC') return (announcement.targetEmployees || []).map(String).includes(String(employee._id));
    return true;
}

/** Days until the next occurrence of a birthday, wrapping across the year end. */
function daysUntilBirthday(dob, today) {
    const next = new Date(today.getFullYear(), new Date(dob).getMonth(), new Date(dob).getDate());
    if (next < (0, helpers_1.startOfDay)(today)) next.setFullYear(next.getFullYear() + 1);
    return Math.round((next - (0, helpers_1.startOfDay)(today)) / 86400000);
}

const getDashboardStats = async (req, res, next) => {
    try {
        const now = new Date();
        const todayStart = (0, helpers_1.startOfDay)(now);
        const todayEnd = (0, helpers_1.endOfDay)(now);
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const in30Days = new Date(now.getTime() + 30 * 86400000);

        const { scope, employee } = await (0, helpers_1.resolveEmployeeScope)(req.user);
        const empScope = scope === undefined ? {} : { _id: scope === null ? { $in: [] } : scope };
        const recordScope = scope === undefined ? {} : { employee: scope === null ? { $in: [] } : scope };
        const canSeePayroll = PAYROLL_ROLES.includes(req.user?.role);

        const [
            totalEmployees, activeEmployees, inactiveEmployees, onLeaveEmployees,
            probation, noticePeriod, newJoiners, pendingLeave, expiringDocs,
            attendanceToday, pendingDocs, assetCounts, announcements,
        ] = await Promise.all([
            Employee_1.Employee.countDocuments({ ...empScope, isArchived: false }),
            Employee_1.Employee.countDocuments({ ...empScope, status: 'ACTIVE', isArchived: false }),
            Employee_1.Employee.countDocuments({ ...empScope, status: 'INACTIVE', isArchived: false }),
            Employee_1.Employee.countDocuments({ ...empScope, status: 'ON_LEAVE', isArchived: false }),
            Employee_1.Employee.countDocuments({ ...empScope, status: 'PROBATION', isArchived: false }),
            Employee_1.Employee.countDocuments({ ...empScope, status: 'NOTICE_PERIOD', isArchived: false }),
            Employee_1.Employee.countDocuments({ ...empScope, dateOfJoining: { $gte: monthStart }, isArchived: false }),
            Leave_1.LeaveRequest.countDocuments({ ...recordScope, status: 'PENDING' }),
            Document_1.EmployeeDocument.countDocuments({
                ...recordScope,
                expiryDate: { $gte: now, $lte: in30Days },
                isArchived: false,
            }),
            Attendance_1.Attendance.aggregate([
                { $match: { ...recordScope, date: { $gte: todayStart, $lte: todayEnd } } },
                { $group: { _id: '$status', count: { $sum: 1 } } },
            ]),
            Document_1.EmployeeDocument.countDocuments({ ...recordScope, status: 'PENDING', isArchived: false }),
            AssetOnboarding_1.Asset.aggregate([
                { $match: { isActive: true } },
                { $group: { _id: '$status', count: { $sum: 1 } } },
            ]),
            PolicyAnnouncement_1.Announcement.find({ isActive: true })
                .select('title description priority createdAt targetAudience targetDepartments targetDesignations targetEmployees')
                .sort({ createdAt: -1 })
                .limit(20)
                .lean(),
        ]);

        const attendanceByStatus = Object.fromEntries(attendanceToday.map((a) => [a._id, a.count]));
        const presentToday = (attendanceByStatus.PRESENT || 0) + (attendanceByStatus.LATE || 0)
            + (attendanceByStatus.WORK_FROM_HOME || 0) + (attendanceByStatus.HALF_DAY || 0);

        // Upcoming birthdays over the next 30 days, ordered by how soon they land.
        const withDob = await Employee_1.Employee.find({ ...empScope, isArchived: false, dateOfBirth: { $ne: null } })
            .select('fullName dateOfBirth employeeCode department profilePhoto')
            .lean();
        const upcomingBirthdays = withDob
            .map((e) => ({ ...e, inDays: daysUntilBirthday(e.dateOfBirth, now) }))
            .filter((e) => e.inDays <= 30)
            .sort((a, b) => a.inDays - b.inDays)
            .slice(0, 6);

        const [deptDist, monthlyJoiners] = await Promise.all([
            Employee_1.Employee.aggregate([
                { $match: { ...empScope, isArchived: false, status: { $ne: 'INACTIVE' } } },
                { $group: { _id: '$department', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]),
            Employee_1.Employee.aggregate([
                { $match: { ...empScope, dateOfJoining: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) }, isArchived: false } },
                { $group: { _id: { year: { $year: '$dateOfJoining' }, month: { $month: '$dateOfJoining' } }, count: { $sum: 1 } } },
                { $sort: { '_id.year': 1, '_id.month': 1 } },
            ]),
        ]);

        // Payroll figures are only ever computed for roles allowed to see them.
        let payroll = null;
        if (canSeePayroll) {
            const agg = await Payroll_1.Payslip.aggregate([
                { $match: { month: now.getMonth() + 1, year: now.getFullYear() } },
                {
                    $group: {
                        _id: null,
                        count: { $sum: 1 },
                        gross: { $sum: '$grossSalary' },
                        net: { $sum: '$netSalary' },
                        deductions: { $sum: '$totalDeductions' },
                        paid: { $sum: { $cond: [{ $eq: ['$status', 'PAID'] }, 1, 0] } },
                    },
                },
            ]);
            const t = agg[0] || { count: 0, gross: 0, net: 0, deductions: 0, paid: 0 };
            payroll = {
                month: now.getMonth() + 1,
                year: now.getFullYear(),
                payslips: t.count,
                grossPayroll: t.gross,
                netPayroll: t.net,
                totalDeductions: t.deductions,
                employeesPaid: t.paid,
            };
        }

        // Pending compensation requests are only meaningful to payroll-adjacent roles.
        let pendingCompensationRequests = 0;
        if (canSeePayroll) {
            pendingCompensationRequests = await CompensationRequest.countDocuments({ status: 'PENDING' });
        }

        // The activity feed is the audit trail, so it is limited to roles that may read it.
        let recentActivity = [];
        if (ACTIVITY_ROLES.includes(req.user?.role)) {
            recentActivity = await NotificationAudit_1.AuditLog.find({ action: { $nin: ['LOGIN', 'LOGOUT', 'LOGIN_FAILED'] } })
                .select('action module recordLabel userEmail createdAt')
                .sort({ createdAt: -1 })
                .limit(8)
                .lean();
        }

        const assetByStatus = Object.fromEntries(assetCounts.map((a) => [a._id, a.count]));

        // Same audience rule as the Announcements page: admins see everything for
        // oversight, everyone else only sees what is actually addressed to them.
        const isContentAdmin = roles_1.CONTENT_ADMIN_ROLES.includes(req.user?.role);
        const visibleAnnouncements = (isContentAdmin ? announcements : announcements.filter((a) => targetsEmployee(a, employee)))
            .slice(0, 5)
            .map(({ targetAudience, targetDepartments, targetDesignations, targetEmployees, ...rest }) => rest);

        res.json({
            data: {
                stats: {
                    totalEmployees,
                    activeEmployees,
                    inactiveEmployees,
                    onLeaveEmployees,
                    probation,
                    noticePeriod,
                    newJoiners,
                    pendingLeave,
                    expiringDocs,
                    pendingDocs,
                    presentToday,
                    // Kept for older callers that read `todayAttendance`.
                    todayAttendance: presentToday,
                    absentToday: Math.max(0, activeEmployees - presentToday),
                    lateToday: attendanceByStatus.LATE || 0,
                    totalAssets: assetCounts.reduce((sum, a) => sum + a.count, 0),
                    assignedAssets: assetByStatus.ASSIGNED || 0,
                    availableAssets: assetByStatus.AVAILABLE || 0,
                },
                payroll,
                pendingCompensationRequests,
                attendanceByStatus,
                upcomingBirthdays,
                departmentDistribution: deptDist,
                monthlyJoiners,
                announcements: visibleAnnouncements,
                recentActivity,
                me: employee || null,
            },
        });
    }
    catch (err) { next(err); }
};
exports.getDashboardStats = getDashboardStats;
