"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExitRequest = void 0;
const mongoose = require("mongoose");

/**
 * Employee-initiated exit/resignation request — did not exist before this
 * step. The existing Offboarding module (taskController.js initiateOffboarding
 * + OffboardingTask checklist) is HR-initiated only; this adds the missing
 * employee-facing "request to leave" half of the workflow, and its approval
 * path re-uses that exact existing initiation logic (see
 * exitRequestController.approveExitRequest calling taskController.seedTemplate)
 * rather than duplicating it.
 */
const exitRequestSchema = new mongoose.Schema({
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true },
    requestedLastWorkingDate: { type: Date, required: true },
    // Snapshotted from Employee.noticePeriodDays at request time — the
    // existing per-employee notice-period field is the only notice-period
    // configuration in this codebase; there is no separate org-wide setting.
    noticePeriodDays: { type: Number },
    comments: { type: String },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED'], default: 'PENDING', index: true },
    rejectionReason: { type: String },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    completedAt: { type: Date },
}, { timestamps: true });

exports.ExitRequest = mongoose.model('ExitRequest', exitRequestSchema);
