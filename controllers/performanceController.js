"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPerformanceStats = exports.deleteReview = exports.completeReview = exports.submitReview = exports.updateReview = exports.createReview = exports.getMyReviews = exports.getReview = exports.listReviews = void 0;
const { PerformanceReview } = require("../models/PerformanceReview");
const { Employee } = require("../models/Employee");
const { Notification } = require("../models/NotificationAudit");
const { AppError } = require("../middleware/errorHandler");
const { auditService } = require("../services/auditService");
const { searchRegex } = require("../utils/helpers");
const { z } = require("zod");

/**
 * Performance reviews — the page was empty before this step; this is the
 * first real backend for it. Criteria/ratings are the only source for
 * overallRating (recomputeOverallRating below) — a client can never submit
 * an overall score directly.
 */

const criterionSchema = z.object({
    category: z.string().min(1, 'Criterion name is required').max(120),
    rating: z.coerce.number().int().min(1).max(5),
    comments: z.string().max(1000).optional().or(z.literal('')),
});

const createSchema = z.object({
    employeeId: z.string().min(1, 'Employee is required'),
    reviewPeriod: z.string().min(1, 'Review period is required').max(60),
    criteria: z.array(criterionSchema).optional().default([]),
    overallComments: z.string().max(2000).optional().or(z.literal('')),
});

const updateSchema = z.object({
    reviewPeriod: z.string().min(1).max(60).optional(),
    criteria: z.array(criterionSchema).optional(),
    overallComments: z.string().max(2000).optional().or(z.literal('')),
});

function recomputeOverallRating(review) {
    if (!review.criteria || review.criteria.length === 0) {
        review.overallRating = undefined;
        return;
    }
    const sum = review.criteria.reduce((acc, c) => acc + c.rating, 0);
    review.overallRating = Math.round((sum / review.criteria.length) * 10) / 10;
}

/** Throws if the reviewer's own linked employee record is the subject of the review. */
async function assertNotSelfReview(req, employeeId) {
    const own = await Employee.findOne({ user: req.user.userId }).select('_id').lean();
    if (own && String(own._id) === String(employeeId)) {
        throw new AppError('You cannot create or submit a performance review for yourself', 403, 'SELF_REVIEW_FORBIDDEN');
    }
}

/**
 * Returns the set of Employee ids a caller may act on, or `null` when the
 * caller is unrestricted (elevated / HR_ADMIN / PROJECT_HEAD — the existing
 * company-wide reviewers). A plain MANAGER (a Sales Team Lead, per the chosen
 * design) is restricted to their own direct reports — the reps whose
 * Reports-To/Manager is this person — so a team lead can review their team
 * and only their team. Any other role that somehow reaches a performance
 * route gets an empty set (nothing) rather than accidental access.
 */
async function resolveReviewableScope(req) {
    const { isElevated } = require('../utils/roles');
    const role = req.user?.role;
    if (isElevated(role) || role === 'HR_ADMIN' || role === 'PROJECT_HEAD') return null; // unrestricted (unchanged)
    if (role === 'MANAGER') {
        const self = await Employee.findOne({ user: req.user.userId }).select('_id').lean();
        if (!self) return [];
        const reports = await Employee.find({ manager: self._id, isArchived: false }).select('_id').lean();
        return reports.map((r) => r._id);
    }
    return [];
}

/**
 * Enforces that `employeeId` is inside the caller's reviewable scope. A no-op
 * for unrestricted reviewers; a hard 403 for a team lead reaching outside
 * their own team. This is the security boundary — the client also narrows its
 * pickers, but every write path re-checks here so a hand-crafted request
 * can't review someone else's team.
 */
async function assertReviewableSubject(req, employeeId) {
    const teamIds = await resolveReviewableScope(req);
    if (teamIds === null) return;
    if (!teamIds.map(String).includes(String(employeeId))) {
        throw new AppError('You can only manage performance reviews for your own team members', 403, 'OUT_OF_TEAM_SCOPE');
    }
}

/** HR/Admin: list reviews, optionally filtered by employee/department/period/status/search. */
const listReviews = async (req, res, next) => {
    try {
        const { status, department, reviewPeriod, search, employeeId } = req.query;
        const filter = {};
        if (status) filter.status = status;
        if (department) filter.department = department;
        if (reviewPeriod) filter.reviewPeriod = reviewPeriod;
        if (employeeId) filter.employee = employeeId;

        if (search) {
            const ids = await Employee.find({
                isArchived: false,
                $or: [{ fullName: searchRegex(search) }, { employeeCode: searchRegex(search) }],
            }).select('_id').lean();
            filter.employee = filter.employee ? filter.employee : { $in: ids.map((i) => i._id) };
        }

        // Team-lead (MANAGER) scoping: intersect whatever employee filter is
        // already in place with the caller's own team, so a Sales Team Lead
        // only ever lists their team's reviews. Unrestricted reviewers skip this.
        const teamIds = await resolveReviewableScope(req);
        if (teamIds !== null) {
            const teamIdStrs = teamIds.map(String);
            if (filter.employee && filter.employee.$in) {
                filter.employee = { $in: filter.employee.$in.filter((idv) => teamIdStrs.includes(String(idv))) };
            } else if (filter.employee) {
                if (!teamIdStrs.includes(String(filter.employee))) filter.employee = { $in: [] };
            } else {
                filter.employee = { $in: teamIds };
            }
        }

        const reviews = await PerformanceReview.find(filter)
            .populate('employee', 'fullName employeeCode department designation')
            .populate('reviewer', 'email')
            .sort({ createdAt: -1 })
            .lean();
        res.json({ data: reviews });
    }
    catch (err) { next(err); }
};
exports.listReviews = listReviews;

const getReview = async (req, res, next) => {
    try {
        const review = await PerformanceReview.findById(req.params.id)
            .populate('employee', 'fullName employeeCode department designation')
            .populate('reviewer', 'email');
        if (!review) throw new AppError('Review not found', 404, 'NOT_FOUND');
        await assertReviewableSubject(req, review.employee?._id || review.employee);
        res.json({ data: review });
    }
    catch (err) { next(err); }
};
exports.getReview = getReview;

/** Employee: their own SUBMITTED/COMPLETED reviews only — never DRAFT, never another employee's. */
const getMyReviews = async (req, res, next) => {
    try {
        const employee = await Employee.findOne({ user: req.user.userId }).select('_id');
        if (!employee) throw new AppError('No employee record is linked to your account', 404, 'NOT_FOUND');
        const reviews = await PerformanceReview.find({ employee: employee._id, status: { $in: ['SUBMITTED', 'COMPLETED'] } })
            .populate('reviewer', 'email')
            .sort({ createdAt: -1 })
            .lean();
        res.json({ data: reviews });
    }
    catch (err) { next(err); }
};
exports.getMyReviews = getMyReviews;

const createReview = async (req, res, next) => {
    try {
        const data = createSchema.parse(req.body);
        await assertNotSelfReview(req, data.employeeId);
        await assertReviewableSubject(req, data.employeeId);
        const employee = await Employee.findById(data.employeeId).select('department designation');
        if (!employee) throw new AppError('Employee not found', 404, 'NOT_FOUND');

        const review = new PerformanceReview({
            employee: data.employeeId,
            department: employee.department,
            designation: employee.designation,
            reviewPeriod: data.reviewPeriod,
            reviewer: req.user.userId,
            criteria: data.criteria,
            overallComments: data.overallComments || undefined,
            status: 'DRAFT',
        });
        recomputeOverallRating(review);
        await review.save();

        await auditService.log(req, { action: 'PERFORMANCE_REVIEW_CREATED', module: 'PERFORMANCE', recordId: String(review._id), recordLabel: employee.fullName });
        res.status(201).json({ data: review });
    }
    catch (err) { next(err); }
};
exports.createReview = createReview;

/** Draft edits only — a submitted/completed review is finalised and no longer editable here. */
const updateReview = async (req, res, next) => {
    try {
        const { id } = req.params;
        const data = updateSchema.parse(req.body);
        const review = await PerformanceReview.findById(id);
        if (!review) throw new AppError('Review not found', 404, 'NOT_FOUND');
        if (review.status !== 'DRAFT') throw new AppError('Only a draft review can be edited', 400, 'NOT_DRAFT');
        await assertNotSelfReview(req, review.employee);
        await assertReviewableSubject(req, review.employee);

        if (data.reviewPeriod !== undefined) review.reviewPeriod = data.reviewPeriod;
        if (data.criteria !== undefined) review.criteria = data.criteria;
        if (data.overallComments !== undefined) review.overallComments = data.overallComments;
        recomputeOverallRating(review);
        await review.save();

        await auditService.log(req, { action: 'PERFORMANCE_REVIEW_UPDATED', module: 'PERFORMANCE', recordId: id });
        res.json({ data: review });
    }
    catch (err) { next(err); }
};
exports.updateReview = updateReview;

const submitReview = async (req, res, next) => {
    try {
        const { id } = req.params;
        const review = await PerformanceReview.findById(id).populate('employee', 'fullName user');
        if (!review) throw new AppError('Review not found', 404, 'NOT_FOUND');
        if (review.status !== 'DRAFT') throw new AppError('This review has already been submitted', 400, 'ALREADY_SUBMITTED');
        if (!review.criteria.length) throw new AppError('Add at least one rated criterion before submitting', 400, 'NO_CRITERIA');
        await assertNotSelfReview(req, review.employee._id);
        await assertReviewableSubject(req, review.employee._id);

        review.status = 'SUBMITTED';
        review.submittedAt = new Date();
        await review.save();

        if (review.employee.user) {
            await Notification.create({
                user: review.employee.user, type: 'PERFORMANCE_REVIEW_SUBMITTED',
                title: 'Performance review available', message: `Your ${review.reviewPeriod} performance review is ready to view.`,
                relatedModel: 'PerformanceReview', relatedId: review._id,
            }).catch((e) => console.error('Notification create failed:', e.message));
        }
        await auditService.log(req, { action: 'PERFORMANCE_REVIEW_SUBMITTED', module: 'PERFORMANCE', recordId: id, recordLabel: review.employee.fullName });
        res.json({ data: review });
    }
    catch (err) { next(err); }
};
exports.submitReview = submitReview;

const completeReview = async (req, res, next) => {
    try {
        const { id } = req.params;
        const review = await PerformanceReview.findById(id);
        if (!review) throw new AppError('Review not found', 404, 'NOT_FOUND');
        if (review.status !== 'SUBMITTED') throw new AppError('Only a submitted review can be marked complete', 400, 'NOT_SUBMITTED');
        await assertNotSelfReview(req, review.employee);
        await assertReviewableSubject(req, review.employee);

        review.status = 'COMPLETED';
        review.completedAt = new Date();
        await review.save();

        await auditService.log(req, { action: 'PERFORMANCE_REVIEW_COMPLETED', module: 'PERFORMANCE', recordId: id });
        res.json({ data: review });
    }
    catch (err) { next(err); }
};
exports.completeReview = completeReview;

/** Only a still-draft review may be deleted outright (nothing has been shown to the employee yet). */
const deleteReview = async (req, res, next) => {
    try {
        const { id } = req.params;
        const review = await PerformanceReview.findById(id);
        if (!review) throw new AppError('Review not found', 404, 'NOT_FOUND');
        if (review.status !== 'DRAFT') throw new AppError('Only a draft review can be deleted', 400, 'NOT_DRAFT');
        await assertReviewableSubject(req, review.employee);
        await review.deleteOne();
        await auditService.log(req, { action: 'PERFORMANCE_REVIEW_DELETED', module: 'PERFORMANCE', recordId: id });
        res.json({ message: 'Draft review deleted' });
    }
    catch (err) { next(err); }
};
exports.deleteReview = deleteReview;

const getPerformanceStats = async (req, res, next) => {
    try {
        // Team-lead (MANAGER) sees stats for their own team only; unrestricted
        // reviewers see the whole company (unchanged).
        const teamIds = await resolveReviewableScope(req);
        const match = teamIds === null ? {} : { employee: { $in: teamIds } };
        const byStatus = await PerformanceReview.aggregate([
            { $match: match },
            { $group: { _id: '$status', count: { $sum: 1 } } },
        ]);
        const counts = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
        res.json({
            data: {
                total: byStatus.reduce((sum, s) => sum + s.count, 0),
                draft: counts.DRAFT || 0,
                submitted: counts.SUBMITTED || 0,
                completed: counts.COMPLETED || 0,
            },
        });
    }
    catch (err) { next(err); }
};
exports.getPerformanceStats = getPerformanceStats;

/**
 * The employees the caller may open a review for — their own team for a
 * MANAGER (Sales Team Lead), everyone for unrestricted reviewers. Powers the
 * "Employee" picker in the create-review modal so a team lead is only ever
 * offered their own reports (the server still re-checks on write).
 */
const getReviewableEmployees = async (req, res, next) => {
    try {
        const teamIds = await resolveReviewableScope(req);
        const query = { isArchived: false, status: { $ne: 'INACTIVE' } };
        if (teamIds !== null) query._id = { $in: teamIds };
        const employees = await Employee.find(query)
            .select('fullName employeeCode department designation')
            .sort({ fullName: 1 })
            .lean();
        res.json({ data: employees });
    }
    catch (err) { next(err); }
};
exports.getReviewableEmployees = getReviewableEmployees;