"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPayrollSummary = exports.updatePayslipStatus = exports.generatePayslipsBulk = exports.downloadPayslip = exports.generatePayslip = exports.getPayslips = exports.createSalaryStructure = exports.getSalaryStructures = exports.listSalaryStructures = void 0;
const Payroll_1 = require("../models/Payroll");
const Employee_1 = require("../models/Employee");
const NotificationAudit_1 = require("../models/NotificationAudit");
const auditService_1 = require("../services/auditService");
const pdfService_1 = require("../services/pdfService");
const storageService_1 = require("../services/storageService");
const errorHandler_1 = require("../middleware/errorHandler");
const helpers_1 = require("../utils/helpers");
const zod_1 = require("zod");
const roles_1 = require("../utils/roles");

/** Roles allowed to see payroll figures for people other than themselves. */
const PAYROLL_VIEW_ROLES = roles_1.PAYROLL_VIEW_ROLES;
exports.PAYROLL_VIEW_ROLES = PAYROLL_VIEW_ROLES;

const money = zod_1.z.coerce.number().min(0, 'Must be zero or more').max(100000000);

const salarySchema = zod_1.z.object({
    effectiveFrom: zod_1.z.string().min(1, 'Effective date is required'),
    basic: money,
    hra: money.default(0),
    da: money.default(0),
    specialAllowance: money.default(0),
    otherAllowances: money.default(0),
    pf: money.default(0),
    esi: money.default(0),
    tds: money.default(0),
    otherDeductions: money.default(0),
});

const generateSchema = zod_1.z.object({
    employeeId: zod_1.z.string().min(1, 'Employee is required'),
    month: zod_1.z.coerce.number().int().min(1).max(12),
    year: zod_1.z.coerce.number().int().min(2000).max(2100),
});

/** Restricts a payroll query to the caller's own record unless they hold a payroll role. */
async function scopeToViewer(req, query, employeeId) {
    if (PAYROLL_VIEW_ROLES.includes(req.user?.role)) {
        if (employeeId) {
            (0, helpers_1.assertObjectId)(employeeId, 'employeeId');
            query.employee = employeeId;
        }
        return;
    }
    const emp = await Employee_1.Employee.findOne({ user: req.user?.userId }).select('_id').lean();
    // No linked employee → match nothing rather than everything.
    query.employee = emp ? emp._id : { $in: [] };
}

/** All current salary structures, with employee details — the payroll grid. */
const listSalaryStructures = async (req, res, next) => {
    try {
        const { page, limit, skip } = (0, helpers_1.parsePagination)(req.query, 20);
        const { search, department, includeInactive } = req.query;

        const query = {};
        if (includeInactive !== 'true') query.isActive = true;
        if (search || department) {
            const empQuery = { isArchived: false };
            if (department) empQuery.department = department;
            if (search) {
                empQuery.$or = [
                    { fullName: (0, helpers_1.searchRegex)(search) },
                    { employeeCode: (0, helpers_1.searchRegex)(search) },
                ];
            }
            const ids = await Employee_1.Employee.find(empQuery).select('_id').lean();
            query.employee = { $in: ids.map((i) => i._id) };
        }

        const [structures, total] = await Promise.all([
            Payroll_1.SalaryStructure.find(query)
                .populate('employee', 'fullName employeeCode department designation status')
                .sort({ effectiveFrom: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Payroll_1.SalaryStructure.countDocuments(query),
        ]);
        res.json({
            // A structure whose employee was hard-deleted would populate to null.
            data: structures.filter((s) => s.employee),
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        });
    }
    catch (err) { next(err); }
};
exports.listSalaryStructures = listSalaryStructures;

const getSalaryStructures = async (req, res, next) => {
    try {
        const { employeeId } = req.params;
        (0, helpers_1.assertObjectId)(employeeId, 'employee id');
        if (!PAYROLL_VIEW_ROLES.includes(req.user?.role)) {
            const emp = await Employee_1.Employee.findOne({ user: req.user?.userId }).select('_id').lean();
            if (!emp || emp._id.toString() !== employeeId) {
                throw new errorHandler_1.AppError('Access denied', 403, 'FORBIDDEN');
            }
        }
        const structures = await Payroll_1.SalaryStructure.find({ employee: employeeId })
            .populate('employee', 'fullName employeeCode department designation')
            .sort({ effectiveFrom: -1 });
        res.json({ data: structures });
    }
    catch (err) { next(err); }
};
exports.getSalaryStructures = getSalaryStructures;

/**
 * Closes out any active salary structure and creates a new one. This is the
 * single place a salary structure is ever written, so both the direct-write
 * endpoint (SUPER_ADMIN/CTO/FINANCE) and the compensation-approval workflow
 * (see compensationController) share identical, audited behaviour.
 */
async function applySalaryChange({ employeeId, data, actorId }) {
    const grossSalary = data.basic + data.hra + data.da + data.specialAllowance + data.otherAllowances;
    const totalDeductions = data.pf + data.esi + data.tds + data.otherDeductions;
    if (totalDeductions > grossSalary) {
        throw new errorHandler_1.AppError('Deductions cannot exceed gross salary', 400, 'INVALID_AMOUNTS');
    }
    const netSalary = grossSalary - totalDeductions;
    const effectiveFrom = new Date(data.effectiveFrom);

    await Payroll_1.SalaryStructure.updateMany({ employee: employeeId, isActive: true }, { isActive: false, effectiveTo: effectiveFrom });

    return Payroll_1.SalaryStructure.create({
        ...data,
        employee: employeeId,
        effectiveFrom,
        grossSalary,
        netSalary,
        isActive: true,
        createdBy: actorId,
    });
}
exports.applySalaryChange = applySalaryChange;

const createSalaryStructure = async (req, res, next) => {
    try {
        const { employeeId } = req.params;
        (0, helpers_1.assertObjectId)(employeeId, 'employee id');
        const employee = await Employee_1.Employee.findById(employeeId);
        if (!employee) throw new errorHandler_1.AppError('Employee not found', 404, 'NOT_FOUND');

        const data = salarySchema.parse(req.body);
        const structure = await applySalaryChange({ employeeId, data, actorId: req.user?.userId });

        await auditService_1.auditService.log(req, {
            action: 'SALARY_UPDATED',
            module: 'PAYROLL',
            recordId: structure._id.toString(),
            recordLabel: employee.fullName,
            newValue: { grossSalary: structure.grossSalary, netSalary: structure.netSalary, effectiveFrom: structure.effectiveFrom },
        });
        res.status(201).json({ data: structure });
    }
    catch (err) { next(err); }
};
exports.createSalaryStructure = createSalaryStructure;

const getPayslips = async (req, res, next) => {
    try {
        const { page, limit, skip } = (0, helpers_1.parsePagination)(req.query, 12);
        const { employeeId, month, year, status, search, department } = req.query;

        const query = {};
        await scopeToViewer(req, query, employeeId);
        if (month) query.month = parseInt(month, 10);
        if (year) query.year = parseInt(year, 10);
        if (status) query.status = status;

        if ((search || department) && PAYROLL_VIEW_ROLES.includes(req.user?.role)) {
            const empQuery = { isArchived: false };
            if (department) empQuery.department = department;
            if (search) {
                empQuery.$or = [
                    { fullName: (0, helpers_1.searchRegex)(search) },
                    { employeeCode: (0, helpers_1.searchRegex)(search) },
                ];
            }
            const ids = await Employee_1.Employee.find(empQuery).select('_id').lean();
            const idClause = { $in: ids.map((i) => i._id) };
            // Intersect with any scope already applied instead of overwriting it.
            if (query.employee) {
                query.$and = [{ employee: query.employee }, { employee: idClause }];
                delete query.employee;
            } else {
                query.employee = idClause;
            }
        }

        const [payslips, total] = await Promise.all([
            Payroll_1.Payslip.find(query)
                .populate('employee', 'fullName employeeCode designation department')
                .sort({ year: -1, month: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Payroll_1.Payslip.countDocuments(query),
        ]);
        res.json({
            data: payslips.filter((p) => p.employee),
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        });
    }
    catch (err) { next(err); }
};
exports.getPayslips = getPayslips;

/** Builds and stores one payslip. Shared by the single and bulk endpoints. */
async function buildPayslip(req, employeeId, month, year) {
    const employee = await Employee_1.Employee.findById(employeeId);
    if (!employee) throw new errorHandler_1.AppError('Employee not found', 404, 'NOT_FOUND');

    const structure = await Payroll_1.SalaryStructure.findOne({ employee: employeeId, isActive: true });
    if (!structure) throw new errorHandler_1.AppError(`No active salary structure for ${employee.fullName}`, 400, 'NO_SALARY_STRUCTURE');

    const existing = await Payroll_1.Payslip.findOne({ employee: employeeId, month, year });
    if (existing) throw new errorHandler_1.AppError(`A payslip already exists for ${employee.fullName} in ${month}/${year}`, 409, 'DUPLICATE');

    const payPeriodStart = new Date(year, month - 1, 1);
    const payPeriodEnd = new Date(year, month, 0);
    const workingDays = payPeriodEnd.getDate();
    const totalEarnings = structure.basic + structure.hra + structure.da + structure.specialAllowance + structure.otherAllowances;
    const totalDeductions = structure.pf + structure.esi + structure.tds + structure.otherDeductions;

    const payslip = await Payroll_1.Payslip.create({
        employee: employeeId,
        salaryStructure: structure._id,
        month, year, payPeriodStart, payPeriodEnd,
        basic: structure.basic,
        hra: structure.hra,
        da: structure.da,
        specialAllowance: structure.specialAllowance,
        otherAllowances: structure.otherAllowances,
        totalEarnings,
        pf: structure.pf,
        esi: structure.esi,
        tds: structure.tds,
        otherDeductions: structure.otherDeductions,
        totalDeductions,
        grossSalary: totalEarnings,
        netSalary: totalEarnings - totalDeductions,
        workingDays,
        paidDays: workingDays,
        lop: 0,
        status: 'GENERATED',
        generatedBy: req.user?.userId,
    });

    try {
        const pdfBuffer = await pdfService_1.pdfService.generatePayslip(payslip, employee);
        payslip.pdfPath = await storageService_1.storageService.upload({
            buffer: pdfBuffer,
            originalname: `payslip-${employee.employeeCode}-${month}-${year}.pdf`,
            mimetype: 'application/pdf',
        }, 'payslips');
        await payslip.save();
    } catch (err) {
        // The payslip record itself is valid even if PDF rendering failed; surface it
        // rather than losing the record, and let the download endpoint regenerate.
        console.error('Payslip PDF generation failed:', err.message);
    }

    if (employee.user) {
        try {
            await NotificationAudit_1.Notification.create({
                user: employee.user,
                type: 'PAYSLIP_GENERATED',
                title: 'Payslip available',
                message: `Your payslip for ${month}/${year} is ready to download.`,
                relatedModel: 'Payslip',
                relatedId: payslip._id,
            });
        } catch (err) {
            console.error('Notification create failed:', err.message);
        }
    }
    return payslip;
}

const generatePayslip = async (req, res, next) => {
    try {
        const { employeeId, month, year } = generateSchema.parse(req.body);
        (0, helpers_1.assertObjectId)(employeeId, 'employeeId');
        const payslip = await buildPayslip(req, employeeId, month, year);
        await auditService_1.auditService.log(req, { action: 'PAYSLIP_GENERATED', module: 'PAYROLL', recordId: payslip._id.toString() });
        res.status(201).json({ data: payslip });
    }
    catch (err) { next(err); }
};
exports.generatePayslip = generatePayslip;

/** Generates payslips for every active employee that has a salary structure. */
const generatePayslipsBulk = async (req, res, next) => {
    try {
        const month = parseInt(req.body?.month, 10);
        const year = parseInt(req.body?.year, 10);
        if (!(month >= 1 && month <= 12) || !(year >= 2000 && year <= 2100)) {
            throw new errorHandler_1.AppError('A valid month and year are required', 400, 'VALIDATION_ERROR');
        }
        const structures = await Payroll_1.SalaryStructure.find({ isActive: true }).select('employee').lean();
        const results = { generated: 0, skipped: 0, errors: [] };
        for (const s of structures) {
            try {
                await buildPayslip(req, s.employee, month, year);
                results.generated += 1;
            } catch (err) {
                results.skipped += 1;
                if (err.code !== 'DUPLICATE') results.errors.push(err.message);
            }
        }
        await auditService_1.auditService.log(req, {
            action: 'PAYSLIP_BULK_GENERATED', module: 'PAYROLL',
            recordLabel: `${month}/${year}`, newValue: results,
        });
        res.json({ data: results });
    }
    catch (err) { next(err); }
};
exports.generatePayslipsBulk = generatePayslipsBulk;

const downloadPayslip = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'payslip id');
        const payslip = await Payroll_1.Payslip.findById(id).populate('employee');
        if (!payslip) throw new errorHandler_1.AppError('Payslip not found', 404, 'NOT_FOUND');

        if (!PAYROLL_VIEW_ROLES.includes(req.user?.role)) {
            const emp = await Employee_1.Employee.findOne({ user: req.user?.userId }).select('_id').lean();
            if (!emp || String(payslip.employee?._id) !== String(emp._id)) {
                throw new errorHandler_1.AppError('Access denied', 403, 'FORBIDDEN');
            }
        }

        let buffer;
        if (payslip.pdfPath) {
            try {
                buffer = await storageService_1.storageService.download(payslip.pdfPath);
            } catch {
                buffer = null;
            }
        }
        if (!buffer) {
            // Stored file missing (or PDF generation failed earlier) — render on demand.
            buffer = await pdfService_1.pdfService.generatePayslip(payslip, payslip.employee);
        }

        await auditService_1.auditService.log(req, { action: 'PAYSLIP_DOWNLOADED', module: 'PAYROLL', recordId: id });
        const name = `payslip-${payslip.employee?.employeeCode || id}-${payslip.month}-${payslip.year}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
        res.setHeader('Content-Length', buffer.length);
        res.send(buffer);
    }
    catch (err) { next(err); }
};
exports.downloadPayslip = downloadPayslip;

const updatePayslipStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'payslip id');
        const status = req.body?.status;
        if (!['DRAFT', 'GENERATED', 'PAID'].includes(status)) {
            throw new errorHandler_1.AppError('Status must be DRAFT, GENERATED or PAID', 400, 'VALIDATION_ERROR');
        }
        const update = status === 'PAID'
            ? { $set: { status, paidOn: new Date() } }
            : { $set: { status }, $unset: { paidOn: '' } };
        const payslip = await Payroll_1.Payslip.findByIdAndUpdate(id, update, { new: true })
            .populate('employee', 'fullName employeeCode');
        if (!payslip) throw new errorHandler_1.AppError('Payslip not found', 404, 'NOT_FOUND');
        await auditService_1.auditService.log(req, {
            action: 'PAYSLIP_STATUS_CHANGED', module: 'PAYROLL',
            recordId: id, recordLabel: payslip.employee?.fullName, newValue: { status },
        });
        res.json({ data: payslip });
    }
    catch (err) { next(err); }
};
exports.updatePayslipStatus = updatePayslipStatus;

/** Totals for the payroll overview cards, for one month/year. */
const getPayrollSummary = async (req, res, next) => {
    try {
        const now = new Date();
        const month = parseInt(req.query.month, 10) || (now.getMonth() + 1);
        const year = parseInt(req.query.year, 10) || now.getFullYear();

        const [agg, paidAgg, activeStructures, activeEmployees] = await Promise.all([
            Payroll_1.Payslip.aggregate([
                { $match: { month, year } },
                {
                    $group: {
                        _id: null,
                        count: { $sum: 1 },
                        gross: { $sum: '$grossSalary' },
                        deductions: { $sum: '$totalDeductions' },
                        net: { $sum: '$netSalary' },
                    },
                },
            ]),
            Payroll_1.Payslip.aggregate([
                { $match: { month, year, status: 'PAID' } },
                { $group: { _id: null, count: { $sum: 1 }, net: { $sum: '$netSalary' } } },
            ]),
            Payroll_1.SalaryStructure.countDocuments({ isActive: true }),
            Employee_1.Employee.countDocuments({ isArchived: false, status: { $ne: 'INACTIVE' } }),
        ]);

        const totals = agg[0] || { count: 0, gross: 0, deductions: 0, net: 0 };
        const paid = paidAgg[0] || { count: 0, net: 0 };
        res.json({
            data: {
                month, year,
                payslipCount: totals.count,
                grossPayroll: totals.gross,
                totalDeductions: totals.deductions,
                netPayroll: totals.net,
                employeesPaid: paid.count,
                paidAmount: paid.net,
                pendingPayslips: Math.max(0, activeStructures - totals.count),
                activeStructures,
                activeEmployees,
                employeesWithoutStructure: Math.max(0, activeEmployees - activeStructures),
            },
        });
    }
    catch (err) { next(err); }
};
exports.getPayrollSummary = getPayrollSummary;
