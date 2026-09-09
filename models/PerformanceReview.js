"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PerformanceReview = void 0;
const mongoose = require("mongoose");

/**
 * Performance review — the page was empty before this step; this is the
 * first real backend model. `department`/`designation` are snapshotted at
 * creation time (not just populated from Employee) so a historical review
 * still reads correctly even if the employee later transfers departments.
 * `overallRating` is always derived from `criteria[].rating` server-side
 * (see performanceController.recomputeOverallRating) — never accepted
 * directly from the client.
 */
const criterionSchema = new mongoose.Schema({
    category: { type: String, required: true, trim: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    comments: { type: String },
}, { _id: false });

const performanceReviewSchema = new mongoose.Schema({
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    department: { type: String, required: true },
    designation: { type: String },
    reviewPeriod: { type: String, required: true }, // e.g. "Q1 2025", "Annual 2025"
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    criteria: { type: [criterionSchema], default: [] },
    overallRating: { type: Number, min: 0, max: 5 },
    overallComments: { type: String },
    status: { type: String, enum: ['DRAFT', 'SUBMITTED', 'COMPLETED'], default: 'DRAFT', index: true },
    submittedAt: { type: Date },
    completedAt: { type: Date },
}, { timestamps: true });

exports.PerformanceReview = mongoose.model('PerformanceReview', performanceReviewSchema);
