"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFilterOptions = exports.importEmployees = exports.uploadPhoto = exports.archiveEmployee = exports.updateEmployee = exports.createEmployee = exports.getEmployee = exports.getEmployees = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const Employee_1 = require("../models/Employee");
const User_1 = require("../models/User");
const auditService_1 = require("../services/auditService");
const storageService_1 = require("../services/storageService");
const errorHandler_1 = require("../middleware/errorHandler");
const helpers_1 = require("../utils/helpers");
const zod_1 = require("zod");
const Document_1 = require("../models/Document");
const { buildChecklist } = require("../utils/documentRequirements");
const { matchesDeclaredType } = require("../utils/fileSignature");

const DATE_FIELDS = ['dateOfJoining', 'probationEndDate', 'confirmationDate', 'dateOfExit', 'dateOfBirth'];

const employeeSchema = zod_1.z.object({
    employeeCode: zod_1.z.string().min(1, 'Employee code is required').max(20),
    firstName: zod_1.z.string().min(1, 'First name is required').max(60),
    // lastName is optional — single-name employees are valid
    lastName: zod_1.z.string().max(60).optional().or(zod_1.z.literal('')),
    officialEmail: zod_1.z.string().email('A valid official email is required'),
    personalEmail: zod_1.z.string().email('Personal email is not valid').optional().or(zod_1.z.literal('')),
    personalMobile: zod_1.z.string().max(20).optional().or(zod_1.z.literal('')),
    officialMobile: zod_1.z.string().max(20).optional().or(zod_1.z.literal('')),
    designation: zod_1.z.string().min(1, 'Designation is required').max(80),
    department: zod_1.z.string().min(1, 'Department is required'),
    employmentType: zod_1.z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT']).optional(),
    status: zod_1.z.enum(['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'PROBATION', 'NOTICE_PERIOD']).optional(),
    dateOfJoining: zod_1.z.string().min(1, 'Date of joining is required'),
    probationEndDate: zod_1.z.string().optional().or(zod_1.z.literal('')),
    confirmationDate: zod_1.z.string().optional().or(zod_1.z.literal('')),
    dateOfExit: zod_1.z.string().optional().or(zod_1.z.literal('')),
    exitReason: zod_1.z.string().max(200).optional().or(zod_1.z.literal('')),
    // Accept string OR number — the form sends an empty string when blank.
    noticePeriodDays: zod_1.z.union([
        zod_1.z.number(),
        zod_1.z.string().transform((v) => (v === '' ? undefined : Number(v))),
    ]).optional(),
    workLocation: zod_1.z.string().max(120).optional().or(zod_1.z.literal('')),
    dateOfBirth: zod_1.z.string().optional().or(zod_1.z.literal('')),
    gender: zod_1.z.string().max(20).optional().or(zod_1.z.literal('')),
    bloodGroup: zod_1.z.string().max(5).optional().or(zod_1.z.literal('')),
    nationality: zod_1.z.string().max(60).optional().or(zod_1.z.literal('')),
    manager: zod_1.z.string().optional().or(zod_1.z.literal('')),
    // fullName is computed server-side; accept and ignore it.
    fullName: zod_1.z.string().optional(),
});

/** Turns '' into undefined and date strings into Dates. */
function normalise(data) {
    const out = { ...data };
    delete out.fullName;
    DATE_FIELDS.forEach((f) => {
        if (f in out) out[f] = out[f] ? new Date(out[f]) : undefined;
    });
    Object.keys(out).forEach((k) => {
        if (out[k] === '') out[k] = undefined;
    });
    return out;
}

function buildFullName(firstName, lastName) {
    return `${firstName}${lastName ? ` ${lastName}` : ''}`.trim();
}

/** Rejects a manager chain that would loop back onto the employee. */
async function assertNoManagerCycle(employeeId, managerId) {
    if (!managerId) return;
    if (employeeId && String(managerId) === String(employeeId)) {
        throw new errorHandler_1.AppError('An employee cannot be their own manager', 400, 'INVALID_MANAGER');
    }
    let cursor = managerId;
    const seen = new Set([String(employeeId || '')]);
    for (let i = 0; i < 20 && cursor; i += 1) {
        if (seen.has(String(cursor))) {
            throw new errorHandler_1.AppError('That reporting line would create a loop', 400, 'INVALID_MANAGER');
        }
        seen.add(String(cursor));
        const next = await Employee_1.Employee.findById(cursor).select('manager').lean();
        if (!next) throw new errorHandler_1.AppError('Manager not found', 404, 'NOT_FOUND');
        cursor = next.manager;
    }
}

const getEmployees = async (req, res, next) => {
    try {
        const { page, limit, skip } = (0, helpers_1.parsePagination)(req.query, 20);
        const {
            search, department, designation, status, employmentType, documentStatus,
            sort = 'employeeCode', sortDir = 'asc', includeArchived,
        } = req.query;

        const query = {};
        query.isArchived = includeArchived === 'true' ? { $in: [true, false] } : false;
        if (search) {
            query.$or = [
                { fullName: (0, helpers_1.searchRegex)(search) },
                { employeeCode: (0, helpers_1.searchRegex)(search) },
                { officialEmail: (0, helpers_1.searchRegex)(search) },
                { designation: (0, helpers_1.searchRegex)(search) },
            ];
        }
        if (department) query.department = department;
        if (designation) query.designation = designation;
        if (status) query.status = status;
        if (employmentType) query.employmentType = employmentType;
        // REJECTED is a specialisation of PENDING (something was uploaded and
        // turned down), not a third top-level value on the field itself.
        if (documentStatus === 'REJECTED') query.hasRejectedDocuments = true;
        else if (documentStatus === 'PENDING') { query.documentStatus = 'PENDING'; query.hasRejectedDocuments = { $ne: true }; }
        else if (documentStatus === 'COMPLETE') query.documentStatus = 'COMPLETE';

        const { scope } = await (0, helpers_1.resolveEmployeeScope)(req.user);
        if (scope !== undefined) query._id = scope === null ? { $in: [] } : scope;

        // Whitelist sortable fields so a query string cannot sort on anything.
        const SORTABLE = ['employeeCode', 'fullName', 'department', 'designation', 'status', 'dateOfJoining', 'createdAt'];
        const sortField = SORTABLE.includes(sort) ? sort : 'employeeCode';
        const sortObj = { [sortField]: sortDir === 'desc' ? -1 : 1 };

        const [employees, total] = await Promise.all([
            Employee_1.Employee.find(query)
                .populate('manager', 'fullName employeeCode')
                .sort(sortObj)
                .skip(skip)
                .limit(limit)
                .lean(),
            Employee_1.Employee.countDocuments(query),
        ]);
        res.json({ data: employees, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
    }
    catch (err) { next(err); }
};
exports.getEmployees = getEmployees;

const getEmployee = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'employee id');
        const { scope } = await (0, helpers_1.resolveEmployeeScope)(req.user);
        if (scope !== undefined) {
            const allowed = scope === null ? [] : (scope.$in ? scope.$in.map(String) : [String(scope)]);
            if (!allowed.includes(String(id))) throw new errorHandler_1.AppError('Access denied', 403, 'FORBIDDEN');
        }
        const employee = await Employee_1.Employee.findById(id)
            .populate('manager', 'fullName employeeCode designation')
            .populate('user', 'email role isActive lastLogin');
        if (!employee) throw new errorHandler_1.AppError('Employee not found', 404, 'NOT_FOUND');
        res.json({ data: employee });
    }
    catch (err) { next(err); }
};
exports.getEmployee = getEmployee;

const createEmployee = async (req, res, next) => {
    try {
        const data = employeeSchema.parse(req.body);
        const existing = await Employee_1.Employee.findOne({
            $or: [{ employeeCode: data.employeeCode }, { officialEmail: data.officialEmail.toLowerCase() }],
        });
        if (existing) {
            const field = existing.employeeCode === data.employeeCode ? 'employee code' : 'official email';
            throw new errorHandler_1.AppError(`This ${field} is already in use`, 409, 'DUPLICATE');
        }
        const userClash = await User_1.User.findOne({ email: data.officialEmail.toLowerCase() });
        if (userClash) throw new errorHandler_1.AppError('A login already exists for this email', 409, 'DUPLICATE');

        if (data.manager) {
            (0, helpers_1.assertObjectId)(data.manager, 'manager id');
            await assertNoManagerCycle(null, data.manager);
        }

        const payload = normalise(data);
        const employee = await Employee_1.Employee.create({
            ...payload,
            fullName: buildFullName(data.firstName, data.lastName),
        });

        const password = await bcryptjs_1.default.hash(process.env.SEED_EMPLOYEE_PASSWORD || 'Employee@123456', 12);
        const user = await User_1.User.create({
            email: data.officialEmail.toLowerCase(),
            password,
            role: 'EMPLOYEE',
            employee: employee._id,
        });
        employee.user = user._id;
        await employee.save();

        await auditService_1.auditService.log(req, {
            action: 'EMPLOYEE_CREATED',
            module: 'EMPLOYEES',
            recordId: employee._id.toString(),
            recordLabel: employee.fullName,
            newValue: { employeeCode: employee.employeeCode, department: employee.department, designation: employee.designation },
        });
        res.status(201).json({ data: employee });
    }
    catch (err) { next(err); }
};
exports.createEmployee = createEmployee;

const updateEmployee = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'employee id');
        const data = employeeSchema.partial().parse(req.body);
        const employee = await Employee_1.Employee.findById(id);
        if (!employee) throw new errorHandler_1.AppError('Employee not found', 404, 'NOT_FOUND');

        if (data.employeeCode && data.employeeCode !== employee.employeeCode) {
            const clash = await Employee_1.Employee.findOne({ employeeCode: data.employeeCode, _id: { $ne: id } });
            if (clash) throw new errorHandler_1.AppError('This employee code is already in use', 409, 'DUPLICATE');
        }
        if (data.officialEmail && data.officialEmail.toLowerCase() !== employee.officialEmail) {
            const clash = await Employee_1.Employee.findOne({ officialEmail: data.officialEmail.toLowerCase(), _id: { $ne: id } });
            if (clash) throw new errorHandler_1.AppError('This official email is already in use', 409, 'DUPLICATE');
        }
        if (data.manager !== undefined && data.manager) {
            (0, helpers_1.assertObjectId)(data.manager, 'manager id');
            await assertNoManagerCycle(id, data.manager);
        }

        const oldValue = {
            department: employee.department, designation: employee.designation,
            status: employee.status, officialEmail: employee.officialEmail,
        };
        const updateData = normalise(data);
        if (data.firstName !== undefined || data.lastName !== undefined) {
            updateData.fullName = buildFullName(
                data.firstName ?? employee.firstName,
                data.lastName !== undefined ? data.lastName : employee.lastName,
            );
        }
        // `manager: ''` means "clear the reporting line".
        if (data.manager === '') updateData.manager = undefined;

        // Mandatory-document gate: moving an employee INTO the ACTIVE employment
        // state requires their required documents to be fully verified first.
        // This is enforced here — the only place `status` is ever written to
        // ACTIVE outside of creation — so it cannot be bypassed by calling this
        // same endpoint differently; there is no separate "activate" route to
        // forget to gate. Documents already MISSING at creation time (the
        // normal case) never touch this path, since a brand-new employee is not
        // transitioning from a non-active state.
        if (data.status === 'ACTIVE' && employee.status !== 'ACTIVE') {
            const docs = await Document_1.EmployeeDocument.find({ employee: id }).select('category status isArchived createdAt').lean();
            const checklist = buildChecklist(employee, docs);
            if (!checklist.summary.isComplete) {
                throw new errorHandler_1.AppError(
                    'Employee cannot be fully activated until all required documents are verified.',
                    400,
                    'DOCUMENTS_INCOMPLETE',
                );
            }
        }

        Object.assign(employee, updateData);
        await employee.save();

        // Keep the linked login address in step with the official email.
        if (data.officialEmail && employee.user) {
            await User_1.User.findByIdAndUpdate(employee.user, { email: employee.officialEmail });
        }

        await auditService_1.auditService.log(req, {
            action: 'EMPLOYEE_UPDATED',
            module: 'EMPLOYEES',
            recordId: employee._id.toString(),
            recordLabel: employee.fullName,
            oldValue,
            newValue: data,
        });
        res.json({ data: employee });
    }
    catch (err) { next(err); }
};
exports.updateEmployee = updateEmployee;

const archiveEmployee = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'employee id');
        const employee = await Employee_1.Employee.findById(id);
        if (!employee) throw new errorHandler_1.AppError('Employee not found', 404, 'NOT_FOUND');
        if (employee.isArchived) throw new errorHandler_1.AppError('This employee is already archived', 400, 'ALREADY_ARCHIVED');

        const reports = await Employee_1.Employee.countDocuments({ manager: id, isArchived: false });
        if (reports > 0) {
            throw new errorHandler_1.AppError(`Reassign ${reports} direct report(s) before archiving this employee`, 400, 'HAS_REPORTS');
        }

        employee.isArchived = true;
        employee.status = 'INACTIVE';
        if (!employee.dateOfExit) employee.dateOfExit = new Date();
        await employee.save();
        if (employee.user) {
            await User_1.User.findByIdAndUpdate(employee.user, { isActive: false });
        }
        await auditService_1.auditService.log(req, {
            action: 'EMPLOYEE_ARCHIVED',
            module: 'EMPLOYEES',
            recordId: employee._id.toString(),
            recordLabel: employee.fullName,
        });
        res.json({ data: employee, message: 'Employee archived successfully' });
    }
    catch (err) { next(err); }
};
exports.archiveEmployee = archiveEmployee;

const uploadPhoto = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'employee id');
        const employee = await Employee_1.Employee.findById(id);
        if (!employee) throw new errorHandler_1.AppError('Employee not found', 404, 'NOT_FOUND');
        if (!req.file) throw new errorHandler_1.AppError('No file was uploaded', 400, 'NO_FILE');
        if (!matchesDeclaredType(req.file.buffer, req.file.mimetype)) {
            throw new errorHandler_1.AppError('The file content does not match its declared type', 400, 'INVALID_FILE_TYPE');
        }

        // An EMPLOYEE may only replace their own photo.
        if (req.user?.role === 'EMPLOYEE' && String(employee.user) !== String(req.user.userId)) {
            throw new errorHandler_1.AppError('Access denied', 403, 'FORBIDDEN');
        }

        const filePath = await storageService_1.storageService.upload(req.file, 'photos');
        employee.profilePhoto = filePath;
        await employee.save();
        res.json({ data: { profilePhoto: filePath } });
    }
    catch (err) { next(err); }
};
exports.uploadPhoto = uploadPhoto;

const importEmployees = async (req, res, next) => {
    try {
        const rows = req.body?.rows;
        if (!Array.isArray(rows) || rows.length === 0) {
            throw new errorHandler_1.AppError('No rows were provided', 400, 'EMPTY_DATA');
        }
        if (rows.length > 500) {
            throw new errorHandler_1.AppError('Import is limited to 500 rows at a time', 400, 'TOO_MANY_ROWS');
        }
        const results = { imported: 0, failed: 0, errors: [] };
        for (const row of rows) {
            try {
                const data = employeeSchema.parse(row);
                const existing = await Employee_1.Employee.findOne({
                    $or: [{ employeeCode: data.employeeCode }, { officialEmail: data.officialEmail.toLowerCase() }],
                });
                if (existing) {
                    results.failed += 1;
                    results.errors.push(`${data.employeeCode}: duplicate code or email`);
                    continue;
                }
                const employee = await Employee_1.Employee.create({
                    ...normalise(data),
                    fullName: buildFullName(data.firstName, data.lastName),
                });
                const password = await bcryptjs_1.default.hash(process.env.SEED_EMPLOYEE_PASSWORD || 'Employee@123456', 12);
                const user = await User_1.User.create({
                    email: data.officialEmail.toLowerCase(),
                    password,
                    role: 'EMPLOYEE',
                    employee: employee._id,
                });
                employee.user = user._id;
                await employee.save();
                results.imported += 1;
            }
            catch (err) {
                results.failed += 1;
                results.errors.push(`${row?.employeeCode || 'row'}: ${err.errors?.[0]?.message || err.message}`);
            }
        }
        await auditService_1.auditService.log(req, {
            action: 'EMPLOYEES_IMPORTED', module: 'EMPLOYEES', newValue: { imported: results.imported, failed: results.failed },
        });
        res.json({ data: results });
    }
    catch (err) { next(err); }
};
exports.importEmployees = importEmployees;

/** Distinct values used to populate filter dropdowns, plus the manager picker. */
const getFilterOptions = async (req, res, next) => {
    try {
        // The manager picker must never hand out names outside the caller's own
        // scope (e.g. an EMPLOYEE or IT_HEAD listing the whole company via this
        // dropdown) — restrict it the same way the employee list itself is.
        const { scope } = await (0, helpers_1.resolveEmployeeScope)(req.user);
        const managerQuery = { isArchived: false, status: { $ne: 'INACTIVE' } };
        if (scope !== undefined) managerQuery._id = scope === null ? { $in: [] } : scope;

        const [departments, designations, managers] = await Promise.all([
            Employee_1.Employee.distinct('department', { isArchived: false }),
            Employee_1.Employee.distinct('designation', { isArchived: false }),
            Employee_1.Employee.find(managerQuery)
                .select('fullName employeeCode designation department')
                .sort({ fullName: 1 })
                .lean(),
        ]);
        // Merge the canonical list with whatever is actually in use.
        const merged = [...new Set([...helpers_1.DEPARTMENTS, ...departments.filter(Boolean)])];
        res.json({
            data: {
                departments: merged,
                designations: designations.filter(Boolean).sort(),
                managers,
            },
        });
    }
    catch (err) { next(err); }
};
exports.getFilterOptions = getFilterOptions;
