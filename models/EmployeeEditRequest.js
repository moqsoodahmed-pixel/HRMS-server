"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmployeeEditRequest = void 0;
const mongoose = require("mongoose");

/**
 * Minimal "employee profile edit request" model — did not exist before this
 * step. An employee proposes a change to a small set of self-service fields
 * (see ALLOWED_FIELDS in employeeEditRequestController.js); the change is
 * only ever applied to Employee once HR/Admin approves it (approveEditRequest).
 * Kept as its own collection rather than mutating Employee directly so the
 * request/approval/audit trail is preserved regardless of the outcome.
 */
const employeeEditRequestSchema = new mongoose.Schema({
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // { fieldName: newValue } — restricted to ALLOWED_FIELDS by the controller, never trusted as-is.
    changes: { type: mongoose.Schema.Types.Mixed, required: true },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING', index: true },
    rejectionReason: { type: String },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
}, { timestamps: true });

exports.EmployeeEditRequest = mongoose.model('EmployeeEditRequest', employeeEditRequestSchema);
