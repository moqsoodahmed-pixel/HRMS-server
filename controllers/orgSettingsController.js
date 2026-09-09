"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSettings = exports.getSettings = void 0;
const { OrgSettings } = require("../models/OrgSettings");
const { AppError } = require("../middleware/errorHandler");
const { auditService } = require("../services/auditService");
const { isElevated } = require("../utils/roles");
const { z } = require("zod");

/** See models/OrgSettings.js for exactly which fields are real vs. deliberately absent. */

async function getOrCreateSettings() {
    let settings = await OrgSettings.findOne({ singletonKey: 'default' });
    if (!settings) settings = await OrgSettings.create({ singletonKey: 'default' });
    return settings;
}
exports.getOrCreateSettings = getOrCreateSettings;

const getSettings = async (req, res, next) => {
    try {
        const settings = await getOrCreateSettings();
        res.json({ data: settings });
    }
    catch (err) { next(err); }
};
exports.getSettings = getSettings;

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:mm').optional().or(z.literal(''));

const updateSchema = z.object({
    organization: z.object({
        companyName: z.string().max(160).optional().or(z.literal('')),
        contactEmail: z.string().email().optional().or(z.literal('')),
        contactPhone: z.string().max(30).optional().or(z.literal('')),
        address: z.string().max(300).optional().or(z.literal('')),
    }).optional(),
    attendance: z.object({
        workStartTime: timeSchema,
        workEndTime: timeSchema,
        lateThresholdMinutes: z.union([z.number(), z.string().transform((v) => (v === '' ? undefined : Number(v)))]).optional(),
    }).optional(),
    exit: z.object({
        defaultNoticePeriodDays: z.union([z.number(), z.string().transform((v) => (v === '' ? undefined : Number(v)))]).optional(),
    }).optional(),
    /**
     * Telegram notification settings.
     * botToken is write-only from the UI — it is never returned in GET /settings
     * (the model uses `select: false`) to avoid leaking the secret.
     */
    telegram: z.object({
        enabled: z.boolean().optional(),
        botToken: z.string().max(200).optional().or(z.literal('')),
        notifyChatId: z.string().max(100).optional().or(z.literal('')),
        notifyClockOut: z.boolean().optional(),
    }).optional(),
});

/** Elevated roles only (FOUNDER_CEO/CTO/SUPER_ADMIN) — not even HR_ADMIN. */
const updateSettings = async (req, res, next) => {
    try {
        if (!isElevated(req.user?.role)) {
            throw new AppError('Only an organization owner/administrator can change settings', 403, 'FORBIDDEN');
        }
        const data = updateSchema.parse(req.body);
        const settings = await getOrCreateSettings();
        if (data.organization) Object.assign(settings.organization = settings.organization || {}, data.organization);
        if (data.attendance) Object.assign(settings.attendance = settings.attendance || {}, data.attendance);
        if (data.exit) Object.assign(settings.exit = settings.exit || {}, data.exit);
        if (data.telegram) {
            settings.telegram = settings.telegram || {};
            // Only update botToken if a non-empty value was explicitly provided
            const { botToken, ...otherTelegram } = data.telegram;
            Object.assign(settings.telegram, otherTelegram);
            if (botToken) settings.telegram.botToken = botToken;
        }
        settings.updatedBy = req.user.userId;
        settings.markModified('telegram');
        await settings.save();

        await auditService.log(req, {
            action: 'ORG_SETTINGS_UPDATED',
            module: 'SETTINGS',
            // Strip botToken from audit log to avoid leaking secret
            newValue: { ...data, telegram: data.telegram ? { ...data.telegram, botToken: data.telegram.botToken ? '***' : undefined } : undefined },
        });

        // Return settings but exclude botToken from response
        const result = settings.toObject();
        if (result.telegram) delete result.telegram.botToken;
        res.json({ data: result });
    }
    catch (err) { next(err); }
};
exports.updateSettings = updateSettings;

/**
 * POST /api/settings/telegram/test
 * Sends a test message to verify bot token + chat ID are correct.
 * Elevated roles only.
 */
const { sendMessage } = require("../services/telegramService");

const testTelegramNotification = async (req, res, next) => {
    try {
        if (!isElevated(req.user?.role)) {
            throw new AppError('Only an organization owner/administrator can test Telegram', 403, 'FORBIDDEN');
        }
        await sendMessage(
            '✅ <b>Telegram integration is working!</b>\n\nYour HRMS will now send employee clock-in/out alerts to this chat.'
        );
        res.json({ data: { sent: true, message: 'Test notification sent successfully.' } });
    }
    catch (err) { next(err); }
};
exports.testTelegramNotification = testTelegramNotification;