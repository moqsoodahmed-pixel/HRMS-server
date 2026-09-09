"use strict";
const { DailyReport } = require("../models/DailyReport");
const { AppError } = require("../middleware/errorHandler");
const { isElevated } = require("../utils/roles");
const { parsePagination, assertObjectId, startOfDay, endOfDay } = require("../utils/helpers");

const MANAGEMENT_ROLES = ["FOUNDER_CEO", "CTO", "SUPER_ADMIN", "PROJECT_HEAD", "MANAGER", "HR_ADMIN"];

function canViewAll(role) {
  return isElevated(role) || ["PROJECT_HEAD", "MANAGER", "HR_ADMIN"].includes(role);
}

/**
 * POST /api/daily-reports
 */
const createReport = async (req, res, next) => {
  try {
    const { Employee } = require("../models/Employee");
    const emp = await Employee.findOne({ user: req.user.userId }).select("_id").lean();
    if (!emp) throw new AppError("Employee record not found", 404, "NOT_FOUND");

    const { date, workSummary, tasksCompleted, tasksInProgress, blockers, nextDayPlan, additionalNotes, hoursWorked } = req.body;
    if (!date) throw new AppError("Date is required", 400, "VALIDATION");

    const reportDate = new Date(date);
    reportDate.setUTCHours(0, 0, 0, 0);

    // Check if draft already exists
    const existing = await DailyReport.findOne({ employee: emp._id, date: reportDate });
    if (existing) throw new AppError("A report already exists for this date. Please edit the existing report.", 409, "DUPLICATE");

    const report = await DailyReport.create({
      employee: emp._id,
      date: reportDate,
      status: "DRAFT",
      workSummary, tasksCompleted, tasksInProgress, blockers, nextDayPlan, additionalNotes, hoursWorked,
      createdBy: req.user.userId,
    });

    res.status(201).json({ data: report });
  } catch (err) { next(err); }
};

/**
 * PATCH /api/daily-reports/:id
 */
const updateReport = async (req, res, next) => {
  try {
    const { id } = req.params;
    assertObjectId(id, "report id");

    const report = await DailyReport.findById(id);
    if (!report) throw new AppError("Report not found", 404, "NOT_FOUND");

    // Only the employee who created it can edit (while DRAFT)
    if (req.user?.role === "EMPLOYEE" || !canViewAll(req.user?.role)) {
      const { Employee } = require("../models/Employee");
      const emp = await Employee.findOne({ user: req.user.userId }).select("_id").lean();
      if (!emp || String(report.employee) !== String(emp._id)) {
        throw new AppError("Access denied", 403, "FORBIDDEN");
      }
      if (report.status === "SUBMITTED") {
        throw new AppError("Cannot edit a submitted report. Contact your manager.", 400, "SUBMITTED");
      }
    }

    const { workSummary, tasksCompleted, tasksInProgress, blockers, nextDayPlan, additionalNotes, hoursWorked } = req.body;
    Object.assign(report, { workSummary, tasksCompleted, tasksInProgress, blockers, nextDayPlan, additionalNotes, hoursWorked });
    await report.save();

    res.json({ data: report });
  } catch (err) { next(err); }
};

/**
 * POST /api/daily-reports/:id/submit
 */
const submitReport = async (req, res, next) => {
  try {
    const { id } = req.params;
    assertObjectId(id, "report id");

    const report = await DailyReport.findById(id);
    if (!report) throw new AppError("Report not found", 404, "NOT_FOUND");

    // Only the employee who owns it can submit
    const { Employee } = require("../models/Employee");
    const emp = await Employee.findOne({ user: req.user.userId }).select("_id").lean();
    if (!emp || String(report.employee) !== String(emp._id)) {
      throw new AppError("Access denied", 403, "FORBIDDEN");
    }

    if (report.status !== "DRAFT" && report.status !== "NEEDS_REVISION") {
      throw new AppError("Report is already submitted", 400, "INVALID_STATE");
    }

    report.status = "SUBMITTED";
    report.submittedAt = new Date();
    await report.save();

    // Send notification to management
    try {
      const { User } = require("../models/User");
      const { Notification } = require("../models/NotificationAudit");
      const empDoc = await Employee.findById(emp._id).select("fullName department").lean();
      const mgmtUsers = await User.find({
        role: { $in: ["FOUNDER_CEO", "CTO", "SUPER_ADMIN", "PROJECT_HEAD", "HR_ADMIN"] },
        isActive: { $ne: false },
      }).select("_id").lean();

      if (mgmtUsers.length > 0) {
        await Notification.insertMany(
          mgmtUsers.map(u => ({
            user: u._id,
            type: "DAILY_REPORT_SUBMITTED",
            title: "Daily Report Submitted",
            message: `${empDoc?.fullName || "An employee"} submitted their daily report for ${new Date(report.date).toDateString()}.`,
            relatedModel: "DailyReport",
            relatedId: report._id,
          }))
        );
      }
    } catch (_) {}

    res.json({ data: report });
  } catch (err) { next(err); }
};

/**
 * POST /api/daily-reports/:id/review
 */
const reviewReport = async (req, res, next) => {
  try {
    if (!canViewAll(req.user?.role)) throw new AppError("Forbidden", 403, "FORBIDDEN");

    const { id } = req.params;
    assertObjectId(id, "report id");

    const report = await DailyReport.findById(id);
    if (!report) throw new AppError("Report not found", 404, "NOT_FOUND");

    const { status, reviewerComments } = req.body;
    if (!["REVIEWED", "NEEDS_REVISION"].includes(status)) {
      throw new AppError("Status must be REVIEWED or NEEDS_REVISION", 400, "VALIDATION");
    }

    report.status = status;
    report.reviewedBy = req.user.userId;
    report.reviewedAt = new Date();
    if (reviewerComments !== undefined) report.reviewerComments = reviewerComments;
    await report.save();

    res.json({ data: report });
  } catch (err) { next(err); }
};

/**
 * GET /api/daily-reports/me
 */
const getMyReports = async (req, res, next) => {
  try {
    const { Employee } = require("../models/Employee");
    const emp = await Employee.findOne({ user: req.user.userId }).select("_id").lean();
    if (!emp) return res.json({ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } });

    const { page, limit, skip } = parsePagination(req.query, 20);
    const { status, startDate, endDate } = req.query;

    const query = { employee: emp._id };
    if (status) query.status = status;
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const [reports, total] = await Promise.all([
      DailyReport.find(query).sort({ date: -1 }).skip(skip).limit(limit).lean(),
      DailyReport.countDocuments(query),
    ]);

    res.json({ data: reports, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
};

/**
 * GET /api/daily-reports
 */
const getAllReports = async (req, res, next) => {
  try {
    if (!canViewAll(req.user?.role)) throw new AppError("Forbidden", 403, "FORBIDDEN");

    const { page, limit, skip } = parsePagination(req.query, 50);
    const { status, employeeId, department, startDate, endDate, search } = req.query;

    const query = {};
    if (status) query.status = status;
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    // If not elevated/full access, scope to team
    let employeeIds = null;
    if (!isElevated(req.user?.role) && req.user?.role !== "HR_ADMIN") {
      const { Employee } = require("../models/Employee");
      const emp = await Employee.findOne({ user: req.user.userId }).select("_id department").lean();
      if (emp && req.user?.role === "MANAGER") {
        const teamMembers = await Employee.find({ manager: emp._id }).select("_id").lean();
        employeeIds = teamMembers.map(m => m._id);
        if (employeeIds.length === 0) employeeIds = [emp._id];
      }
    }

    if (employeeId) {
      assertObjectId(employeeId, "employee id");
      query.employee = employeeId;
    } else if (employeeIds) {
      query.employee = { $in: employeeIds };
    }

    const [reports, total] = await Promise.all([
      DailyReport.find(query)
        .populate({ path: "employee", select: "fullName employeeCode department", populate: { path: "user", select: "email" } })
        .populate("reviewedBy", "email")
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DailyReport.countDocuments(query),
    ]);

    // Filter by department or search after populate
    let filtered = reports;
    if (department) filtered = filtered.filter(r => r.employee?.department === department);
    if (search) {
      const re = new RegExp(search, "i");
      filtered = filtered.filter(r =>
        re.test(r.employee?.fullName) ||
        re.test(r.employee?.employeeCode) ||
        re.test(r.workSummary)
      );
    }

    res.json({ data: filtered, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
};

/**
 * GET /api/daily-reports/:id
 */
const getReport = async (req, res, next) => {
  try {
    const { id } = req.params;
    assertObjectId(id, "report id");

    const report = await DailyReport.findById(id)
      .populate({ path: "employee", select: "fullName employeeCode department designation", populate: { path: "user", select: "email" } })
      .populate("reviewedBy", "email")
      .lean();

    if (!report) throw new AppError("Report not found", 404, "NOT_FOUND");

    // Employee can only see their own
    if (!canViewAll(req.user?.role)) {
      const { Employee } = require("../models/Employee");
      const emp = await Employee.findOne({ user: req.user.userId }).select("_id").lean();
      if (!emp || String(report.employee?._id) !== String(emp._id)) {
        throw new AppError("Access denied", 403, "FORBIDDEN");
      }
    }

    res.json({ data: report });
  } catch (err) { next(err); }
};

/**
 * GET /api/daily-reports/stats
 */
const getReportStats = async (req, res, next) => {
  try {
    if (!canViewAll(req.user?.role)) throw new AppError("Forbidden", 403, "FORBIDDEN");

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const [statusAgg, todayCount, pendingCount] = await Promise.all([
      DailyReport.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      DailyReport.countDocuments({ date: today }),
      DailyReport.countDocuments({ status: "SUBMITTED" }),
    ]);

    const byStatus = { DRAFT: 0, SUBMITTED: 0, REVIEWED: 0, NEEDS_REVISION: 0 };
    statusAgg.forEach(({ _id, count }) => { byStatus[_id] = count; });

    res.json({ data: { byStatus, todayCount, pendingReview: pendingCount } });
  } catch (err) { next(err); }
};

module.exports = { createReport, updateReport, submitReport, reviewReport, getMyReports, getAllReports, getReport, getReportStats };