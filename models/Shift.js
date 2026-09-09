"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Shift = void 0;
const mongoose = require("mongoose");

/**
 * Minimal named work-shift (e.g. "General", "Night") an employee can be
 * assigned to. Did not exist before this step — attendance previously used a
 * single global work-hours window (WORK_START_HOUR/WORK_END_HOUR env vars),
 * which stays as the fallback for any employee with no shift assigned (see
 * attendanceController.js workStartFor/workEndFor).
 */
const shiftSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true },
    startTime: { type: String, required: true }, // "HH:mm"
    endTime: { type: String, required: true }, // "HH:mm"
    isActive: { type: Boolean, default: true },
}, { timestamps: true });

exports.Shift = mongoose.model('Shift', shiftSchema);
