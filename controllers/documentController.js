"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDocumentChecklist = exports.getDocumentStats = exports.listDocuments = exports.revealIdentityNumber = exports.createIdentityDocument = exports.getIdentityDocuments = exports.archiveDocument = exports.rejectDocument = exports.verifyDocument = exports.downloadDocument = exports.uploadDocument = exports.getDocuments = void 0;
const Document_1 = require("../models/Document");
const Employee_1 = require("../models/Employee");
const auditService_1 = require("../services/auditService");
const storageService_1 = require("../services/storageService");
const encryption_1 = require("../utils/encryption");
const errorHandler_1 = require("../middleware/errorHandler");
const helpers_1 = require("../utils/helpers");
const zod_1 = require("zod");
const roles_1 = require("../utils/roles");
const NotificationAudit_1 = require("../models/NotificationAudit");
const { buildChecklist, hasRejectedRequiredDocument } = require("../utils/documentRequirements");
const { matchesDeclaredType } = require("../utils/fileSignature");

const uploadSchema = zod_1.z.object({
    employeeId: zod_1.z.string().min(1, 'Employee is required'),
    category: zod_1.z.string().min(1, 'Category is required'),
    name: zod_1.z.string().min(1, 'Document name is required'),
    issueDate: zod_1.z.string().optional().or(zod_1.z.literal('')),
    expiryDate: zod_1.z.string().optional().or(zod_1.z.literal('')),
    notes: zod_1.z.string().max(500).optional().or(zod_1.z.literal('')),
});

const identitySchema = zod_1.z.object({
    documentType: zod_1.z.enum(['AADHAAR', 'PAN', 'PASSPORT', 'DRIVING_LICENCE', 'VOTER_ID', 'OTHER']),
    number: zod_1.z.string().min(4, 'Document number looks too short').max(40),
    issueDate: zod_1.z.string().optional().or(zod_1.z.literal('')),
    expiryDate: zod_1.z.string().optional().or(zod_1.z.literal('')),
    notes: zod_1.z.string().max(500).optional().or(zod_1.z.literal('')),
});

/** A filename safe to echo back in a Content-Disposition header. */
function safeFilename(name) {
    return String(name || 'document')
        .replace(/[^\w.\- ]+/g, '_')
        .slice(0, 120);
}

/**
 * Recomputes one employee's document-completion gate from their actual
 * documents and persists it to Employee.documentStatus/hasRejectedDocuments.
 * Called after every document mutation so the cached fields (used for fast
 * list filtering) never drift from the real checklist. Returns the freshly
 * computed checklist plus whether this call just completed it (PENDING → COMPLETE),
 * which callers use to decide whether to notify/audit the transition.
 */
async function syncDocumentStatus(employeeId, { notify = false, req = null } = {}) {
    const [employee, docs] = await Promise.all([
        Employee_1.Employee.findById(employeeId).select('fullName user documentStatus'),
        Document_1.EmployeeDocument.find({ employee: employeeId }).select('category status isArchived createdAt verifiedBy verifiedAt rejectionReason').lean(),
    ]);
    if (!employee) return null;

    const checklist = buildChecklist(employee, docs);
    const nextStatus = checklist.summary.isComplete ? 'COMPLETE' : 'PENDING';
    const nextHasRejected = hasRejectedRequiredDocument(checklist);
    const justCompleted = employee.documentStatus !== 'COMPLETE' && nextStatus === 'COMPLETE';

    if (employee.documentStatus !== nextStatus || employee.hasRejectedDocuments !== nextHasRejected) {
        employee.documentStatus = nextStatus;
        employee.hasRejectedDocuments = nextHasRejected;
        await employee.save();
    }

    if (justCompleted && notify) {
        if (employee.user) {
            await NotificationAudit_1.Notification.create({
                user: employee.user,
                type: 'DOCUMENT_REQUIREMENTS_COMPLETED',
                title: 'Documentation complete',
                message: 'All of your required documents have been verified.',
                relatedModel: 'Employee',
                relatedId: employee._id,
            }).catch((err) => console.error('Notification create failed:', err.message));
        }
        if (req) {
            await auditService_1.auditService.log(req, {
                action: 'DOCUMENT_REQUIREMENTS_COMPLETED', module: 'DOCUMENTS',
                recordId: String(employee._id), recordLabel: employee.fullName,
            });
        }
    }
    return { checklist, justCompleted };
}
exports.syncDocumentStatus = syncDocumentStatus;

/** Throws unless the caller may read documents belonging to `employeeId`. */
async function assertCanAccessEmployee(req, employeeId) {
    if (roles_1.HR_ROLES.includes(req.user?.role)) return;
    const { scope } = await (0, helpers_1.resolveEmployeeScope)(req.user);
    if (scope === undefined) return;
    if (scope === null) throw new errorHandler_1.AppError('Access denied', 403, 'FORBIDDEN');
    const allowed = scope.$in ? scope.$in.map(String) : [String(scope)];
    if (!allowed.includes(String(employeeId))) {
        throw new errorHandler_1.AppError('Access denied', 403, 'FORBIDDEN');
    }
}

const getDocuments = async (req, res, next) => {
    try {
        const { id: employeeId } = req.params;
        (0, helpers_1.assertObjectId)(employeeId, 'employee id');
        await assertCanAccessEmployee(req, employeeId);
        const docs = await Document_1.EmployeeDocument.find({ employee: employeeId, isArchived: false })
            .populate('uploadedBy', 'email')
            .populate('verifiedBy', 'email')
            .sort({ createdAt: -1 });
        res.json({ data: docs });
    }
    catch (err) { next(err); }
};
exports.getDocuments = getDocuments;

/** Organisation-wide document register with filters — powers the Documents page. */
const listDocuments = async (req, res, next) => {
    try {
        const { page, limit, skip } = (0, helpers_1.parsePagination)(req.query, 20);
        const { employeeId, category, status, search, department, includeArchived } = req.query;

        const query = {};
        if (includeArchived === 'true' || status === 'ARCHIVED') {
            if (status === 'ARCHIVED') query.isArchived = true;
        } else {
            query.isArchived = false;
        }
        if (status && status !== 'ARCHIVED') query.status = status;
        if (category) query.category = category;

        const clauses = [];
        const { scope } = await (0, helpers_1.resolveEmployeeScope)(req.user);
        if (scope !== undefined) clauses.push(scope === null ? { $in: [] } : scope);
        if (employeeId) {
            (0, helpers_1.assertObjectId)(employeeId, 'employeeId');
            clauses.push(employeeId);
        }
        if (department) {
            const ids = await Employee_1.Employee.find({ department, isArchived: false }).select('_id').lean();
            clauses.push({ $in: ids.map((i) => i._id) });
        }
        if (clauses.length === 1) query.employee = clauses[0];
        else if (clauses.length > 1) query.$and = clauses.map((c) => ({ employee: c }));

        if (search) {
            const empIds = await Employee_1.Employee.find({
                $or: [{ fullName: (0, helpers_1.searchRegex)(search) }, { employeeCode: (0, helpers_1.searchRegex)(search) }],
            }).select('_id').lean();
            query.$or = [
                { name: (0, helpers_1.searchRegex)(search) },
                { originalName: (0, helpers_1.searchRegex)(search) },
                { category: (0, helpers_1.searchRegex)(search) },
                { employee: { $in: empIds.map((i) => i._id) } },
            ];
        }

        const [docs, total] = await Promise.all([
            Document_1.EmployeeDocument.find(query)
                .populate('employee', 'fullName employeeCode department designation')
                .populate('uploadedBy', 'email')
                .populate('verifiedBy', 'email')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Document_1.EmployeeDocument.countDocuments(query),
        ]);
        res.json({
            data: docs.filter((d) => d.employee),
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        });
    }
    catch (err) { next(err); }
};
exports.listDocuments = listDocuments;

const getDocumentStats = async (req, res, next) => {
    try {
        const { scope } = await (0, helpers_1.resolveEmployeeScope)(req.user);
        const match = {};
        if (scope !== undefined) match.employee = scope === null ? { $in: [] } : scope;

        const [byStatus, archived, expiringSoon] = await Promise.all([
            Document_1.EmployeeDocument.aggregate([
                { $match: { ...match, isArchived: false } },
                { $group: { _id: '$status', count: { $sum: 1 } } },
            ]),
            Document_1.EmployeeDocument.countDocuments({ ...match, isArchived: true }),
            Document_1.EmployeeDocument.countDocuments({
                ...match,
                isArchived: false,
                expiryDate: { $gte: new Date(), $lte: new Date(Date.now() + 30 * 86400000) },
            }),
        ]);
        const counts = Object.fromEntries(byStatus.map((s) => [s._id || 'PENDING', s.count]));
        res.json({
            data: {
                total: byStatus.reduce((sum, s) => sum + s.count, 0),
                pending: counts.PENDING || 0,
                verified: counts.VERIFIED || 0,
                rejected: counts.REJECTED || 0,
                archived,
                expiringSoon,
            },
        });
    }
    catch (err) { next(err); }
};
exports.getDocumentStats = getDocumentStats;

const uploadDocument = async (req, res, next) => {
    try {
        if (!req.file) throw new errorHandler_1.AppError('No file was uploaded', 400, 'NO_FILE');
        if (!matchesDeclaredType(req.file.buffer, req.file.mimetype)) {
            throw new errorHandler_1.AppError('The file content does not match its declared type', 400, 'INVALID_FILE_TYPE');
        }
        const data = uploadSchema.parse(req.body);
        (0, helpers_1.assertObjectId)(data.employeeId, 'employeeId');
        // HR/elevated may upload for anyone; everyone else only for themselves.
        await assertCanAccessEmployee(req, data.employeeId);
        const employee = await Employee_1.Employee.findById(data.employeeId).select('fullName');
        if (!employee) throw new errorHandler_1.AppError('Employee not found', 404, 'NOT_FOUND');

        const filePath = await storageService_1.storageService.upload(req.file, `documents/${data.employeeId}`);
        const doc = await Document_1.EmployeeDocument.create({
            employee: data.employeeId,
            category: data.category,
            name: data.name,
            originalName: req.file.originalname,
            filePath,
            fileType: req.file.mimetype,
            fileSize: req.file.size,
            issueDate: data.issueDate ? new Date(data.issueDate) : undefined,
            expiryDate: data.expiryDate ? new Date(data.expiryDate) : undefined,
            notes: data.notes || undefined,
            status: 'PENDING',
            uploadedBy: req.user?.userId,
        });
        await auditService_1.auditService.log(req, {
            action: 'DOCUMENT_UPLOADED', module: 'DOCUMENTS',
            recordId: doc._id.toString(), recordLabel: `${employee.fullName} — ${data.name}`,
        });
        // A re-upload of a previously rejected/required category can change the
        // employee's documentation status (e.g. clearing hasRejectedDocuments).
        await syncDocumentStatus(data.employeeId, { req });
        res.status(201).json({ data: doc });
    }
    catch (err) { next(err); }
};
exports.uploadDocument = uploadDocument;

const downloadDocument = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'document id');
        const forceDownload = req.query.dl === '1';
        const doc = await Document_1.EmployeeDocument.findById(id);
        if (!doc) throw new errorHandler_1.AppError('Document not found', 404, 'NOT_FOUND');
        await assertCanAccessEmployee(req, doc.employee);

        let buffer;
        try {
            buffer = await storageService_1.storageService.download(doc.filePath);
        } catch {
            throw new errorHandler_1.AppError('The stored file is no longer available', 410, 'FILE_MISSING');
        }
        await auditService_1.auditService.log(req, {
            action: 'DOCUMENT_DOWNLOADED', module: 'DOCUMENTS',
            recordId: id, recordLabel: doc.name,
        });
        const filename = safeFilename(doc.originalName || doc.name);
        res.setHeader('Content-Type', doc.fileType);
        res.setHeader('Content-Disposition', `${forceDownload ? 'attachment' : 'inline'}; filename="${filename}"`);
        res.setHeader('Content-Length', buffer.length);
        res.send(buffer);
    }
    catch (err) { next(err); }
};
exports.downloadDocument = downloadDocument;

const verifyDocument = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'document id');
        const doc = await Document_1.EmployeeDocument.findByIdAndUpdate(id, {
            isVerified: true,
            status: 'VERIFIED',
            rejectionReason: undefined,
            verifiedBy: req.user?.userId,
            verifiedAt: new Date(),
        }, { new: true }).populate('employee', 'fullName employeeCode');
        if (!doc) throw new errorHandler_1.AppError('Document not found', 404, 'NOT_FOUND');
        await auditService_1.auditService.log(req, {
            action: 'DOCUMENT_VERIFIED', module: 'DOCUMENTS',
            recordId: id, recordLabel: doc.name,
        });
        // Verifying may be the last outstanding required document — this is
        // where an employee's documentation actually becomes COMPLETE.
        await syncDocumentStatus(doc.employee._id || doc.employee, { notify: true, req });
        res.json({ data: doc });
    }
    catch (err) { next(err); }
};
exports.verifyDocument = verifyDocument;

const rejectDocument = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'document id');
        const reason = String(req.body?.reason || '').trim();
        if (!reason) throw new errorHandler_1.AppError('A rejection reason is required', 400, 'VALIDATION_ERROR');
        const doc = await Document_1.EmployeeDocument.findByIdAndUpdate(id, {
            isVerified: false,
            status: 'REJECTED',
            rejectionReason: reason,
            verifiedBy: req.user?.userId,
            verifiedAt: new Date(),
        }, { new: true }).populate('employee', 'fullName employeeCode user');
        if (!doc) throw new errorHandler_1.AppError('Document not found', 404, 'NOT_FOUND');
        await auditService_1.auditService.log(req, {
            action: 'DOCUMENT_REJECTED', module: 'DOCUMENTS',
            recordId: id, recordLabel: doc.name, newValue: { reason },
        });
        await syncDocumentStatus(doc.employee._id || doc.employee, { req });
        if (doc.employee?.user) {
            await NotificationAudit_1.Notification.create({
                user: doc.employee.user,
                type: 'DOCUMENT_REJECTED',
                title: 'A document was rejected',
                message: `${doc.name}: ${reason}`,
                relatedModel: 'EmployeeDocument',
                relatedId: doc._id,
            }).catch((err) => console.error('Notification create failed:', err.message));
        }
        res.json({ data: doc });
    }
    catch (err) { next(err); }
};
exports.rejectDocument = rejectDocument;

const archiveDocument = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'document id');
        const doc = await Document_1.EmployeeDocument.findByIdAndUpdate(id, { isArchived: true, status: 'ARCHIVED' }, { new: true });
        if (!doc) throw new errorHandler_1.AppError('Document not found', 404, 'NOT_FOUND');
        await auditService_1.auditService.log(req, {
            action: 'DOCUMENT_ARCHIVED', module: 'DOCUMENTS',
            recordId: id, recordLabel: doc.name,
        });
        await syncDocumentStatus(doc.employee, { req });
        res.json({ data: doc, message: 'Document archived' });
    }
    catch (err) { next(err); }
};
exports.archiveDocument = archiveDocument;

// ---------------------------------------------------------------------------
// Identity documents — numbers are stored encrypted and only ever returned masked,
// except through the explicitly audited reveal endpoint.
// ---------------------------------------------------------------------------

const getIdentityDocuments = async (req, res, next) => {
    try {
        const { id: employeeId } = req.params;
        (0, helpers_1.assertObjectId)(employeeId, 'employee id');
        await assertCanAccessEmployee(req, employeeId);
        const docs = await Document_1.IdentityDocument.find({ employee: employeeId }).sort({ documentType: 1 });
        res.json({ data: docs });
    }
    catch (err) { next(err); }
};
exports.getIdentityDocuments = getIdentityDocuments;

const createIdentityDocument = async (req, res, next) => {
    try {
        const { id: employeeId } = req.params;
        (0, helpers_1.assertObjectId)(employeeId, 'employee id');
        const employee = await Employee_1.Employee.findById(employeeId).select('fullName');
        if (!employee) throw new errorHandler_1.AppError('Employee not found', 404, 'NOT_FOUND');
        const data = identitySchema.parse(req.body);

        const number = data.number.replace(/\s+/g, '');
        const doc = await Document_1.IdentityDocument.findOneAndUpdate({ employee: employeeId, documentType: data.documentType }, {
            employee: employeeId,
            documentType: data.documentType,
            encryptedNumber: (0, encryption_1.encrypt)(number),
            maskedNumber: (0, encryption_1.maskIdentityNumber)(data.documentType, number),
            issueDate: data.issueDate ? new Date(data.issueDate) : undefined,
            expiryDate: data.expiryDate ? new Date(data.expiryDate) : undefined,
            notes: data.notes || undefined,
        }, { upsert: true, new: true, setDefaultsOnInsert: true });

        await auditService_1.auditService.log(req, {
            action: 'IDENTITY_DOCUMENT_SAVED', module: 'IDENTITY',
            recordId: doc._id.toString(), recordLabel: `${employee.fullName} — ${data.documentType}`,
        });
        const safe = doc.toObject();
        delete safe.encryptedNumber;
        res.json({ data: safe });
    }
    catch (err) { next(err); }
};
exports.createIdentityDocument = createIdentityDocument;

const revealIdentityNumber = async (req, res, next) => {
    try {
        const { id: employeeId, docType } = req.params;
        (0, helpers_1.assertObjectId)(employeeId, 'employee id');
        if (!roles_1.HR_ROLES.includes(req.user?.role || '')) {
            throw new errorHandler_1.AppError('Only HR Admin and Super Admin can reveal identity numbers', 403, 'FORBIDDEN');
        }
        const doc = await Document_1.IdentityDocument.findOne({ employee: employeeId, documentType: docType }).select('+encryptedNumber');
        if (!doc) throw new errorHandler_1.AppError('Identity document not found', 404, 'NOT_FOUND');

        let fullNumber;
        try {
            fullNumber = (0, encryption_1.decrypt)(doc.encryptedNumber);
        } catch {
            throw new errorHandler_1.AppError('This value cannot be decrypted — the encryption key may have changed', 500, 'DECRYPT_FAILED');
        }
        await auditService_1.auditService.log(req, {
            action: 'IDENTITY_REVEALED', module: 'IDENTITY',
            recordId: doc._id.toString(), recordLabel: docType,
        });
        res.json({ data: { number: fullNumber } });
    }
    catch (err) { next(err); }
};
exports.revealIdentityNumber = revealIdentityNumber;

/**
 * The mandatory-document checklist for one employee — required documents are
 * defined once in utils/documentRequirements.js and matched here against
 * whatever the employee has actually uploaded (see getDocuments above).
 */
const getDocumentChecklist = async (req, res, next) => {
    try {
        const { id: employeeId } = req.params;
        (0, helpers_1.assertObjectId)(employeeId, 'employee id');
        await assertCanAccessEmployee(req, employeeId);
        // Self-healing: recompute and persist the cached status on every read so
        // it can never silently drift from what the documents actually say.
        const synced = await syncDocumentStatus(employeeId, {});
        if (!synced) throw new errorHandler_1.AppError('Employee not found', 404, 'NOT_FOUND');
        const employee = await Employee_1.Employee.findById(employeeId).select('fullName employeeCode documentStatus hasRejectedDocuments').lean();
        res.json({ data: { employee, ...synced.checklist } });
    }
    catch (err) { next(err); }
};
exports.getDocumentChecklist = getDocumentChecklist;
