"use strict";
const mongoose = require("mongoose");

const appointmentLetterSchema = new mongoose.Schema({
  employee:                    { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  version:                     { type: Number, default: 1 },
  status:                      { type: String, enum: ["DRAFT","GENERATED","ISSUED"], default: "DRAFT" },
  // Letter header
  dateOfIssue:                 { type: String },
  offerLetterDate:             { type: String },
  offerLetterJoiningDate:      { type: String },
  // Employee
  employeeCode:                { type: String },
  employeeFullName:            { type: String },
  employeeFirstName:           { type: String },
  designation:                 { type: String },
  joiningDate:                 { type: String },
  workLocation:                { type: String },
  reportingManager:            { type: String },
  // Compensation
  compensation:                { type: String },
  compensationWords:           { type: String },
  incentivePercent:            { type: String, default: "15" },
  // Duties (role-specific, editable list)
  duties:                      [{ type: String }],
  // Company
  registeredCompanyName:       { type: String, default: "DutyLaunch Solutions Private Limited" },
  // Signatory
  authorizedSignatoryName:     { type: String, default: "Moqsood Ahmed" },
  authorizedSignatoryDesignation: { type: String, default: "Founder and CEO" },
  // Metadata
  generatedAt:   { type: Date },
  generatedBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  pdfPath:       { type: String },
}, { timestamps: true });

appointmentLetterSchema.index({ employee: 1 });
appointmentLetterSchema.index({ status: 1 });

exports.AppointmentLetter = mongoose.model("AppointmentLetter", appointmentLetterSchema);