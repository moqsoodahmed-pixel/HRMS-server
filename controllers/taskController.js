"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOffboardingClearance = exports.initiateOffboarding = exports.applyTemplate = exports.deleteTask = exports.updateTask = exports.createTask = exports.getEmployeeTasks = exports.getTaskOverview = exports.TEMPLATES = void 0;
const AssetOnboarding_1 = require("../models/AssetOnboarding");
const Employee_1 = require("../models/Employee");
const Document_1 = require("../models/Document");
const Payroll_1 = require("../models/Payroll");
const NotificationAudit_1 = require("../models/NotificationAudit");
const auditService_1 = require("../services/auditService");
const errorHandler_1 = require("../middleware/errorHandler");
const helpers_1 = require("../utils/helpers");
const zod_1 = require("zod");
const roles_1 = require("../utils/roles");

const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED'];
const ADMIN_ROLES = roles_1.HR_ROLES;

/** Default checklists applied when a journey is started. */
exports.TEMPLATES = {
    onboarding: [
        { taskName: 'Collect signed offer letter', category: 'Documentation', description: 'Signed offer letter and acceptance on file.', offsetDays: 0 },
        { taskName: 'Verify identity documents', category: 'Documentation', description: 'Aadhaar / PAN verified and recorded against the profile.', offsetDays: 2 },
        { taskName: 'Collect bank and PF details', category: 'Finance', description: 'Bank account, UAN and nominee details captured.', offsetDays: 3 },
        { taskName: 'Create official email account', category: 'IT Setup', description: 'Provision the official mailbox and directory account.', offsetDays: 1 },
        { taskName: 'Issue laptop and accessories', category: 'IT Setup', description: 'Assign the hardware in the asset register.', offsetDays: 1 },
        { taskName: 'Grant systems access', category: 'IT Setup', description: 'Role-based access to the tools the role needs.', offsetDays: 2 },
        { taskName: 'Add to payroll', category: 'Finance', description: 'Create the salary structure for the employee.', offsetDays: 5 },
        { taskName: 'Company induction session', category: 'HR', description: 'Overview of the company, teams and ways of working.', offsetDays: 3 },
        { taskName: 'Policy acknowledgement', category: 'HR', description: 'Read and acknowledge the published policies.', offsetDays: 5 },
        { taskName: 'Assign buddy and introduce to team', category: 'HR', description: 'Pair with a buddy for the first month.', offsetDays: 2 },
    ],
    offboarding: [
        { taskName: 'HR clearance', category: 'HR', description: 'Resignation accepted, notice period and last working day confirmed.', offsetDays: 0 },
        { taskName: 'IT clearance', category: 'IT', description: 'Devices wiped, licences reclaimed, mailbox handled.', offsetDays: 2 },
        { taskName: 'Finance clearance', category: 'Finance', description: 'Outstanding advances, reimbursements and dues settled.', offsetDays: 3 },
        { taskName: 'Asset return', category: 'Assets', description: 'All assigned assets returned and condition recorded.', offsetDays: 2 },
        { taskName: 'Document collection', category: 'Documentation', description: 'Handover notes and remaining documents collected.', offsetDays: 3 },
        { taskName: 'Access revocation', category: 'IT', description: 'Revoke every system, VPN and third-party account.', offsetDays: 0 },
        { taskName: 'Exit interview', category: 'HR', description: 'Conduct and record the exit interview.', offsetDays: 1 },
        { taskName: 'Final settlement', category: 'Finance', description: 'Full and final settlement processed and paid.', offsetDays: 7 },
    ],
};

const taskSchema = zod_1.z.object({
    employee: zod_1.z.string().min(1, 'Employee is required'),
    taskName: zod_1.z.string().min(2, 'Task name is required').max(160),
    description: zod_1.z.string().max(1000).optional().or(zod_1.z.literal('')),
    category: zod_1.z.string().min(1, 'Category is required'),
    assignedTo: zod_1.z.string().optional().or(zod_1.z.literal('')),
    dueDate: zod_1.z.string().optional().or(zod_1.z.literal('')),
    status: zod_1.z.enum(TASK_STATUSES).optional(),
    isRequired: zod_1.z.boolean().optional(),
    order: zod_1.z.coerce.number().int().min(0).optional(),
});

const updateSchema = taskSchema.partial().omit({ employee: true }).extend({
    notes: zod_1.z.string().max(1000).optional().or(zod_1.z.literal('')),
});

function modelFor(kind) {
    return kind === 'offboarding' ? AssetOnboarding_1.OffboardingTask : AssetOnboarding_1.OnboardingTask;
}

/** Legacy records used PENDING; the UI works in TODO. */
function normaliseStatus(status) {
    if (status === 'PENDING') return 'TODO';
    if (status === 'SKIPPED') return 'COMPLETED';
    return status || 'TODO';
}

function progressOf(tasks) {
    const total = tasks.length;
    const completed = tasks.filter((t) => normaliseStatus(t.status) === 'COMPLETED').length;
    const blocked = tasks.filter((t) => normaliseStatus(t.status) === 'BLOCKED').length;
    const inProgress = tasks.filter((t) => normaliseStatus(t.status) === 'IN_PROGRESS').length;
    return {
        total,
        completed,
        blocked,
        inProgress,
        pending: total - completed,
        percent: total ? Math.round((completed / total) * 100) : 0,
    };
}

/** Per-employee progress rows for the overview list. */
const getTaskOverview = (kind) => async (req, res, next) => {
    try {
        const Model = modelFor(kind);
        const { search, department, status } = req.query;

        const { scope } = await (0, helpers_1.resolveEmployeeScope)(req.user);
        const empQuery = {};
        if (scope !== undefined) empQuery._id = scope === null ? { $in: [] } : scope;
        if (department) empQuery.department = department;
        if (search) {
            empQuery.$or = [
                { fullName: (0, helpers_1.searchRegex)(search) },
                { employeeCode: (0, helpers_1.searchRegex)(search) },
            ];
        }
        // Offboarding is about people on the way out; onboarding about people coming in.
        if (kind === 'offboarding') {
            empQuery.$and = [{ $or: [{ dateOfExit: { $ne: null } }, { status: 'NOTICE_PERIOD' }] }];
        } else {
            empQuery.isArchived = false;
        }

        const employees = await Employee_1.Employee.find(empQuery)
            .select('fullName employeeCode department designation status dateOfJoining dateOfExit exitReason profilePhoto')
            .sort({ dateOfJoining: -1 })
            .lean();

        const tasks = await Model.find({ employee: { $in: employees.map((e) => e._id) } })
            .select('employee status dueDate')
            .lean();
        const byEmployee = new Map();
        tasks.forEach((t) => {
            const key = String(t.employee);
            if (!byEmployee.has(key)) byEmployee.set(key, []);
            byEmployee.get(key).push(t);
        });

        let rows = employees.map((e) => {
            const own = byEmployee.get(String(e._id)) || [];
            const progress = progressOf(own);
            return {
                employee: e,
                progress,
                overdue: own.filter((t) => normaliseStatus(t.status) !== 'COMPLETED' && t.dueDate && new Date(t.dueDate) < new Date()).length,
                state: progress.total === 0 ? 'NOT_STARTED' : progress.percent === 100 ? 'COMPLETED' : 'IN_PROGRESS',
            };
        });
        if (status) rows = rows.filter((r) => r.state === status);
        // Unfinished journeys first — that is what needs attention.
        rows.sort((a, b) => (a.progress.percent - b.progress.percent) || (b.progress.total - a.progress.total));

        res.json({
            data: rows,
            meta: {
                total: rows.length,
                notStarted: rows.filter((r) => r.state === 'NOT_STARTED').length,
                inProgress: rows.filter((r) => r.state === 'IN_PROGRESS').length,
                completed: rows.filter((r) => r.state === 'COMPLETED').length,
            },
        });
    }
    catch (err) { next(err); }
};
exports.getTaskOverview = getTaskOverview;

const getEmployeeTasks = (kind) => async (req, res, next) => {
    try {
        const { employeeId } = req.params;
        (0, helpers_1.assertObjectId)(employeeId, 'employee id');
        const { scope } = await (0, helpers_1.resolveEmployeeScope)(req.user);
        if (scope !== undefined) {
            const allowed = scope === null ? [] : (scope.$in ? scope.$in.map(String) : [String(scope)]);
            if (!allowed.includes(String(employeeId))) throw new errorHandler_1.AppError('Access denied', 403, 'FORBIDDEN');
        }
        const [employee, tasks] = await Promise.all([
            Employee_1.Employee.findById(employeeId)
                .select('fullName employeeCode department designation status dateOfJoining dateOfExit exitReason noticePeriodDays')
                .lean(),
            modelFor(kind).find({ employee: employeeId })
                .populate('assignedTo', 'email')
                .populate('completedBy', 'email')
                .sort({ order: 1, createdAt: 1 })
                .lean(),
        ]);
        if (!employee) throw new errorHandler_1.AppError('Employee not found', 404, 'NOT_FOUND');
        const normalised = tasks.map((t) => ({ ...t, status: normaliseStatus(t.status) }));
        res.json({ data: normalised, meta: { employee, progress: progressOf(normalised) } });
    }
    catch (err) { next(err); }
};
exports.getEmployeeTasks = getEmployeeTasks;

const createTask = (kind) => async (req, res, next) => {
    try {
        const data = taskSchema.parse(req.body);
        (0, helpers_1.assertObjectId)(data.employee, 'employee id');
        if (data.assignedTo) (0, helpers_1.assertObjectId)(data.assignedTo, 'assignedTo');
        const employee = await Employee_1.Employee.findById(data.employee).select('fullName').lean();
        if (!employee) throw new errorHandler_1.AppError('Employee not found', 404, 'NOT_FOUND');

        const Model = modelFor(kind);
        const count = await Model.countDocuments({ employee: data.employee });
        const task = await Model.create({
            ...data,
            assignedTo: data.assignedTo || undefined,
            dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
            description: data.description || undefined,
            status: data.status || 'TODO',
            order: data.order ?? count,
        });
        await auditService_1.auditService.log(req, {
            action: kind === 'offboarding' ? 'OFFBOARDING_TASK_CREATED' : 'ONBOARDING_TASK_CREATED',
            module: kind === 'offboarding' ? 'OFFBOARDING' : 'ONBOARDING',
            recordId: task._id.toString(),
            recordLabel: `${employee.fullName} — ${task.taskName}`,
        });
        res.status(201).json({ data: task });
    }
    catch (err) { next(err); }
};
exports.createTask = createTask;

const updateTask = (kind) => async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'task id');
        const data = updateSchema.parse(req.body);
        const Model = modelFor(kind);
        const task = await Model.findById(id);
        if (!task) throw new errorHandler_1.AppError('Task not found', 404, 'NOT_FOUND');

        // HR/Admin may edit anything. Everyone else may only move the status of a
        // task that is theirs — assigned to them, or on their own checklist.
        const isAdmin = ADMIN_ROLES.includes(req.user?.role);
        if (!isAdmin) {
            const self = await Employee_1.Employee.findOne({ user: req.user?.userId }).select('_id').lean();
            const isOwner = self && String(self._id) === String(task.employee);
            const isAssignee = task.assignedTo && String(task.assignedTo) === String(req.user?.userId);
            if (!isOwner && !isAssignee) throw new errorHandler_1.AppError('You can only update your own tasks', 403, 'FORBIDDEN');
            const allowedKeys = ['status', 'description'];
            const attempted = Object.keys(data).filter((k) => !allowedKeys.includes(k) && data[k] !== undefined);
            if (attempted.length) throw new errorHandler_1.AppError('You may only change the status of this task', 403, 'FORBIDDEN');
        }

        const oldStatus = normaliseStatus(task.status);
        if (data.taskName !== undefined) task.taskName = data.taskName;
        if (data.description !== undefined) task.description = data.description || undefined;
        if (data.category !== undefined) task.category = data.category;
        if (data.isRequired !== undefined) task.isRequired = data.isRequired;
        if (data.order !== undefined) task.order = data.order;
        if (data.assignedTo !== undefined) {
            if (data.assignedTo) (0, helpers_1.assertObjectId)(data.assignedTo, 'assignedTo');
            task.assignedTo = data.assignedTo || undefined;
        }
        if (data.dueDate !== undefined) task.dueDate = data.dueDate ? new Date(data.dueDate) : undefined;
        if (data.status) {
            task.status = data.status;
            if (data.status === 'COMPLETED') {
                task.completedAt = new Date();
                task.completedBy = req.user?.userId;
            } else {
                task.completedAt = undefined;
                task.completedBy = undefined;
            }
        }
        await task.save();

        await auditService_1.auditService.log(req, {
            action: kind === 'offboarding' ? 'OFFBOARDING_TASK_UPDATED' : 'ONBOARDING_TASK_UPDATED',
            module: kind === 'offboarding' ? 'OFFBOARDING' : 'ONBOARDING',
            recordId: id,
            recordLabel: task.taskName,
            oldValue: { status: oldStatus },
            newValue: { status: normaliseStatus(task.status) },
        });
        res.json({ data: { ...task.toObject(), status: normaliseStatus(task.status) } });
    }
    catch (err) { next(err); }
};
exports.updateTask = updateTask;

const deleteTask = (kind) => async (req, res, next) => {
    try {
        const { id } = req.params;
        (0, helpers_1.assertObjectId)(id, 'task id');
        const task = await modelFor(kind).findByIdAndDelete(id);
        if (!task) throw new errorHandler_1.AppError('Task not found', 404, 'NOT_FOUND');
        await auditService_1.auditService.log(req, {
            action: kind === 'offboarding' ? 'OFFBOARDING_TASK_DELETED' : 'ONBOARDING_TASK_DELETED',
            module: kind === 'offboarding' ? 'OFFBOARDING' : 'ONBOARDING',
            recordId: id, recordLabel: task.taskName,
        });
        res.json({ message: 'Task removed' });
    }
    catch (err) { next(err); }
};
exports.deleteTask = deleteTask;

/** Creates the standard checklist, skipping tasks the employee already has. */
async function seedTemplate(kind, employee, anchorDate) {
    const Model = modelFor(kind);
    const existing = await Model.find({ employee: employee._id }).select('taskName').lean();
    const have = new Set(existing.map((t) => t.taskName.toLowerCase()));
    const anchor = anchorDate ? new Date(anchorDate) : new Date();

    const toCreate = exports.TEMPLATES[kind]
        .filter((t) => !have.has(t.taskName.toLowerCase()))
        .map((t, i) => ({
            employee: employee._id,
            taskName: t.taskName,
            description: t.description,
            category: t.category,
            status: 'TODO',
            isRequired: true,
            order: existing.length + i,
            dueDate: new Date(anchor.getTime() + t.offsetDays * 86400000),
        }));
    if (toCreate.length) await Model.insertMany(toCreate);
    return toCreate.length;
}

const applyTemplate = (kind) => async (req, res, next) => {
    try {
        const { employeeId } = req.params;
        (0, helpers_1.assertObjectId)(employeeId, 'employee id');
        const employee = await Employee_1.Employee.findById(employeeId).select('fullName dateOfJoining dateOfExit user').lean();
        if (!employee) throw new errorHandler_1.AppError('Employee not found', 404, 'NOT_FOUND');
        const anchor = kind === 'offboarding' ? (employee.dateOfExit || new Date()) : (employee.dateOfJoining || new Date());
        const created = await seedTemplate(kind, employee, anchor);
        if (created === 0) {
            throw new errorHandler_1.AppError('This employee already has the full standard checklist', 409, 'ALREADY_APPLIED');
        }
        await auditService_1.auditService.log(req, {
            action: kind === 'offboarding' ? 'OFFBOARDING_TEMPLATE_APPLIED' : 'ONBOARDING_TEMPLATE_APPLIED',
            module: kind === 'offboarding' ? 'OFFBOARDING' : 'ONBOARDING',
            recordId: employeeId, recordLabel: employee.fullName, newValue: { created },
        });
        res.status(201).json({ data: { created }, message: `${created} task(s) added` });
    }
    catch (err) { next(err); }
};
exports.applyTemplate = applyTemplate;

/** Records the exit and lays down the offboarding checklist in one step. */
const initiateOffboarding = async (req, res, next) => {
    try {
        const { employeeId } = req.params;
        (0, helpers_1.assertObjectId)(employeeId, 'employee id');
        const schema = zod_1.z.object({
            dateOfExit: zod_1.z.string().min(1, 'Exit date is required'),
            exitReason: zod_1.z.string().min(2, 'Exit reason is required'),
            noticePeriodDays: zod_1.z.coerce.number().int().min(0).max(365).optional(),
        });
        const data = schema.parse(req.body);

        const employee = await Employee_1.Employee.findById(employeeId);
        if (!employee) throw new errorHandler_1.AppError('Employee not found', 404, 'NOT_FOUND');
        if (employee.isArchived) throw new errorHandler_1.AppError('This employee is already archived', 400, 'INVALID_STATUS');

        employee.dateOfExit = new Date(data.dateOfExit);
        employee.exitReason = data.exitReason;
        if (data.noticePeriodDays !== undefined) employee.noticePeriodDays = data.noticePeriodDays;
        employee.status = 'NOTICE_PERIOD';
        await employee.save();

        const created = await seedTemplate('offboarding', employee, employee.dateOfExit);
        if (employee.user) {
            await NotificationAudit_1.Notification.create({
                user: employee.user,
                type: 'OFFBOARDING_STARTED',
                title: 'Offboarding started',
                message: `Your exit formalities have been started. Last working day: ${employee.dateOfExit.toLocaleDateString('en-IN')}.`,
                relatedModel: 'Employee',
                relatedId: employee._id,
            }).catch((err) => console.error('Notification create failed:', err.message));
        }
        await auditService_1.auditService.log(req, {
            action: 'OFFBOARDING_INITIATED', module: 'OFFBOARDING',
            recordId: employeeId, recordLabel: employee.fullName,
            newValue: { dateOfExit: employee.dateOfExit, exitReason: employee.exitReason, tasksCreated: created },
        });
        res.status(201).json({ data: { employee, tasksCreated: created } });
    }
    catch (err) { next(err); }
};
exports.initiateOffboarding = initiateOffboarding;

/** Cross-module clearance snapshot shown on the offboarding detail panel. */
const getOffboardingClearance = async (req, res, next) => {
    try {
        const { employeeId } = req.params;
        (0, helpers_1.assertObjectId)(employeeId, 'employee id');
        const employee = await Employee_1.Employee.findById(employeeId).select('fullName dateOfExit').lean();
        if (!employee) throw new errorHandler_1.AppError('Employee not found', 404, 'NOT_FOUND');

        const exitDate = employee.dateOfExit ? new Date(employee.dateOfExit) : new Date();
        const [assetsOut, docsPending, tasks, finalPayslip] = await Promise.all([
            AssetOnboarding_1.Asset.find({ assignedTo: employeeId, status: 'ASSIGNED' }).select('assetCode name type').lean(),
            Document_1.EmployeeDocument.countDocuments({ employee: employeeId, isArchived: false, status: 'PENDING' }),
            AssetOnboarding_1.OffboardingTask.find({ employee: employeeId }).select('taskName status category').lean(),
            Payroll_1.Payslip.findOne({
                employee: employeeId,
                month: exitDate.getMonth() + 1,
                year: exitDate.getFullYear(),
            }).select('status month year netSalary').lean(),
        ]);

        const normalised = tasks.map((t) => ({ ...t, status: normaliseStatus(t.status) }));
        const byName = (needle) => normalised.find((t) => t.taskName.toLowerCase().includes(needle));
        res.json({
            data: {
                employee,
                assetsOutstanding: assetsOut,
                documentsPending: docsPending,
                finalPayroll: finalPayslip
                    ? { status: finalPayslip.status, month: finalPayslip.month, year: finalPayslip.year, netSalary: finalPayslip.netSalary }
                    : null,
                exitInterview: byName('exit interview')?.status || 'TODO',
                clearances: {
                    hr: byName('hr clearance')?.status || 'TODO',
                    it: byName('it clearance')?.status || 'TODO',
                    finance: byName('finance clearance')?.status || 'TODO',
                    assets: assetsOut.length === 0 ? 'COMPLETED' : (byName('asset return')?.status || 'TODO'),
                },
                progress: progressOf(normalised),
            },
        });
    }
    catch (err) { next(err); }
};
exports.getOffboardingClearance = getOffboardingClearance;
