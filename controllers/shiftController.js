"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignShift = exports.updateShift = exports.createShift = exports.listShifts = void 0;
const { Shift } = require("../models/Shift");
const { Employee } = require("../models/Employee");
const { AppError } = require("../middleware/errorHandler");
const { auditService } = require("../services/auditService");
const { z } = require("zod");

/** Minimal shift management — see models/Shift.js for why this exists. */

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:mm');
const shiftSchema = z.object({
    name: z.string().min(1, 'Name is required').max(60),
    startTime: timeSchema,
    endTime: timeSchema,
    isActive: z.boolean().optional(),
});

const listShifts = async (req, res, next) => {
    try {
        const filter = req.query.includeInactive === 'true' ? {} : { isActive: true };
        const shifts = await Shift.find(filter).sort({ name: 1 }).lean();
        res.json({ data: shifts });
    }
    catch (err) { next(err); }
};
exports.listShifts = listShifts;

const createShift = async (req, res, next) => {
    try {
        const data = shiftSchema.parse(req.body);
        const shift = await Shift.create(data);
        await auditService.log(req, { action: 'SHIFT_CREATED', module: 'ATTENDANCE', recordId: String(shift._id), recordLabel: shift.name });
        res.status(201).json({ data: shift });
    }
    catch (err) { next(err); }
};
exports.createShift = createShift;

const updateShift = async (req, res, next) => {
    try {
        const { id } = req.params;
        const data = shiftSchema.partial().parse(req.body);
        const shift = await Shift.findByIdAndUpdate(id, data, { new: true, runValidators: true });
        if (!shift) throw new AppError('Shift not found', 404, 'NOT_FOUND');
        await auditService.log(req, { action: 'SHIFT_UPDATED', module: 'ATTENDANCE', recordId: id, recordLabel: shift.name, newValue: data });
        res.json({ data: shift });
    }
    catch (err) { next(err); }
};
exports.updateShift = updateShift;

/** Assigns (or clears, with shiftId=null) an employee's shift. */
const assignShift = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { shiftId } = req.body;
        const employee = await Employee.findById(id);
        if (!employee) throw new AppError('Employee not found', 404, 'NOT_FOUND');
        if (shiftId) {
            const shift = await Shift.findById(shiftId);
            if (!shift) throw new AppError('Shift not found', 404, 'NOT_FOUND');
        }
        employee.shift = shiftId || undefined;
        await employee.save();
        await auditService.log(req, {
            action: 'SHIFT_ASSIGNED', module: 'ATTENDANCE',
            recordId: id, recordLabel: employee.fullName, newValue: { shiftId: shiftId || null },
        });
        const populated = await Employee.findById(id).select('fullName employeeCode shift').populate('shift', 'name startTime endTime');
        res.json({ data: populated });
    }
    catch (err) { next(err); }
};
exports.assignShift = assignShift;
