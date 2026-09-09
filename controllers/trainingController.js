"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadTrainingFile = exports.updateMyAssignment = exports.getMyAssignments = exports.getTrainingAssignees = exports.assignTraining = exports.getTrainingStats = exports.deleteTraining = exports.updateTraining = exports.createTraining = exports.getTraining = exports.listTrainings = void 0;
const { Training, TrainingAssignment } = require("../models/Training");
const { Employee } = require("../models/Employee");
const { Notification } = require("../models/NotificationAudit");
const { AppError } = require("../middleware/errorHandler");
const { auditService } = require("../services/auditService");
const { storageService } = require("../services/storageService");
const { z } = require("zod");

/**
 * Training catalog + assignment tracking. Reuses the exact same
 * storageService/upload middleware as EmployeeDocument for FILE material —
 * no parallel file storage. See models/Training.js for the model rationale.
 */

const baseSchema = {
    title: z.string().min(1, 'Title is required').max(160),
    description: z.string().max(2000).optional().or(z.literal('')),
    category: z.string().min(1, 'Category is required').max(80),
    durationMinutes: z.union([z.number(), z.string().transform((v) => (v === '' ? undefined : Number(v)))]).optional(),
    externalUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
    isActive: z.union([z.boolean(), z.string().transform((v) => v === 'true')]).optional(),
};
const createSchema = z.object({
    ...baseSchema,
    materialType: z.enum(['FILE', 'VIDEO_URL', 'LINK']),
}).refine((d) => d.materialType === 'FILE' || Boolean(d.externalUrl), {
    message: 'A URL is required for video/link material', path: ['externalUrl'],
});
const updateSchema = z.object(baseSchema).partial();

function safeFilename(name) {
    return String(name || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
}

const listTrainings = async (req, res, next) => {
    try {
        const filter = req.query.includeInactive === 'true' ? {} : { isActive: true };
        if (req.query.category) filter.category = req.query.category;
        const trainings = await Training.find(filter).populate('createdBy', 'email').sort({ createdAt: -1 }).lean();

        const counts = await TrainingAssignment.aggregate([
            { $match: { training: { $in: trainings.map((t) => t._id) } } },
            { $group: { _id: { training: '$training', status: '$status' }, count: { $sum: 1 } } },
        ]);
        const byTraining = {};
        counts.forEach((c) => {
            const key = String(c._id.training);
            byTraining[key] = byTraining[key] || { assigned: 0, inProgress: 0, completed: 0, total: 0 };
            byTraining[key].total += c.count;
            if (c._id.status === 'ASSIGNED') byTraining[key].assigned += c.count;
            if (c._id.status === 'IN_PROGRESS') byTraining[key].inProgress += c.count;
            if (c._id.status === 'COMPLETED') byTraining[key].completed += c.count;
        });

        res.json({
            data: trainings.map((t) => ({ ...t, assignmentSummary: byTraining[String(t._id)] || { assigned: 0, inProgress: 0, completed: 0, total: 0 } })),
        });
    }
    catch (err) { next(err); }
};
exports.listTrainings = listTrainings;

const getTraining = async (req, res, next) => {
    try {
        const training = await Training.findById(req.params.id).populate('createdBy', 'email');
        if (!training) throw new AppError('Training not found', 404, 'NOT_FOUND');
        res.json({ data: training });
    }
    catch (err) { next(err); }
};
exports.getTraining = getTraining;

const createTraining = async (req, res, next) => {
    try {
        const data = createSchema.parse({ ...req.body, durationMinutes: req.body.durationMinutes });
        if (data.materialType === 'FILE' && !req.file) {
            throw new AppError('A file is required for FILE material', 400, 'VALIDATION_ERROR');
        }

        const training = new Training({
            title: data.title, description: data.description || undefined, category: data.category,
            materialType: data.materialType, durationMinutes: data.durationMinutes,
            externalUrl: data.materialType === 'FILE' ? undefined : data.externalUrl,
            createdBy: req.user.userId,
        });

        if (data.materialType === 'FILE' && req.file) {
            training.filePath = await storageService.upload(req.file, 'training');
            training.fileName = req.file.originalname;
            training.fileMimeType = req.file.mimetype;
            training.fileSize = req.file.size;
        }
        await training.save();

        await auditService.log(req, { action: 'TRAINING_CREATED', module: 'TRAINING', recordId: String(training._id), recordLabel: training.title });
        res.status(201).json({ data: training });
    }
    catch (err) { next(err); }
};
exports.createTraining = createTraining;

const updateTraining = async (req, res, next) => {
    try {
        const { id } = req.params;
        const data = updateSchema.parse(req.body);
        const training = await Training.findById(id);
        if (!training) throw new AppError('Training not found', 404, 'NOT_FOUND');

        if (data.title !== undefined) training.title = data.title;
        if (data.description !== undefined) training.description = data.description;
        if (data.category !== undefined) training.category = data.category;
        if (data.durationMinutes !== undefined) training.durationMinutes = data.durationMinutes;
        if (data.externalUrl !== undefined && training.materialType !== 'FILE') training.externalUrl = data.externalUrl;
        if (data.isActive !== undefined) training.isActive = data.isActive;

        if (req.file && training.materialType === 'FILE') {
            training.filePath = await storageService.upload(req.file, 'training');
            training.fileName = req.file.originalname;
            training.fileMimeType = req.file.mimetype;
            training.fileSize = req.file.size;
        }
        await training.save();

        await auditService.log(req, { action: 'TRAINING_UPDATED', module: 'TRAINING', recordId: id, recordLabel: training.title, newValue: data });
        res.json({ data: training });
    }
    catch (err) { next(err); }
};
exports.updateTraining = updateTraining;

/** Soft "delete" — deactivate rather than remove, preserving assignment history. */
const deleteTraining = async (req, res, next) => {
    try {
        const { id } = req.params;
        const training = await Training.findByIdAndUpdate(id, { isActive: false }, { new: true });
        if (!training) throw new AppError('Training not found', 404, 'NOT_FOUND');
        await auditService.log(req, { action: 'TRAINING_DEACTIVATED', module: 'TRAINING', recordId: id, recordLabel: training.title });
        res.json({ data: training });
    }
    catch (err) { next(err); }
};
exports.deleteTraining = deleteTraining;

/** Dashboard totals — all real aggregates, no fabricated numbers. */
const getTrainingStats = async (req, res, next) => {
    try {
        const [total, active, assignmentCounts] = await Promise.all([
            Training.countDocuments({}),
            Training.countDocuments({ isActive: true }),
            TrainingAssignment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        ]);
        const counts = Object.fromEntries(assignmentCounts.map((c) => [c._id, c.count]));
        const totalAssignments = assignmentCounts.reduce((sum, c) => sum + c.count, 0);
        const completed = counts.COMPLETED || 0;
        res.json({
            data: {
                totalTrainings: total,
                activeTrainings: active,
                totalAssignments,
                assigned: counts.ASSIGNED || 0,
                inProgress: counts.IN_PROGRESS || 0,
                completed,
                completionRate: totalAssignments > 0 ? Math.round((completed / totalAssignments) * 1000) / 10 : null,
            },
        });
    }
    catch (err) { next(err); }
};
exports.getTrainingStats = getTrainingStats;

const assignSchema = z.object({
    employeeIds: z.array(z.string().min(1)).min(1, 'Select at least one employee'),
});

/** Assigns a training to one or more employees. Duplicates are silently skipped. */
const assignTraining = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { employeeIds } = assignSchema.parse(req.body);
        const training = await Training.findById(id);
        if (!training) throw new AppError('Training not found', 404, 'NOT_FOUND');

        const employees = await Employee.find({ _id: { $in: employeeIds } }).select('_id fullName user');
        const results = { assigned: 0, skipped: 0 };
        for (const emp of employees) {
            try {
                await TrainingAssignment.create({ training: id, employee: emp._id, assignedBy: req.user.userId });
                results.assigned += 1;
                if (emp.user) {
                    await Notification.create({
                        user: emp.user, type: 'TRAINING_ASSIGNED', title: 'New training assigned',
                        message: `"${training.title}" has been assigned to you.`,
                        relatedModel: 'Training', relatedId: training._id,
                    }).catch((e) => console.error('Notification create failed:', e.message));
                }
            } catch (e) {
                if (e.code === 11000) results.skipped += 1; else throw e;
            }
        }
        await auditService.log(req, {
            action: 'TRAINING_ASSIGNED', module: 'TRAINING', recordId: id, recordLabel: training.title, newValue: results,
        });
        res.json({ data: results });
    }
    catch (err) { next(err); }
};
exports.assignTraining = assignTraining;

/** HR/Admin: who a training is assigned to, and their completion status. */
const getTrainingAssignees = async (req, res, next) => {
    try {
        const { id } = req.params;
        const assignments = await TrainingAssignment.find({ training: id })
            .populate('employee', 'fullName employeeCode department designation')
            .sort({ assignedAt: -1 })
            .lean();
        res.json({ data: assignments });
    }
    catch (err) { next(err); }
};
exports.getTrainingAssignees = getTrainingAssignees;

/** Employee: their own assigned trainings. */
const getMyAssignments = async (req, res, next) => {
    try {
        const employee = await Employee.findOne({ user: req.user.userId }).select('_id');
        if (!employee) throw new AppError('No employee record is linked to your account', 404, 'NOT_FOUND');
        const assignments = await TrainingAssignment.find({ employee: employee._id })
            .populate({ path: 'training', select: 'title description category materialType externalUrl durationMinutes fileName isActive' })
            .sort({ assignedAt: -1 })
            .lean();
        res.json({ data: assignments.filter((a) => a.training) });
    }
    catch (err) { next(err); }
};
exports.getMyAssignments = getMyAssignments;

const statusSchema = z.object({ status: z.enum(['IN_PROGRESS', 'COMPLETED']) });

/** Employee updates the status of their OWN assignment only — ownership resolved server-side. */
const updateMyAssignment = async (req, res, next) => {
    try {
        const { status } = statusSchema.parse(req.body);
        const employee = await Employee.findOne({ user: req.user.userId }).select('_id');
        if (!employee) throw new AppError('No employee record is linked to your account', 404, 'NOT_FOUND');

        const assignment = await TrainingAssignment.findOne({ _id: req.params.id, employee: employee._id });
        if (!assignment) throw new AppError('Assignment not found', 404, 'NOT_FOUND');
        if (assignment.status === 'COMPLETED') {
            throw new AppError('This training is already marked complete', 400, 'ALREADY_COMPLETED');
        }

        assignment.status = status;
        if (status === 'IN_PROGRESS' && !assignment.startedAt) assignment.startedAt = new Date();
        if (status === 'COMPLETED') assignment.completedAt = new Date();
        await assignment.save();

        await auditService.log(req, {
            action: status === 'COMPLETED' ? 'TRAINING_COMPLETED' : 'TRAINING_STARTED',
            module: 'TRAINING', recordId: String(assignment._id),
        });
        res.json({ data: assignment });
    }
    catch (err) { next(err); }
};
exports.updateMyAssignment = updateMyAssignment;

/** Secure download — HR/Admin, or the employee it was assigned to; never a public URL. */
const downloadTrainingFile = async (req, res, next) => {
    try {
        const { HR_ROLES, isElevated } = require("../utils/roles");
        const training = await Training.findById(req.params.id);
        if (!training || !training.filePath) throw new AppError('Training material not found', 404, 'NOT_FOUND');

        if (!isElevated(req.user?.role) && !HR_ROLES.includes(req.user?.role)) {
            const employee = await Employee.findOne({ user: req.user?.userId }).select('_id');
            const assigned = employee && await TrainingAssignment.exists({ training: training._id, employee: employee._id });
            if (!assigned) throw new AppError('Access denied', 403, 'FORBIDDEN');
        }

        const buffer = await storageService.download(training.filePath);
        await auditService.log(req, { action: 'TRAINING_FILE_DOWNLOADED', module: 'TRAINING', recordId: String(training._id) });
        res.setHeader('Content-Type', training.fileMimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${safeFilename(training.fileName)}"`);
        res.send(buffer);
    }
    catch (err) { next(err); }
};
exports.downloadTrainingFile = downloadTrainingFile;
