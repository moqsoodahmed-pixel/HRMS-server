"use strict";
const mongoose = require("mongoose");

/**
 * Lead — a sales contact imported via CSV or Excel.
 * Extended with: statusHistory, assignedAt, lastContactedAt,
 * statusUpdatedAt/By, assignmentRound, reassignmentHistory, uploadBatchId.
 */
const statusHistorySchema = new mongoose.Schema({
  previousStatus: { type: String },
  newStatus: { type: String, required: true },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  changedAt: { type: Date, default: Date.now },
  notes: { type: String },
}, { _id: false });

const reassignmentSchema = new mongoose.Schema({
  fromEmployee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  toEmployee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  changedAt: { type: Date, default: Date.now },
  reason: { type: String },
}, { _id: false });

const leadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    company: { type: String, trim: true },
    status: {
      type: String,
      enum: ["NEW", "CONTACTED", "INTERESTED", "NOT_INTERESTED", "CONVERTED", "LOST"],
      default: "NEW",
    },
    notes: { type: String, trim: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    uploadBatch: { type: String }, // human-readable batch ID e.g. UPLOAD-2026-09-09-001
    uploadBatchTimestamp: { type: String }, // ISO timestamp for internal use
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    assignedAt: { type: Date },
    lastContactedAt: { type: Date },
    statusUpdatedAt: { type: Date },
    statusUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignmentRound: { type: Number },
    assignmentBatchSize: { type: Number },
    // History
    statusHistory: [statusHistorySchema],
    reassignmentHistory: [reassignmentSchema],
    // Batch metadata stored per lead for audit
    totalInBatch: { type: Number },
    validInBatch: { type: Number },
    skippedInBatch: { type: Number },
  },
  { timestamps: true }
);

leadSchema.index({ status: 1 });
leadSchema.index({ uploadBatch: 1 });
leadSchema.index({ email: 1 });
leadSchema.index({ assignedTo: 1 });
leadSchema.index({ assignedTo: 1, status: 1 });
leadSchema.index({ uploadBatch: 1, createdAt: -1 });

exports.Lead = mongoose.model("Lead", leadSchema);