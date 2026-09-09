"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.approveOnboarding = exports.rejectOnboarding = exports.getOnboardingSubmission = exports.listOnboardingSubmissions = exports.submitOnboarding = exports.saveOnboardingStep = exports.getMyOnboarding = void 0;
const { Employee } = require("../models/Employee");
const { AppError } = require("../middleware/errorHandler");
const { auditService } = require("../services/auditService");
const { Notification } = require("../models/NotificationAudit");
const { z } = require("zod");

/**
 * Employee self-service onboarding wizard. Deliberately separate from
 * controllers/taskController.js's "onboarding" (an HR-run checklist of
 * IT-setup/induction tasks against OnboardingTask) — this module is the
 * new-hire's own 7-step data-collection form (Personal/Education/Experience/
 * Bank/Emergency/Documents/Review) that gates access via
 * Employee.onboardingStatus. See middleware/auth.js requireOnboardingApproved
 * for the enforcement side.
 */

const STEP_ORDER = ['personal', 'education', 'experience', 'bank', 'emergency', 'documents'];
const STEP_NUMBER = Object.fromEntries(STEP_ORDER.map((key, i) => [key, i + 1]));

const stepSchemas = {
    personal: z.object({
        fullName: z.string().min(1, 'Full name is required'),
        phone: z.string().min(1, 'Phone number is required'),
        dateOfBirth: z.string().min(1, 'Date of birth is required'),
        gender: z.string().min(1, 'Gender is required'),
        address: z.string().min(1, 'Address is required'),
    }),
    education: z.object({
        records: z.array(z.object({
            institution: z.string().min(1),
            qualification: z.string().min(1),
            fieldOfStudy: z.string().optional().or(z.literal('')),
            yearOfCompletion: z.string().optional().or(z.literal('')),
        })).min(1, 'At least one education record is required'),
    }),
    experience: z.object({
        hasPriorExperience: z.boolean(),
        records: z.array(z.object({
            company: z.string().min(1),
            designation: z.string().min(1),
            fromDate: z.string().optional().or(z.literal('')),
            toDate: z.string().optional().or(z.literal('')),
        })).optional().default([]),
    }),
    bank: z.object({
        accountHolderName: z.string().min(1, 'Account holder name is required'),
        accountNumber: z.string().min(1, 'Account number is required'),
        bankName: z.string().min(1, 'Bank name is required'),
        ifscCode: z.string().min(1, 'IFSC code is required'),
    }),
    emergency: z.object({
        contactName: z.string().min(1, 'Emergency contact name is required'),
        relationship: z.string().min(1, 'Relationship is required'),
        contactPhone: z.string().min(1, 'Emergency contact phone is required'),
    }),
    documents: z.object({
        acknowledged: z.boolean().refine((v) => v === true, 'Please confirm your documents are ready/uploaded'),
        notes: z.string().optional().or(z.literal('')),
    }),
};

function projectOnboarding(employee) {
    return {
        onboardingStatus: employee.onboardingStatus,
        onboardingStep: employee.onboardingStep,
        onboardingData: employee.onboardingData || {},
        onboardingSubmittedAt: employee.onboardingSubmittedAt,
        onboardingApprovedAt: employee.onboardingApprovedAt,
        onboardingRejectionReason: employee.onboardingRejectionReason,
    };
}

async function findOwnEmployee(req) {
    const employee = await Employee.findOne({ user: req.user.userId });
    if (!employee) throw new AppError('No employee record is linked to your account', 404, 'NOT_FOUND');
    return employee;
}

const getMyOnboarding = async (req, res, next) => {
    try {
        const employee = await findOwnEmployee(req);
        res.json({ data: projectOnboarding(employee) });
    }
    catch (err) { next(err); }
};
exports.getMyOnboarding = getMyOnboarding;

const saveOnboardingStep = async (req, res, next) => {
    try {
        const { stepKey } = req.params;
        const schema = stepSchemas[stepKey];
        if (!schema) throw new AppError('Unknown onboarding step', 400, 'INVALID_STEP');

        const employee = await findOwnEmployee(req);
        if (employee.onboardingStatus === 'APPROVED') {
            throw new AppError('Onboarding is already approved and cannot be edited', 400, 'ONBOARDING_APPROVED');
        }
        if (employee.onboardingStatus === 'SUBMITTED') {
            throw new AppError('Onboarding is already submitted and awaiting approval', 400, 'ONBOARDING_SUBMITTED');
        }

        const data = schema.parse(req.body);
        employee.onboardingData = { ...(employee.onboardingData || {}), [stepKey]: data };
        employee.onboardingStep = Math.max(employee.onboardingStep || 0, STEP_NUMBER[stepKey]);
        if (employee.onboardingStatus === 'NOT_STARTED' || employee.onboardingStatus === 'REJECTED') {
            employee.onboardingStatus = 'IN_PROGRESS';
        }
        await employee.save();
        res.json({ data: projectOnboarding(employee) });
    }
    catch (err) { next(err); }
};
exports.saveOnboardingStep = saveOnboardingStep;

const submitOnboarding = async (req, res, next) => {
    try {
        const employee = await findOwnEmployee(req);
        if (employee.onboardingStatus === 'APPROVED') {
            throw new AppError('Onboarding is already approved', 400, 'ONBOARDING_APPROVED');
        }
        if (employee.onboardingStatus === 'SUBMITTED') {
            throw new AppError('Onboarding was already submitted and is awaiting approval', 400, 'ONBOARDING_SUBMITTED');
        }
        const data = employee.onboardingData || {};
        const missing = STEP_ORDER.filter((key) => !data[key]);
        if (missing.length) {
            throw new AppError(`Please complete all steps before submitting: ${missing.join(', ')}`, 400, 'ONBOARDING_INCOMPLETE_STEPS');
        }
        employee.onboardingStatus = 'SUBMITTED';
        employee.onboardingSubmittedAt = new Date();
        employee.onboardingRejectionReason = undefined;
        await employee.save();

        await auditService.log(req, {
            action: 'ONBOARDING_SUBMITTED', module: 'ONBOARDING',
            recordId: String(employee._id), recordLabel: employee.fullName,
        });

        res.json({ data: projectOnboarding(employee) });
    }
    catch (err) { next(err); }
};
exports.submitOnboarding = submitOnboarding;

/** HR/Admin: list employees whose onboarding needs attention or review. */
const listOnboardingSubmissions = async (req, res, next) => {
    try {
        const filter = {};
        if (req.query.status) filter.onboardingStatus = req.query.status;
        const employees = await Employee.find(filter)
            .select('employeeCode fullName department designation onboardingStatus onboardingStep onboardingSubmittedAt onboardingApprovedAt onboardingRejectionReason')
            .sort({ onboardingSubmittedAt: -1, updatedAt: -1 })
            .lean();
        res.json({ data: employees });
    }
    catch (err) { next(err); }
};
exports.listOnboardingSubmissions = listOnboardingSubmissions;

/** HR/Admin: full onboarding record for one employee, for review. */
const getOnboardingSubmission = async (req, res, next) => {
    try {
        const employee = await Employee.findById(req.params.employeeId)
            .select('employeeCode fullName department designation onboardingStatus onboardingStep onboardingData onboardingSubmittedAt onboardingApprovedAt onboardingRejectionReason');
        if (!employee) throw new AppError('Employee not found', 404, 'NOT_FOUND');
        res.json({ data: employee });
    }
    catch (err) { next(err); }
};
exports.getOnboardingSubmission = getOnboardingSubmission;

/** Throws if the reviewer's own linked employee record is the one under review — nobody approves their own onboarding. */
async function assertNotSelfReview(req, targetEmployeeId) {
    const own = await Employee.findOne({ user: req.user.userId }).select('_id').lean();
    if (own && String(own._id) === String(targetEmployeeId)) {
        throw new AppError('You cannot approve or reject your own onboarding', 403, 'SELF_REVIEW_FORBIDDEN');
    }
}

const approveOnboarding = async (req, res, next) => {
    try {
        await assertNotSelfReview(req, req.params.employeeId);
        const employee = await Employee.findById(req.params.employeeId).select('fullName user onboardingStatus');
        if (!employee) throw new AppError('Employee not found', 404, 'NOT_FOUND');
        employee.onboardingStatus = 'APPROVED';
        employee.onboardingApprovedAt = new Date();
        employee.onboardingApprovedBy = req.user.userId;
        employee.onboardingRejectionReason = undefined;
        await employee.save();

        if (employee.user) {
            await Notification.create({
                user: employee.user,
                type: 'ONBOARDING_APPROVED',
                title: 'Onboarding approved',
                message: 'Your onboarding has been approved. All modules are now unlocked.',
                relatedModel: 'Employee',
                relatedId: employee._id,
            }).catch((err) => console.error('Notification create failed:', err.message));
        }
        await auditService.log(req, {
            action: 'ONBOARDING_APPROVED', module: 'ONBOARDING',
            recordId: String(employee._id), recordLabel: employee.fullName,
        });

        res.json({ data: projectOnboarding(employee) });
    }
    catch (err) { next(err); }
};
exports.approveOnboarding = approveOnboarding;

const rejectSchema = z.object({ reason: z.string().min(1, 'A rejection reason is required').max(500) });

const rejectOnboarding = async (req, res, next) => {
    try {
        const { reason } = rejectSchema.parse(req.body);
        await assertNotSelfReview(req, req.params.employeeId);
        const employee = await Employee.findById(req.params.employeeId).select('fullName user onboardingStatus');
        if (!employee) throw new AppError('Employee not found', 404, 'NOT_FOUND');
        employee.onboardingStatus = 'REJECTED';
        employee.onboardingRejectionReason = reason;
        await employee.save();

        if (employee.user) {
            await Notification.create({
                user: employee.user,
                type: 'ONBOARDING_REJECTED',
                title: 'Onboarding needs corrections',
                message: reason,
                relatedModel: 'Employee',
                relatedId: employee._id,
            }).catch((err) => console.error('Notification create failed:', err.message));
        }
        await auditService.log(req, {
            action: 'ONBOARDING_REJECTED', module: 'ONBOARDING',
            recordId: String(employee._id), recordLabel: employee.fullName,
        });

        res.json({ data: projectOnboarding(employee) });
    }
    catch (err) { next(err); }
};
exports.rejectOnboarding = rejectOnboarding;
