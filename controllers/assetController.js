"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAssetStats = exports.bulkExport = exports.transferAsset = exports.markAssetLost = exports.updateWarranty = exports.getAssetTimeline = exports.getAssetQR = exports.getAssetHistory = exports.returnAsset = exports.assignAsset = exports.updateAsset = exports.createAsset = exports.getAsset = exports.getAssets = void 0;
const AssetOnboarding_1 = require("../models/AssetOnboarding");
const Employee_1 = require("../models/Employee");
const auditService_1 = require("../services/auditService");
const errorHandler_1 = require("../middleware/errorHandler");
const helpers_1 = require("../utils/helpers");
const zod_1 = require("zod");
const QRCode = require("qrcode");

const CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'];
const STATUSES = ['AVAILABLE', 'ASSIGNED', 'RETURNED', 'MAINTENANCE', 'RETIRED', 'UNDER_REPAIR', 'DISPOSED', 'LOST', 'TRANSFERRED'];

const COMPANY_PREFIX = { DutyLaunch: 'DL', LauncherDesk: 'LD' };
const CATEGORY_PREFIX = {
    Laptop: 'LAP', Desktop: 'DES', Monitor: 'MON', Keyboard: 'KEY', Mouse: 'MOU',
    Headset: 'HST', Printer: 'PRN', Scanner: 'SCN', Mobile: 'MOB', Tablet: 'TAB',
    Router: 'RTR', Switch: 'SWT', Server: 'SRV', Storage: 'STG', Camera: 'CAM',
    Projector: 'PRO', UPS: 'UPS', Biometric: 'BIO', Networking: 'NET',
    Accessory: 'ACC', Furniture: 'FUR', Other: 'OTH',
    Peripheral: 'ACC', 'Software Licence': 'OTH',
};

async function generateAssetCode(company, category) {
    const companyCode = COMPANY_PREFIX[company] || 'XX';
    const categoryCode = CATEGORY_PREFIX[category] || 'OTH';
    const prefix = `${companyCode}-${categoryCode}`;
    const counter = await AssetOnboarding_1.AssetCounter.findOneAndUpdate(
        { prefix },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );
    const num = String(counter.seq).padStart(3, '0');
    return `${prefix}-${num}`;
}

// Keep the two equivalent category fields (assetCategory / type) and the AMC
// flag (amc / hasAMC) in sync BEFORE validation, so a client that sends only one
// of each still passes. This only fills missing values — it removes no validation.
function normalizeAssetBody(body) {
    if (!body || typeof body !== 'object') return body;
    if (!body.assetCategory && body.type) body.assetCategory = body.type;
    if (!body.type && body.assetCategory) body.type = body.assetCategory;
    if (body.amc === undefined && typeof body.hasAMC === 'boolean') body.amc = body.hasAMC;
    return body;
}

const assetSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'Asset name is required').max(120),
    company: zod_1.z.enum(['DutyLaunch', 'LauncherDesk']),
    assetCategory: zod_1.z.string().min(1, 'Asset category is required'),
    type: zod_1.z.string().min(1, 'Type is required'),
    brand: zod_1.z.string().optional().or(zod_1.z.literal('')),
    model: zod_1.z.string().optional().or(zod_1.z.literal('')),
    serialNumber: zod_1.z.string().optional().or(zod_1.z.literal('')),
    purchaseDate: zod_1.z.string().optional().or(zod_1.z.literal('')),
    purchaseValue: zod_1.z.coerce.number().min(0).max(100000000).optional(),
    condition: zod_1.z.enum(CONDITIONS).optional(),
    status: zod_1.z.enum(STATUSES).optional(),
    location: zod_1.z.string().optional().or(zod_1.z.literal('')),
    notes: zod_1.z.string().max(500).optional().or(zod_1.z.literal('')),
    department: zod_1.z.string().optional().or(zod_1.z.literal('')),
    branch: zod_1.z.string().optional().or(zod_1.z.literal('')),
    floor: zod_1.z.string().optional().or(zod_1.z.literal('')),
    vendorName: zod_1.z.string().optional().or(zod_1.z.literal('')),
    vendorContact: zod_1.z.string().optional().or(zod_1.z.literal('')),
    invoiceNumber: zod_1.z.string().optional().or(zod_1.z.literal('')),
    poNumber: zod_1.z.string().optional().or(zod_1.z.literal('')),
    serviceCenter: zod_1.z.string().optional().or(zod_1.z.literal('')),
    warrantyStart: zod_1.z.string().optional().or(zod_1.z.literal('')),
    warrantyEnd: zod_1.z.string().optional().or(zod_1.z.literal('')),
    amcStart: zod_1.z.string().optional().or(zod_1.z.literal('')),
    amcEnd: zod_1.z.string().optional().or(zod_1.z.literal('')),
    amc: zod_1.z.boolean().optional(),
});

const assignSchema = zod_1.z.object({
    employeeId: zod_1.z.string().min(1, 'Employee is required'),
    assignedAt: zod_1.z.string().optional().or(zod_1.z.literal('')),
    conditionAtAssignment: zod_1.z.enum(CONDITIONS).optional(),
    notes: zod_1.z.string().max(500).optional().or(zod_1.z.literal('')),
    expectedReturn: zod_1.z.string().optional().or(zod_1.z.literal('')),
    department: zod_1.z.string().optional().or(zod_1.z.literal('')),
    branch: zod_1.z.string().optional().or(zod_1.z.literal('')),
    floor: zod_1.z.string().optional().or(zod_1.z.literal('')),
});

const returnSchema = zod_1.z.object({
    returnedAt: zod_1.z.string().optional().or(zod_1.z.literal('')),
    conditionAtReturn: zod_1.z.enum(CONDITIONS),
    status: zod_1.z.enum(['AVAILABLE', 'MAINTENANCE', 'RETIRED']).optional(),
    notes: zod_1.z.string().max(500).optional().or(zod_1.z.literal('')),
});

const warrantySchema = zod_1.z.object({
    warrantyStart: zod_1.z.string().optional().or(zod_1.z.literal('')),
    warrantyEnd: zod_1.z.string().optional().or(zod_1.z.literal('')),
    amc: zod_1.z.boolean().optional(),
    amcStart: zod_1.z.string().optional().or(zod_1.z.literal('')),
    amcEnd: zod_1.z.string().optional().or(zod_1.z.literal('')),
    serviceCenter: zod_1.z.string().optional().or(zod_1.z.literal('')),
    vendorName: zod_1.z.string().optional().or(zod_1.z.literal('')),
    vendorContact: zod_1.z.string().optional().or(zod_1.z.literal('')),
});

function cleanPayload(data) {
    const out = { ...data };
    const dateFields = ['purchaseDate', 'warrantyStart', 'warrantyEnd', 'amcStart', 'amcEnd', 'expectedReturn'];
    dateFields.forEach((f) => {
        if (f in out) out[f] = out[f] ? new Date(out[f]) : undefined;
    });
    Object.keys(out).forEach((k) => { if (out[k] === '') out[k] = undefined; });
    return out;
}

// ─── getAssets ────────────────────────────────────────────────────────────────
const getAssets = async (req, res, next) => {
    try {
        const { page, limit, skip } = (0, helpers_1.parsePagination)(req.query, 20);
        const { status, type, company, assetCategory, search, employeeId } = req.query;

        const query = { isActive: true };
        if (status) query.status = status;
        if (type) query.type = type;
        if (company) query.company = company;
        if (assetCategory) query.assetCategory = assetCategory;
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
                { assetCategory: (0, helpers_1.searchRegex)(search) },
            ];
        }

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

// ─── getAsset ─────────────────────────────────────────────────────────────────
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

// ─── createAsset ──────────────────────────────────────────────────────────────
const createAsset = async (req, res, next) => {
    try {
        const data = assetSchema.parse(normalizeAssetBody(req.body));
        const assetCode = await generateAssetCode(data.company, data.assetCategory);
        const payload = cleanPayload(data);
        const asset = await AssetOnboarding_1.Asset.create({ ...payload, assetCode, createdBy: req.user?.userId });
        await AssetOnboarding_1.AssetEvent.create({
            asset: asset._id,
            eventType: 'CREATED',
            description: `Asset ${assetCode} created`,
            newValue: { assetCode, name: asset.name, company: asset.company, assetCategory: asset.assetCategory },
            performedBy: req.user?.userId,
        });
        await auditService_1.auditService.log(req, {
            action: 'ASSET_CREATED', module: 'ASSETS',
            recordId: asset._id.toString(), recordLabel: `${asset.assetCode} — ${asset.name}`,
        });
        res.status(201).json({ data: asset });
    }
    catch (err) { next(err); }
};
exports.createAsset = createAsset;

// ─── updateAsset ──────────────────────────────────────────────────────────────
const updateAsset = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'asset id');
        const data = assetSchema.partial().parse(normalizeAssetBody(req.body));
        const asset = await AssetOnboarding_1.Asset.findById(id);
        if (!asset) throw new errorHandler_1.AppError('Asset not found', 404, 'NOT_FOUND');
        if (data.status && asset.status === 'ASSIGNED' && data.status !== 'ASSIGNED') {
            throw new errorHandler_1.AppError('Return the asset before changing its status', 400, 'ASSET_ASSIGNED');
        }
        const oldValue = { status: asset.status, condition: asset.condition, location: asset.location };
        Object.assign(asset, cleanPayload(data));
        await asset.save();
        await AssetOnboarding_1.AssetEvent.create({
            asset: id,
            eventType: 'UPDATED',
            description: `Asset ${asset.assetCode} updated`,
            oldValue,
            newValue: data,
            performedBy: req.user?.userId,
        });
        await auditService_1.auditService.log(req, {
            action: 'ASSET_UPDATED', module: 'ASSETS',
            recordId: id, recordLabel: asset.name, oldValue, newValue: data,
        });
        res.json({ data: asset });
    }
    catch (err) { next(err); }
};
exports.updateAsset = updateAsset;

// ─── assignAsset ──────────────────────────────────────────────────────────────
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
        if (data.expectedReturn) asset.expectedReturn = new Date(data.expectedReturn);
        if (data.department) asset.department = data.department;
        if (data.branch) asset.branch = data.branch;
        if (data.floor) asset.floor = data.floor;
        await asset.save();

        await AssetOnboarding_1.AssetEvent.create({
            asset: id,
            eventType: 'ASSIGNED',
            description: `Assigned to ${employee.fullName} (${employee.employeeCode})`,
            newValue: { employeeId: data.employeeId, assignedAt },
            performedBy: req.user?.userId,
        });
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

// ─── returnAsset ──────────────────────────────────────────────────────────────
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
        asset.expectedReturn = undefined;
        asset.condition = data.conditionAtReturn;
        await asset.save();

        await AssetOnboarding_1.AssetEvent.create({
            asset: id,
            eventType: 'RETURNED',
            description: `Asset returned, condition: ${data.conditionAtReturn}`,
            newValue: { conditionAtReturn: data.conditionAtReturn, status: asset.status, returnedAt },
            performedBy: req.user?.userId,
        });
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

// ─── getAssetHistory ──────────────────────────────────────────────────────────
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

// ─── getAssetQR ───────────────────────────────────────────────────────────────
const getAssetQR = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'asset id');
        const asset = await AssetOnboarding_1.Asset.findById(id).lean();
        if (!asset) throw new errorHandler_1.AppError('Asset not found', 404, 'NOT_FOUND');
        const { scope } = await (0, helpers_1.resolveEmployeeScope)(req.user);
        (0, helpers_1.assertIdInScope)(scope, asset.assignedTo);
        const qrContent = JSON.stringify({
            assetCode: asset.assetCode,
            name: asset.name,
            company: asset.company,
            serialNumber: asset.serialNumber || '',
        });
        const qrDataUrl = await QRCode.toDataURL(qrContent);
        res.json({ data: { qrCode: qrDataUrl } });
    }
    catch (err) { next(err); }
};
exports.getAssetQR = getAssetQR;

// ─── getAssetTimeline ─────────────────────────────────────────────────────────
const getAssetTimeline = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'asset id');
        const asset = await AssetOnboarding_1.Asset.findById(id).select('assignedTo').lean();
        if (!asset) throw new errorHandler_1.AppError('Asset not found', 404, 'NOT_FOUND');
        const { scope } = await (0, helpers_1.resolveEmployeeScope)(req.user);
        (0, helpers_1.assertIdInScope)(scope, asset.assignedTo);
        const timeline = await AssetOnboarding_1.AssetEvent.find({ asset: id })
            .populate('performedBy', 'email')
            .sort({ performedAt: -1 });
        res.json({ data: timeline });
    }
    catch (err) { next(err); }
};
exports.getAssetTimeline = getAssetTimeline;

// ─── updateWarranty ───────────────────────────────────────────────────────────
const updateWarranty = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'asset id');
        const data = warrantySchema.parse(req.body);
        const asset = await AssetOnboarding_1.Asset.findById(id);
        if (!asset) throw new errorHandler_1.AppError('Asset not found', 404, 'NOT_FOUND');
        const oldValue = {
            warrantyStart: asset.warrantyStart, warrantyEnd: asset.warrantyEnd,
            amc: asset.amc, amcStart: asset.amcStart, amcEnd: asset.amcEnd,
        };
        Object.assign(asset, cleanPayload(data));
        await asset.save();
        await AssetOnboarding_1.AssetEvent.create({
            asset: id,
            eventType: 'WARRANTY_UPDATED',
            description: `Warranty information updated`,
            oldValue,
            newValue: data,
            performedBy: req.user?.userId,
        });
        await auditService_1.auditService.log(req, {
            action: 'ASSET_UPDATED', module: 'ASSETS',
            recordId: id, recordLabel: asset.name, oldValue, newValue: data,
        });
        res.json({ data: asset });
    }
    catch (err) { next(err); }
};
exports.updateWarranty = updateWarranty;

// ─── markAssetLost ────────────────────────────────────────────────────────────
const markAssetLost = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'asset id');
        const asset = await AssetOnboarding_1.Asset.findById(id);
        if (!asset) throw new errorHandler_1.AppError('Asset not found', 404, 'NOT_FOUND');
        const oldStatus = asset.status;
        asset.status = 'LOST';
        asset.assignedTo = undefined;
        asset.assignedAt = undefined;
        await asset.save();
        await AssetOnboarding_1.AssetEvent.create({
            asset: id,
            eventType: 'LOST',
            description: `Asset marked as lost`,
            oldValue: { status: oldStatus },
            newValue: { status: 'LOST' },
            performedBy: req.user?.userId,
        });
        await auditService_1.auditService.log(req, {
            action: 'ASSET_UPDATED', module: 'ASSETS',
            recordId: id, recordLabel: asset.assetCode,
            oldValue: { status: oldStatus }, newValue: { status: 'LOST' },
        });
        res.json({ data: asset });
    }
    catch (err) { next(err); }
};
exports.markAssetLost = markAssetLost;

// ─── transferAsset ────────────────────────────────────────────────────────────
const transferAsset = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'asset id');
        const { employeeId, notes } = req.body;
        if (!employeeId) throw new errorHandler_1.AppError('employeeId is required for transfer', 400, 'VALIDATION_ERROR');
        (0, helpers_1.assertObjectId)(employeeId, 'employeeId');
        const [asset, employee] = await Promise.all([
            AssetOnboarding_1.Asset.findById(id),
            Employee_1.Employee.findById(employeeId).select('fullName employeeCode'),
        ]);
        if (!asset) throw new errorHandler_1.AppError('Asset not found', 404, 'NOT_FOUND');
        if (!employee) throw new errorHandler_1.AppError('Employee not found', 404, 'NOT_FOUND');
        const oldValue = { status: asset.status, assignedTo: asset.assignedTo, transferredTo: asset.transferredTo };
        asset.status = 'TRANSFERRED';
        asset.transferredTo = employeeId;
        if (notes) asset.notes = notes;
        await asset.save();
        await AssetOnboarding_1.AssetEvent.create({
            asset: id,
            eventType: 'TRANSFERRED',
            description: `Asset transferred to ${employee.fullName} (${employee.employeeCode})`,
            oldValue,
            newValue: { status: 'TRANSFERRED', transferredTo: employeeId },
            performedBy: req.user?.userId,
        });
        await auditService_1.auditService.log(req, {
            action: 'ASSET_UPDATED', module: 'ASSETS',
            recordId: id, recordLabel: asset.assetCode,
            oldValue, newValue: { status: 'TRANSFERRED', transferredTo: employeeId },
        });
        res.json({ data: asset });
    }
    catch (err) { next(err); }
};
exports.transferAsset = transferAsset;

// ─── bulkExport ───────────────────────────────────────────────────────────────
const bulkExport = async (req, res, next) => {
    try {
        const { status, type, company, assetCategory } = req.query;
        const query = { isActive: true };
        if (status) query.status = status;
        if (type) query.type = type;
        if (company) query.company = company;
        if (assetCategory) query.assetCategory = assetCategory;
        const assets = await AssetOnboarding_1.Asset.find(query)
            .populate('assignedTo', 'fullName employeeCode department')
            .populate('createdBy', 'email')
            .sort({ createdAt: -1 })
            .lean();
        res.json({ data: assets, meta: { total: assets.length } });
    }
    catch (err) { next(err); }
};
exports.bulkExport = bulkExport;

// ─── getAssetStats ────────────────────────────────────────────────────────────
const getAssetStats = async (req, res, next) => {
    try {
        const now = new Date();
        const in30 = new Date(now); in30.setDate(now.getDate() + 30);
        const in60 = new Date(now); in60.setDate(now.getDate() + 60);
        const in90 = new Date(now); in90.setDate(now.getDate() + 90);

        const [byStatus, valueAgg, returnedCount, warrantyExpiring30, warrantyExpiring60, warrantyExpiring90] = await Promise.all([
            AssetOnboarding_1.Asset.aggregate([
                { $match: { isActive: true } },
                { $group: { _id: '$status', count: { $sum: 1 } } },
            ]),
            AssetOnboarding_1.Asset.aggregate([
                { $match: { isActive: true } },
                { $group: { _id: null, total: { $sum: '$purchaseValue' } } },
            ]),
            AssetOnboarding_1.AssetAssignment.countDocuments({ returnedAt: { $exists: true } }),
            AssetOnboarding_1.Asset.countDocuments({ isActive: true, warrantyEnd: { $gte: now, $lte: in30 } }),
            AssetOnboarding_1.Asset.countDocuments({ isActive: true, warrantyEnd: { $gte: now, $lte: in60 } }),
            AssetOnboarding_1.Asset.countDocuments({ isActive: true, warrantyEnd: { $gte: now, $lte: in90 } }),
        ]);
        const counts = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
        res.json({
            data: {
                total: byStatus.reduce((sum, s) => sum + s.count, 0),
                available: counts.AVAILABLE || 0,
                assigned: counts.ASSIGNED || 0,
                maintenance: (counts.MAINTENANCE || 0) + (counts.UNDER_REPAIR || 0),
                retired: (counts.RETIRED || 0) + (counts.DISPOSED || 0),
                lost: counts.LOST || 0,
                transferred: counts.TRANSFERRED || 0,
                returned: returnedCount,
                totalValue: valueAgg[0]?.total || 0,
                byStatus: counts,
                warrantyExpiring: { days30: warrantyExpiring30, days60: warrantyExpiring60, days90: warrantyExpiring90 },
            },
        });
    }
    catch (err) { next(err); }
};
exports.getAssetStats = getAssetStats;