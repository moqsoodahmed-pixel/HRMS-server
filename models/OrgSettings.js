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
        breakDurationMinutes: { type: Number, default: 60 }, // 1-hour lunch break deducted from gross hours
    },
    exit: {
        defaultNoticePeriodDays: { type: Number },
    },
    telegram: {
        // Default ON: when Telegram creds come from env, an auto-created settings
        // doc must not silently disable clock-in/out alerts. Admins can still turn
        // this off explicitly from the Settings UI.
        enabled: { type: Boolean, default: true },
        botToken: { type: String, select: false },
        notifyChatId: { type: String },
        notifyClockOut: { type: Boolean, default: true },
    },
    // Dedicated bot for Daily Report submissions — same shape as `telegram`
    // above, kept separate on purpose (different bot/group entirely).
    dailyReportTelegram: {
        enabled: { type: Boolean, default: true },
        botToken: { type: String, select: false },
        notifyChatId: { type: String },
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