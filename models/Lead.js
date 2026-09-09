"use strict";
const mongoose = require("mongoose");

/**
 * Lead — a sales contact imported via CSV or Excel.
 * Uploaded by FOUNDER_CEO, CTO, or PROJECT_HEAD.
 * Leads are distributed equally across all active EMPLOYEE-role users
 * in the Sales department (sales team). Each lead is assigned to one
 * sales team member via `assignedTo`.
 */
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
    uploadBatch: { type: String }, // ISO timestamp of the upload session
    // Which sales team member this lead is assigned to
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
  },
  { timestamps: true }
);

leadSchema.index({ status: 1 });
leadSchema.index({ uploadBatch: 1 });
leadSchema.index({ email: 1 });
leadSchema.index({ assignedTo: 1 });

exports.Lead = mongoose.model("Lead", leadSchema);
