"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrgSettings = void 0;
const mongoose = require("mongoose");

/**
 * Single-document ("singleton") organization configuration — did not exist
 * before this step (there was previously no organization/tenant model at
 * all, per Step 2/3's dashboard "workspace" investigation). Only fields with
 * a real, wired effect on the application belong here:
 *   - organization.*   — display-only info shown around the app (e.g. the
 *                        dashboard workspace bar); no calculation depends on it.
 *   - attendance.*     — read by attendanceController.getWorkWindow() as the
 *                        live source of the work-hours window, falling back
 *                        to the original WORK_START_HOUR/... env vars when
 *                        unset, so existing deployments keep working unchanged.
 *   - exit.*           — defaultNoticePeriodDays is only ever a suggested
 *                        default; the authoritative value stays
 *                        Employee.noticePeriodDays (see ExitRequest.js).
 * Leave/Payroll/Security are deliberately NOT modelled here — those are
 * fully owned by existing modules (LeaveType, the XYZ payroll integration,
 * and the hardcoded auth lockout policy respectively) and are only ever
 * displayed, never duplicated, on the Settings page.
 */
const orgSettingsSchema = new mongoose.Schema({
    singletonKey: { type: String, default: 'default', unique: true },
    organization: {
        companyName: { type: String },
        contactEmail: { type: String },
        contactPhone: { type: String },
        address: { type: String },
    },
    attendance: {
        workStartTime: { type: String }, // "HH:mm"
        workEndTime: { type: String },
        lateThresholdMinutes: { type: Number },
    },
    exit: {
        defaultNoticePeriodDays: { type: Number },
    },
    /**
     * Telegram notification settings.
     *   enabled       – master on/off switch (default true)
     *   botToken      – Telegram Bot token (from @BotFather); overrides TELEGRAM_BOT_TOKEN env var
     *   notifyChatId  – Founder/CEO's Telegram chat ID where clock-in/out alerts are sent
     *   notifyClockOut – also send clock-out notifications (default false)
     */
    telegram: {
        enabled: { type: Boolean, default: false },
        botToken: { type: String, select: false },   // treated like a secret; excluded by default
        notifyChatId: { type: String },
        notifyClockOut: { type: Boolean, default: false },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

exports.OrgSettings = mongoose.model('OrgSettings', orgSettingsSchema);