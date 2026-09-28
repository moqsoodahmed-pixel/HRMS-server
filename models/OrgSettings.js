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
    // Mobile-device restriction + office geo-fencing login policy (see
    // services/accessControlService.js, wired into controllers/authController.js
    // login()). Disabled by default so a deployment that never configures this
    // section behaves exactly as before — nobody is restricted until an admin
    // explicitly turns it on and sets real office coordinates. All values live
    // here (not hardcoded) so they're editable from Settings without a
    // code/deploy change, per the feature's "Configuration" requirement.
    security: {
        mobileRestrictionEnabled: { type: Boolean, default: false },
        geoRestrictionEnabled: { type: Boolean, default: false },
        officeLatitude: { type: Number },
        officeLongitude: { type: Number },
        // Meters. 25m default per spec; configurable, never hardcoded downstream.
        allowedRadiusMeters: { type: Number, default: 25 },
        // Optional alternate/corroborating proof of office presence, checked
        // before the GPS/Wi-Fi position check (see accessControlService.js's
        // "Office IP allowlist" comment for the full reasoning — in short,
        // network-based geolocation can misreport an office's position by
        // kilometers when its Wi-Fi access points aren't in the browser's
        // location database, which no amount of coordinate-radius tolerance
        // can fix). Each entry is the office's known public IP address, or
        // an IPv4 CIDR range (e.g. "203.0.113.0/24"). Empty by default — a
        // no-op until an admin fills it in.
        officeIpAllowlist: { type: [String], default: [] },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

exports.OrgSettings = mongoose.model('OrgSettings', orgSettingsSchema);