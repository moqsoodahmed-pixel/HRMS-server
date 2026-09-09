"use strict";
const mongoose = require("mongoose");

const dailyReportSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    date: { type: Date, required: true },
    status: {
      type: String,
      enum: ["DRAFT", "SUBMITTED", "REVIEWED", "NEEDS_REVISION"],
      default: "DRAFT",
    },
    workSummary: { type: String, trim: true },
    tasksCompleted: { type: String, trim: true },
    tasksInProgress: { type: String, trim: true },
    blockers: { type: String, trim: true },
    nextDayPlan: { type: String, trim: true },
    additionalNotes: { type: String, trim: true },
    hoursWorked: { type: Number, min: 0, max: 24 },
    submittedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    reviewerComments: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

// Compound index: one report per employee per date
dailyReportSchema.index({ employee: 1, date: 1 }, { unique: true });
dailyReportSchema.index({ status: 1 });
dailyReportSchema.index({ date: -1 });
dailyReportSchema.index({ employee: 1, date: -1 });

exports.DailyReport = mongoose.model("DailyReport", dailyReportSchema);