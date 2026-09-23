"use strict";
// ─── Data Health Check ─────────────────────────────────────────────────────
// Read-only aggregate counts pulled straight from the database, exposed
// through the app itself so the Founder/CEO/CTO can sanity-check "does what
// the app shows match what's actually stored" WITHOUT needing direct
// MongoDB Atlas access — which would otherwise mean creating a database
// user and opening Atlas's Network Access list to the internet just to run
// a one-off check. Every number below is read from the exact same
// Mongoose models the rest of the app already uses, so there is no second
// source of truth to keep in sync.
//
// This never writes anything — every query here is a count/aggregate read.

const { Lead } = require("../models/Lead");
const { Employee } = require("../models/Employee");
const { User } = require("../models/User");

/**
 * GET /api/diagnostics/data-health
 * Elevated roles only (see routes/index.js — authorize() with no list).
 */
const getDataHealth = async (req, res, next) => {
    try {
        const [
            leadsTotal,
            leadsByStatus,
            leadsByState,
            leadsUnassigned,
            leadsByAssignee,
            employeesTotalActive,
            employeesByDepartment,
            employeesByEmploymentStatus,
            employeesByOnboardingStatus,
            usersByRole,
            usersInactive,
        ] = await Promise.all([
            Lead.countDocuments({}),
            Lead.aggregate([
                { $group: { _id: "$status", count: { $sum: 1 } } },
                { $sort: { _id: 1 } },
            ]),
            Lead.aggregate([
                { $group: { _id: "$state", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]),
            Lead.countDocuments({ assignedTo: null }),
            Lead.aggregate([
                { $match: { assignedTo: { $ne: null } } },
                { $group: { _id: "$assignedTo", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]),
            Employee.countDocuments({ isArchived: false }),
            Employee.aggregate([
                { $match: { isArchived: false } },
                { $group: { _id: "$department", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]),
            Employee.aggregate([
                { $match: { isArchived: false } },
                { $group: { _id: "$status", count: { $sum: 1 } } },
                { $sort: { _id: 1 } },
            ]),
            Employee.aggregate([
                { $match: { isArchived: false } },
                { $group: { _id: "$onboardingStatus", count: { $sum: 1 } } },
                { $sort: { _id: 1 } },
            ]),
            User.aggregate([
                { $group: { _id: "$role", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]),
            User.countDocuments({ isActive: false }),
        ]);

        // The lead-by-assignee aggregate only has raw Employee ObjectIds —
        // resolve them to names/departments so the report is actually readable
        // without a separate lookup.
        const assigneeIds = leadsByAssignee.map((r) => r._id).filter(Boolean);
        const assignees = await Employee.find({ _id: { $in: assigneeIds } })
            .select("fullName employeeCode department status isArchived")
            .lean();
        const assigneeMap = new Map(assignees.map((e) => [String(e._id), e]));
        const leadsByAssigneeNamed = leadsByAssignee.map((r) => {
            const emp = assigneeMap.get(String(r._id));
            return {
                employeeId: r._id,
                name: emp?.fullName || "(employee no longer exists)",
                employeeCode: emp?.employeeCode || null,
                department: emp?.department || null,
                isArchived: emp?.isArchived ?? null,
                count: r.count,
            };
        });

        res.json({
            data: {
                generatedAt: new Date(),
                leads: {
                    total: leadsTotal,
                    byStatus: leadsByStatus.map((r) => ({ status: r._id || "(none)", count: r.count })),
                    byState: leadsByState.map((r) => ({ state: r._id || "(none)", count: r.count })),
                    unassigned: leadsUnassigned,
                    byAssignee: leadsByAssigneeNamed,
                },
                employees: {
                    totalActive: employeesTotalActive,
                    byDepartment: employeesByDepartment.map((r) => ({ department: r._id || "(none)", count: r.count })),
                    byEmploymentStatus: employeesByEmploymentStatus.map((r) => ({ status: r._id || "(none)", count: r.count })),
                    byOnboardingStatus: employeesByOnboardingStatus.map((r) => ({ status: r._id || "(none)", count: r.count })),
                },
                users: {
                    byRole: usersByRole.map((r) => ({ role: r._id || "(none)", count: r.count })),
                    inactiveAccounts: usersInactive,
                },
            },
        });
    } catch (err) { next(err); }
};

module.exports = { getDataHealth };