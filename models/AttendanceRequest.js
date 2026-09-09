"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttendanceRequest = void 0;
const mongoose = require("mongoose");

/**
 * Minimal employee-submitted attendance workflow — did not exist before this
 * step (previously HR edited Attendance directly via attendanceController's
 * updateAttendance/markAttendance, with no request/approval trail from the
 * employee side). Covers two request shapes under one collection:
 *   - CORRECTION: employee proposes a status/check-in/check-out fix for a
 *     given day (e.g. forgot to check out).
 *   - UNLOCK: employee asks HR to reopen an already-finalised day so it can
 *     be corrected at all (no separate "locking" mechanism exists elsewhere
 *     in Attendance; this request type is the whole of what "unlock" means
 *     here — HR reviewing and, if they agree, editing the record via the
 *     existing updateAttendance endpoint).
 * Approval never mutates Attendance automatically for UNLOCK requests (HR
 * still edits by hand afterwards, through the existing, audited
 * updateAttendance path) — only CORRECTION approval writes to Attendance,
 * and it does so through the exact same Attendance model, not a parallel one.
 */
const attendanceRequestSchema = new mongoose.Schema({
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['CORRECTION', 'UNLOCK'], required: true },
    date: { type: Date, required: true },
    reason: { type: String, required: true },
    // Only meaningful for CORRECTION — "HH:mm" strings, applied to `date` on approval.
    requestedCheckIn: { type: String },
    requestedCheckOut: { type: String },
    requestedStatus: {
        type: String,
        enum: ['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'WORK_FROM_HOME', 'ON_LEAVE'],
    },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING', index: true },
    rejectionReason: { type: String },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
}, { timestamps: true });

exports.AttendanceRequest = mongoose.model('AttendanceRequest', attendanceRequestSchema);
