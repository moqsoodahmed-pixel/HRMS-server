"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrgSettings = void 0;
const mongoose = require("mongoose");

const orgSettingsSchema = new mongoose.Schema({
    singletonKey: { type: String, default: 'default', unique: true },
    organization: {
        companyName: { type: String },
        contactEmail: { type: String },
        contactPhone: { type: String },
        address: { type: String },
    },
    attendance: {
        workStartTime: { type: String },
        workEndTime: { type: String },
        lateThresholdMinutes: { type: Number },
    },
    exit: {
        defaultNoticePeriodDays: { type: Number },
    },
    telegram: {
        enabled: { type: Boolean, default: false },
        botToken: { type: String, select: false },
        notifyChatId: { type: String },
        notifyClockOut: { type: Boolean, default: false },
    },
    // Lead management settings
    leads: {
        batchSize: { type: Number, default: 50, min: 1, max: 500 },
    },
    // Daily report settings
    dailyReport: {
        submissionDeadlineTime: { type: String, default: '18:00' }, // HH:mm
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

exports.OrgSettings = mongoose.model('OrgSettings', orgSettingsSchema);