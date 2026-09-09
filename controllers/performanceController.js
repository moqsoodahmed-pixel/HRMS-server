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
        await review.deleteOne();
        await auditService.log(req, { action: 'PERFORMANCE_REVIEW_DELETED', module: 'PERFORMANCE', recordId: id });
        res.json({ message: 'Draft review deleted' });
    }
    catch (err) { next(err); }
};
exports.deleteReview = deleteReview;

const getPerformanceStats = async (req, res, next) => {
    try {
        const byStatus = await PerformanceReview.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
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
