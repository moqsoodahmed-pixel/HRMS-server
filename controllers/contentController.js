"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acknowledgePolicy = exports.archivePolicy = exports.publishPolicy = exports.updatePolicy = exports.getPolicy = exports.createPolicy = exports.getPolicies = exports.deleteAnnouncement = exports.updateAnnouncement = exports.markAnnouncementRead = exports.createAnnouncement = exports.getAnnouncements = void 0;
const PolicyAnnouncement_1 = require("../models/PolicyAnnouncement");
const Employee_1 = require("../models/Employee");
const NotificationAudit_1 = require("../models/NotificationAudit");
const auditService_1 = require("../services/auditService");
const errorHandler_1 = require("../middleware/errorHandler");
const helpers_1 = require("../utils/helpers");
const zod_1 = require("zod");
const roles_1 = require("../utils/roles");

const CONTENT_ADMIN_ROLES = roles_1.CONTENT_ADMIN_ROLES;
exports.CONTENT_ADMIN_ROLES = CONTENT_ADMIN_ROLES;

const announcementSchema = zod_1.z.object({
    title: zod_1.z.string().min(3, 'Title must be at least 3 characters').max(160),
    description: zod_1.z.string().min(3, 'Please write the announcement body'),
    priority: zod_1.z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    targetAudience: zod_1.z.enum(['ALL', 'DEPARTMENT', 'DESIGNATION', 'SPECIFIC']).optional(),
    targetDepartments: zod_1.z.array(zod_1.z.string()).optional(),
    targetDesignations: zod_1.z.array(zod_1.z.string()).optional(),
    targetEmployees: zod_1.z.array(zod_1.z.string()).optional(),
    publishDate: zod_1.z.string().optional().or(zod_1.z.literal('')),
    expiryDate: zod_1.z.string().optional().or(zod_1.z.literal('')),
    isActive: zod_1.z.boolean().optional(),
});

const policySchema = zod_1.z.object({
    title: zod_1.z.string().min(3, 'Title must be at least 3 characters').max(160),
    description: zod_1.z.string().optional().or(zod_1.z.literal('')),
    category: zod_1.z.string().min(1, 'Category is required'),
    content: zod_1.z.string().optional().or(zod_1.z.literal('')),
    version: zod_1.z.string().min(1).optional(),
    status: zod_1.z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
    isAcknowledgementRequired: zod_1.z.boolean().optional(),
});

function normaliseDates(data) {
    const out = { ...data };
    if ('publishDate' in out) out.publishDate = out.publishDate ? new Date(out.publishDate) : undefined;
    if ('expiryDate' in out) out.expiryDate = out.expiryDate ? new Date(out.expiryDate) : undefined;
    return out;
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

/** True when an announcement targets the given employee. */
function targetsEmployee(announcement, employee) {
    if (!announcement.targetAudience || announcement.targetAudience === 'ALL') return true;
    if (!employee) return false;
    if (announcement.targetAudience === 'DEPARTMENT') {
        return (announcement.targetDepartments || []).includes(employee.department);
    }
    if (announcement.targetAudience === 'DESIGNATION') {
        return (announcement.targetDesignations || []).includes(employee.designation);
    }
    if (announcement.targetAudience === 'SPECIFIC') {
        return (announcement.targetEmployees || []).map(String).includes(String(employee._id));
    }
    return true;
}

const getAnnouncements = async (req, res, next) => {
    try {
        const { page, limit, skip } = (0, helpers_1.parsePagination)(req.query, 20);
        const { search, priority, unreadOnly } = req.query;
        const isAdmin = CONTENT_ADMIN_ROLES.includes(req.user?.role);

        const query = {};
        // Only admins see deactivated or future-dated announcements.
        if (!isAdmin) {
            query.isActive = true;
            query.$and = [
                { $or: [{ publishDate: { $exists: false } }, { publishDate: null }, { publishDate: { $lte: new Date() } }] },
                { $or: [{ expiryDate: { $exists: false } }, { expiryDate: null }, { expiryDate: { $gte: new Date() } }] },
            ];
        } else if (req.query.includeInactive !== 'true') {
            query.isActive = true;
        }
        if (priority) query.priority = priority;
        if (search) {
            query.$or = [{ title: (0, helpers_1.searchRegex)(search) }, { description: (0, helpers_1.searchRegex)(search) }];
        }

        const employee = await Employee_1.Employee.findOne({ user: req.user?.userId }).select('_id department designation').lean();

        const [rows, total] = await Promise.all([
            PolicyAnnouncement_1.Announcement.find(query)
                .populate('createdBy', 'email')
                .populate('targetEmployees', 'fullName employeeCode')
                .sort({ priority: 1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            PolicyAnnouncement_1.Announcement.countDocuments(query),
        ]);

        // Non-admins only see announcements aimed at them.
        const visible = isAdmin ? rows : rows.filter((a) => targetsEmployee(a, employee));

        let readIds = [];
        if (employee) {
            const reads = await PolicyAnnouncement_1.AnnouncementRead.find({
                employee: employee._id,
                announcement: { $in: visible.map((a) => a._id) },
            }).lean();
            readIds = reads.map((r) => String(r.announcement));
        }
        let data = visible.map((a) => ({ ...a, isRead: readIds.includes(String(a._id)) }));
        if (unreadOnly === 'true') data = data.filter((a) => !a.isRead);

        res.json({
            data,
            meta: {
                total, page, limit,
                totalPages: Math.ceil(total / limit),
                unreadCount: data.filter((a) => !a.isRead).length,
            },
        });
    }
    catch (err) { next(err); }
};
exports.getAnnouncements = getAnnouncements;

const createAnnouncement = async (req, res, next) => {
    try {
        const data = announcementSchema.parse(req.body);
        (data.targetEmployees || []).forEach((id) => (0, helpers_1.assertObjectId)(id, 'target employee id'));
        const announcement = await PolicyAnnouncement_1.Announcement.create({
            ...normaliseDates(data),
            createdBy: req.user?.userId,
        });

        // Notify the audience so the bell reflects new communications.
        const audience = await resolveAudience(announcement);
        await Promise.all(audience
            .filter((e) => e.user)
            .map((e) => NotificationAudit_1.Notification.create({
                user: e.user,
                type: 'ANNOUNCEMENT',
                title: announcement.title,
                message: announcement.description.slice(0, 160),
                relatedModel: 'Announcement',
                relatedId: announcement._id,
            }).catch((err) => console.error('Notification create failed:', err.message))));

        await auditService_1.auditService.log(req, {
            action: 'ANNOUNCEMENT_CREATED', module: 'ANNOUNCEMENTS',
            recordId: announcement._id.toString(), recordLabel: announcement.title,
        });
        res.status(201).json({ data: announcement });
    }
    catch (err) { next(err); }
};
exports.createAnnouncement = createAnnouncement;

/** Employees an announcement is addressed to. */
async function resolveAudience(announcement) {
    const base = { isArchived: false, status: { $ne: 'INACTIVE' } };
    switch (announcement.targetAudience) {
        case 'DEPARTMENT':
            return Employee_1.Employee.find({ ...base, department: { $in: announcement.targetDepartments || [] } }).select('user').lean();
        case 'DESIGNATION':
            return Employee_1.Employee.find({ ...base, designation: { $in: announcement.targetDesignations || [] } }).select('user').lean();
        case 'SPECIFIC':
            return Employee_1.Employee.find({ _id: { $in: announcement.targetEmployees || [] } }).select('user').lean();
        default:
            return Employee_1.Employee.find(base).select('user').lean();
    }
}

const updateAnnouncement = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'announcement id');
        const data = announcementSchema.partial().parse(req.body);
        const announcement = await PolicyAnnouncement_1.Announcement.findByIdAndUpdate(id, normaliseDates(data), { new: true, runValidators: true });
        if (!announcement) throw new errorHandler_1.AppError('Announcement not found', 404, 'NOT_FOUND');
        await auditService_1.auditService.log(req, {
            action: 'ANNOUNCEMENT_UPDATED', module: 'ANNOUNCEMENTS',
            recordId: id, recordLabel: announcement.title, newValue: data,
        });
        res.json({ data: announcement });
    }
    catch (err) { next(err); }
};
exports.updateAnnouncement = updateAnnouncement;

/** Soft delete — the announcement stops being visible but history is preserved. */
const deleteAnnouncement = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'announcement id');
        const announcement = await PolicyAnnouncement_1.Announcement.findByIdAndUpdate(id, { isActive: false }, { new: true });
        if (!announcement) throw new errorHandler_1.AppError('Announcement not found', 404, 'NOT_FOUND');
        await auditService_1.auditService.log(req, {
            action: 'ANNOUNCEMENT_DELETED', module: 'ANNOUNCEMENTS',
            recordId: id, recordLabel: announcement.title,
        });
        res.json({ message: 'Announcement removed' });
    }
    catch (err) { next(err); }
};
exports.deleteAnnouncement = deleteAnnouncement;

const markAnnouncementRead = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'announcement id');
        const employee = await Employee_1.Employee.findOne({ user: req.user?.userId }).select('_id').lean();
        if (!employee) throw new errorHandler_1.AppError('No employee profile is linked to your account', 404, 'NO_EMPLOYEE_PROFILE');
        await PolicyAnnouncement_1.AnnouncementRead.findOneAndUpdate({ announcement: id, employee: employee._id }, { announcement: id, employee: employee._id, readAt: new Date() }, { upsert: true, setDefaultsOnInsert: true });
        res.json({ message: 'Marked as read' });
    }
    catch (err) { next(err); }
};
exports.markAnnouncementRead = markAnnouncementRead;

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

const getPolicies = async (req, res, next) => {
    try {
        const isAdmin = CONTENT_ADMIN_ROLES.includes(req.user?.role);
        const { status, category, search } = req.query;

        const query = {};
        // Everyone else only ever sees published policies.
        if (!isAdmin) query.status = 'PUBLISHED';
        else if (status) query.status = status;
        if (category) query.category = category;
        if (search) {
            query.$or = [
                { title: (0, helpers_1.searchRegex)(search) },
                { description: (0, helpers_1.searchRegex)(search) },
                { category: (0, helpers_1.searchRegex)(search) },
            ];
        }

        const policies = await PolicyAnnouncement_1.Policy.find(query)
            .populate('createdBy', 'email')
            .populate('publishedBy', 'email')
            .sort({ createdAt: -1 })
            .lean();

        const employee = await Employee_1.Employee.findOne({ user: req.user?.userId }).select('_id').lean();
        const [myAcks, ackCounts] = await Promise.all([
            employee
                ? PolicyAnnouncement_1.PolicyAcknowledgement.find({ employee: employee._id, policy: { $in: policies.map((p) => p._id) } }).lean()
                : [],
            PolicyAnnouncement_1.PolicyAcknowledgement.aggregate([
                { $match: { policy: { $in: policies.map((p) => p._id) } } },
                { $group: { _id: '$policy', count: { $sum: 1 } } },
            ]),
        ]);
        const ackedIds = myAcks.map((a) => String(a.policy));
        const countByPolicy = Object.fromEntries(ackCounts.map((c) => [String(c._id), c.count]));

        res.json({
            data: policies.map((p) => ({
                ...p,
                isAcknowledged: ackedIds.includes(String(p._id)),
                acknowledgementCount: countByPolicy[String(p._id)] || 0,
            })),
        });
    }
    catch (err) { next(err); }
};
exports.getPolicies = getPolicies;

const getPolicy = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'policy id');
        const policy = await PolicyAnnouncement_1.Policy.findById(id)
            .populate('createdBy', 'email')
            .populate('publishedBy', 'email')
            .lean();
        if (!policy) throw new errorHandler_1.AppError('Policy not found', 404, 'NOT_FOUND');
        if (policy.status !== 'PUBLISHED' && !CONTENT_ADMIN_ROLES.includes(req.user?.role)) {
            throw new errorHandler_1.AppError('Access denied', 403, 'FORBIDDEN');
        }
        const employee = await Employee_1.Employee.findOne({ user: req.user?.userId }).select('_id').lean();
        const [mine, count] = await Promise.all([
            employee ? PolicyAnnouncement_1.PolicyAcknowledgement.findOne({ policy: id, employee: employee._id }).lean() : null,
            PolicyAnnouncement_1.PolicyAcknowledgement.countDocuments({ policy: id }),
        ]);
        res.json({
            data: {
                ...policy,
                isAcknowledged: Boolean(mine),
                acknowledgedAt: mine?.acknowledgedAt,
                acknowledgementCount: count,
            },
        });
    }
    catch (err) { next(err); }
};
exports.getPolicy = getPolicy;

const createPolicy = async (req, res, next) => {
    try {
        const data = policySchema.parse(req.body);
        const policy = await PolicyAnnouncement_1.Policy.create({
            ...data,
            version: data.version || '1.0',
            status: data.status || 'DRAFT',
            createdBy: req.user?.userId,
        });
        await auditService_1.auditService.log(req, {
            action: 'POLICY_CREATED', module: 'POLICIES',
            recordId: policy._id.toString(), recordLabel: policy.title,
        });
        res.status(201).json({ data: policy });
    }
    catch (err) { next(err); }
};
exports.createPolicy = createPolicy;

const updatePolicy = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'policy id');
        const data = policySchema.partial().parse(req.body);
        const policy = await PolicyAnnouncement_1.Policy.findByIdAndUpdate(id, data, { new: true, runValidators: true });
        if (!policy) throw new errorHandler_1.AppError('Policy not found', 404, 'NOT_FOUND');
        await auditService_1.auditService.log(req, {
            action: 'POLICY_UPDATED', module: 'POLICIES',
            recordId: id, recordLabel: policy.title, newValue: data,
        });
        res.json({ data: policy });
    }
    catch (err) { next(err); }
};
exports.updatePolicy = updatePolicy;

const publishPolicy = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'policy id');
        const policy = await PolicyAnnouncement_1.Policy.findById(id);
        if (!policy) throw new errorHandler_1.AppError('Policy not found', 404, 'NOT_FOUND');
        if (policy.status === 'PUBLISHED') {
            throw new errorHandler_1.AppError('This policy is already published', 400, 'INVALID_STATUS');
        }
        policy.status = 'PUBLISHED';
        policy.publishedAt = new Date();
        policy.publishedBy = req.user?.userId;
        await policy.save();

        // Let everyone know a policy they may need to acknowledge went live.
        const employees = await Employee_1.Employee.find({ isArchived: false, status: { $ne: 'INACTIVE' } }).select('user').lean();
        await Promise.all(employees.filter((e) => e.user).map((e) => NotificationAudit_1.Notification.create({
            user: e.user,
            type: 'POLICY_PUBLISHED',
            title: 'New policy published',
            message: `${policy.title} (v${policy.version}) is now in effect.`,
            relatedModel: 'Policy',
            relatedId: policy._id,
        }).catch((err) => console.error('Notification create failed:', err.message))));

        await auditService_1.auditService.log(req, {
            action: 'POLICY_PUBLISHED', module: 'POLICIES',
            recordId: id, recordLabel: policy.title,
        });
        res.json({ data: policy });
    }
    catch (err) { next(err); }
};
exports.publishPolicy = publishPolicy;

const archivePolicy = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'policy id');
        const policy = await PolicyAnnouncement_1.Policy.findByIdAndUpdate(id, { status: 'ARCHIVED' }, { new: true });
        if (!policy) throw new errorHandler_1.AppError('Policy not found', 404, 'NOT_FOUND');
        await auditService_1.auditService.log(req, {
            action: 'POLICY_ARCHIVED', module: 'POLICIES',
            recordId: id, recordLabel: policy.title,
        });
        res.json({ data: policy });
    }
    catch (err) { next(err); }
};
exports.archivePolicy = archivePolicy;

const acknowledgePolicy = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'policy id');
        const policy = await PolicyAnnouncement_1.Policy.findById(id);
        if (!policy) throw new errorHandler_1.AppError('Policy not found', 404, 'NOT_FOUND');
        if (policy.status !== 'PUBLISHED') {
            throw new errorHandler_1.AppError('Only published policies can be acknowledged', 400, 'INVALID_STATUS');
        }
        const employee = await Employee_1.Employee.findOne({ user: req.user?.userId }).select('_id fullName').lean();
        if (!employee) throw new errorHandler_1.AppError('No employee profile is linked to your account', 404, 'NO_EMPLOYEE_PROFILE');

        await PolicyAnnouncement_1.PolicyAcknowledgement.findOneAndUpdate({ policy: id, employee: employee._id }, { policy: id, employee: employee._id, acknowledgedAt: new Date(), version: policy.version }, { upsert: true, setDefaultsOnInsert: true });
        await auditService_1.auditService.log(req, {
            action: 'POLICY_ACKNOWLEDGED', module: 'POLICIES',
            recordId: id, recordLabel: `${policy.title} — ${employee.fullName}`,
        });
        res.json({ message: 'Policy acknowledged' });
    }
    catch (err) { next(err); }
};
exports.acknowledgePolicy = acknowledgePolicy;
