"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAssetStats = exports.getAssetHistory = exports.returnAsset = exports.assignAsset = exports.updateAsset = exports.createAsset = exports.getAsset = exports.getAssets = void 0;
const AssetOnboarding_1 = require("../models/AssetOnboarding");
const Employee_1 = require("../models/Employee");
const auditService_1 = require("../services/auditService");
const errorHandler_1 = require("../middleware/errorHandler");
const helpers_1 = require("../utils/helpers");
const zod_1 = require("zod");

const CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'];
const STATUSES = ['AVAILABLE', 'ASSIGNED', 'RETURNED', 'MAINTENANCE', 'RETIRED', 'UNDER_REPAIR', 'DISPOSED'];

const assetSchema = zod_1.z.object({
    assetCode: zod_1.z.string().min(1, 'Asset tag is required').max(40),
    name: zod_1.z.string().min(1, 'Asset name is required').max(120),
    type: zod_1.z.string().min(1, 'Category is required'),
    brand: zod_1.z.string().optional().or(zod_1.z.literal('')),
    model: zod_1.z.string().optional().or(zod_1.z.literal('')),
    serialNumber: zod_1.z.string().optional().or(zod_1.z.literal('')),
    purchaseDate: zod_1.z.string().optional().or(zod_1.z.literal('')),
    purchaseValue: zod_1.z.coerce.number().min(0).max(100000000).optional(),
    condition: zod_1.z.enum(CONDITIONS).optional(),
    status: zod_1.z.enum(STATUSES).optional(),
    location: zod_1.z.string().optional().or(zod_1.z.literal('')),
    notes: zod_1.z.string().max(500).optional().or(zod_1.z.literal('')),
});

const assignSchema = zod_1.z.object({
    employeeId: zod_1.z.string().min(1, 'Employee is required'),
    assignedAt: zod_1.z.string().optional().or(zod_1.z.literal('')),
    conditionAtAssignment: zod_1.z.enum(CONDITIONS).optional(),
    notes: zod_1.z.string().max(500).optional().or(zod_1.z.literal('')),
});

const returnSchema = zod_1.z.object({
    returnedAt: zod_1.z.string().optional().or(zod_1.z.literal('')),
    conditionAtReturn: zod_1.z.enum(CONDITIONS),
    status: zod_1.z.enum(['AVAILABLE', 'MAINTENANCE', 'RETIRED']).optional(),
    notes: zod_1.z.string().max(500).optional().or(zod_1.z.literal('')),
});

function cleanPayload(data) {
    const out = { ...data };
    if ('purchaseDate' in out) out.purchaseDate = out.purchaseDate ? new Date(out.purchaseDate) : undefined;
    Object.keys(out).forEach((k) => { if (out[k] === '') out[k] = undefined; });
    return out;
}

const getAssets = async (req, res, next) => {
    try {
        const { page, limit, skip } = (0, helpers_1.parsePagination)(req.query, 20);
        const { status, type, search, employeeId } = req.query;

        const query = { isActive: true };
        if (status) query.status = status;
        if (type) query.type = type;
        if (employeeId) {
            (0, helpers_1.assertObjectId)(employeeId, 'employeeId');
            query.assignedTo = employeeId;
        }
        if (search) {
            query.$or = [
                { name: (0, helpers_1.searchRegex)(search) },
                { assetCode: (0, helpers_1.searchRegex)(search) },
                { serialNumber: (0, helpers_1.searchRegex)(search) },
                { brand: (0, helpers_1.searchRegex)(search) },
                { model: (0, helpers_1.searchRegex)(search) },
            ];
        }

        // Restricted roles (EMPLOYEE → self, MANAGER → self + reports,
        // IT_HEAD → own department) only ever see the kit assigned within
        // their scope; everyone else is unrestricted. An explicit `employeeId`
        // filter is intersected with the scope rather than overriding it.
        const { scope } = await (0, helpers_1.resolveEmployeeScope)(req.user);
        if (scope !== undefined) {
            const clause = scope === null ? { $in: [] } : scope;
            if (query.assignedTo) {
                const allowed = clause.$in
                    ? clause.$in.map(String).includes(String(query.assignedTo))
                    : String(clause) === String(query.assignedTo);
                if (!allowed) query.assignedTo = { $in: [] };
            } else {
                query.assignedTo = clause;
            }
        }

        const [assets, total] = await Promise.all([
            AssetOnboarding_1.Asset.find(query)
                .populate('assignedTo', 'fullName employeeCode department')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            AssetOnboarding_1.Asset.countDocuments(query),
        ]);
        res.json({ data: assets, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
    }
    catch (err) { next(err); }
};
exports.getAssets = getAssets;

const getAsset = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'asset id');
        const asset = await AssetOnboarding_1.Asset.findById(id).populate('assignedTo', 'fullName employeeCode department');
        if (!asset) throw new errorHandler_1.AppError('Asset not found', 404, 'NOT_FOUND');
        const { scope } = await (0, helpers_1.resolveEmployeeScope)(req.user);
        (0, helpers_1.assertIdInScope)(scope, asset.assignedTo?._id || asset.assignedTo);
        res.json({ data: asset });
    }
    catch (err) { next(err); }
};
exports.getAsset = getAsset;

const createAsset = async (req, res, next) => {
    try {
        const data = assetSchema.parse(req.body);
        const existing = await AssetOnboarding_1.Asset.findOne({ assetCode: data.assetCode });
        if (existing) throw new errorHandler_1.AppError(`Asset tag ${data.assetCode} is already in use`, 409, 'DUPLICATE');
        const asset = await AssetOnboarding_1.Asset.create({ ...cleanPayload(data), createdBy: req.user?.userId });
        await auditService_1.auditService.log(req, {
            action: 'ASSET_CREATED', module: 'ASSETS',
            recordId: asset._id.toString(), recordLabel: `${asset.assetCode} — ${asset.name}`,
        });
        res.status(201).json({ data: asset });
    }
    catch (err) { next(err); }
};
exports.createAsset = createAsset;

const updateAsset = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'asset id');
        const data = assetSchema.partial().parse(req.body);
        if (data.assetCode) {
            const clash = await AssetOnboarding_1.Asset.findOne({ assetCode: data.assetCode, _id: { $ne: id } });
            if (clash) throw new errorHandler_1.AppError(`Asset tag ${data.assetCode} is already in use`, 409, 'DUPLICATE');
        }
        const asset = await AssetOnboarding_1.Asset.findById(id);
        if (!asset) throw new errorHandler_1.AppError('Asset not found', 404, 'NOT_FOUND');
        // Assignment is changed through assign/return, never by editing the status directly.
        if (data.status && asset.status === 'ASSIGNED' && data.status !== 'ASSIGNED') {
            throw new errorHandler_1.AppError('Return the asset before changing its status', 400, 'ASSET_ASSIGNED');
        }
        const oldValue = { status: asset.status, condition: asset.condition, location: asset.location };
        Object.assign(asset, cleanPayload(data));
        await asset.save();
        await auditService_1.auditService.log(req, {
            action: 'ASSET_UPDATED', module: 'ASSETS',
            recordId: id, recordLabel: asset.name, oldValue, newValue: data,
        });
        res.json({ data: asset });
    }
    catch (err) { next(err); }
};
exports.updateAsset = updateAsset;

const assignAsset = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'asset id');
        const data = assignSchema.parse(req.body);
        (0, helpers_1.assertObjectId)(data.employeeId, 'employeeId');

        const [asset, employee] = await Promise.all([
            AssetOnboarding_1.Asset.findById(id),
            Employee_1.Employee.findById(data.employeeId).select('fullName employeeCode'),
        ]);
        if (!asset) throw new errorHandler_1.AppError('Asset not found', 404, 'NOT_FOUND');
        if (!employee) throw new errorHandler_1.AppError('Employee not found', 404, 'NOT_FOUND');
        if (asset.status === 'ASSIGNED') throw new errorHandler_1.AppError('This asset is already assigned', 400, 'ALREADY_ASSIGNED');
        if (['RETIRED', 'DISPOSED'].includes(asset.status)) {
            throw new errorHandler_1.AppError('A retired asset cannot be assigned', 400, 'ASSET_RETIRED');
        }

        const assignedAt = data.assignedAt ? new Date(data.assignedAt) : new Date();
        await AssetOnboarding_1.AssetAssignment.create({
            asset: id,
            employee: data.employeeId,
            assignedAt,
            conditionAtAssignment: data.conditionAtAssignment || asset.condition || 'GOOD',
            notes: data.notes || undefined,
            assignedBy: req.user?.userId,
        });
        asset.status = 'ASSIGNED';
        asset.assignedTo = data.employeeId;
        asset.assignedAt = assignedAt;
        if (data.conditionAtAssignment) asset.condition = data.conditionAtAssignment;
        await asset.save();

        await auditService_1.auditService.log(req, {
            action: 'ASSET_ASSIGNED', module: 'ASSETS',
            recordId: id, recordLabel: `${asset.assetCode} → ${employee.fullName}`,
        });
        const populated = await AssetOnboarding_1.Asset.findById(id).populate('assignedTo', 'fullName employeeCode department');
        res.json({ data: populated });
    }
    catch (err) { next(err); }
};
exports.assignAsset = assignAsset;

const returnAsset = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'asset id');
        const data = returnSchema.parse(req.body);

        const asset = await AssetOnboarding_1.Asset.findById(id);
        if (!asset) throw new errorHandler_1.AppError('Asset not found', 404, 'NOT_FOUND');
        if (asset.status !== 'ASSIGNED') throw new errorHandler_1.AppError('This asset is not currently assigned', 400, 'NOT_ASSIGNED');

        const returnedAt = data.returnedAt ? new Date(data.returnedAt) : new Date();
        const assignment = await AssetOnboarding_1.AssetAssignment.findOne({ asset: id, returnedAt: { $exists: false } }).sort({ assignedAt: -1 });
        if (assignment) {
            if (returnedAt < assignment.assignedAt) {
                throw new errorHandler_1.AppError('Return date cannot be before the assignment date', 400, 'INVALID_RANGE');
            }
            assignment.returnedAt = returnedAt;
            assignment.conditionAtReturn = data.conditionAtReturn;
            assignment.returnedBy = req.user?.userId;
            if (data.notes) assignment.notes = data.notes;
            await assignment.save();
        }

        asset.status = data.status || 'AVAILABLE';
        asset.assignedTo = undefined;
        asset.assignedAt = undefined;
        asset.condition = data.conditionAtReturn;
        await asset.save();

        await auditService_1.auditService.log(req, {
            action: 'ASSET_RETURNED', module: 'ASSETS',
            recordId: id, recordLabel: asset.assetCode,
            newValue: { conditionAtReturn: data.conditionAtReturn, status: asset.status },
        });
        res.json({ data: asset });
    }
    catch (err) { next(err); }
};
exports.returnAsset = returnAsset;

const getAssetHistory = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'asset id');
        const asset = await AssetOnboarding_1.Asset.findById(id).select('assignedTo').lean();
        if (!asset) throw new errorHandler_1.AppError('Asset not found', 404, 'NOT_FOUND');
        const { scope } = await (0, helpers_1.resolveEmployeeScope)(req.user);
        (0, helpers_1.assertIdInScope)(scope, asset.assignedTo);
        const history = await AssetOnboarding_1.AssetAssignment.find({ asset: id })
            .populate('employee', 'fullName employeeCode department')
            .populate('assignedBy', 'email')
            .populate('returnedBy', 'email')
            .sort({ assignedAt: -1 });
        res.json({ data: history });
    }
    catch (err) { next(err); }
};
exports.getAssetHistory = getAssetHistory;

const getAssetStats = async (req, res, next) => {
    try {
        const [byStatus, valueAgg, returnedCount] = await Promise.all([
            AssetOnboarding_1.Asset.aggregate([
                { $match: { isActive: true } },
                { $group: { _id: '$status', count: { $sum: 1 } } },
            ]),
            AssetOnboarding_1.Asset.aggregate([
                { $match: { isActive: true } },
                { $group: { _id: null, total: { $sum: '$purchaseValue' } } },
            ]),
            AssetOnboarding_1.AssetAssignment.countDocuments({ returnedAt: { $exists: true } }),
        ]);
        const counts = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
        res.json({
            data: {
                total: byStatus.reduce((sum, s) => sum + s.count, 0),
                available: counts.AVAILABLE || 0,
                assigned: counts.ASSIGNED || 0,
                maintenance: (counts.MAINTENANCE || 0) + (counts.UNDER_REPAIR || 0),
                retired: (counts.RETIRED || 0) + (counts.DISPOSED || 0),
                returned: returnedCount,
                totalValue: valueAgg[0]?.total || 0,
                byStatus: counts,
            },
        });
    }
    catch (err) { next(err); }
};
exports.getAssetStats = getAssetStats;
