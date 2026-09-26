"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailService = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const transporter = nodemailer_1.default.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD || process.env.SMTP_PASS,
    },
});
const SMTP_CONFIGURED = Boolean(process.env.SMTP_USER && (process.env.SMTP_PASSWORD || process.env.SMTP_PASS));
/**
 * Sends a mail, or logs and resolves when SMTP is not configured. Outbound mail is a
 * convenience here — a missing SMTP setup must never fail the request that triggered it.
 */
async function send(options) {
    if (!SMTP_CONFIGURED) {
        console.warn(`[email] SMTP is not configured — skipped "${options.subject}" to ${options.to}`);
        return { skipped: true };
    }
    try {
        return await transporter.sendMail(options);
    }
    catch (err) {
        console.error('[email] send failed:', err.message);
        return { failed: true, error: err.message };
    }
}

/**
 * A second, completely separate SMTP connection used only for the leave-
 * request approver alert (see sendLeaveRequestAlert below) — deliberately
 * not sharing the SMTP_HOST/SMTP_USER/EMAIL_FROM variables above, which
 * stay pointed at whatever was already configured and already sending
 * password-reset/welcome/payslip mail. This lets the leave-request emails
 * go out through a different provider (e.g. Brevo) without touching that
 * existing setup. Uses its own LEAVE_SMTP_HOST/LEAVE_SMTP_PORT/
 * LEAVE_SMTP_SECURE/LEAVE_SMTP_USER/LEAVE_SMTP_PASSWORD/LEAVE_EMAIL_FROM
 * variables so the two never collide in Railway (or any other host) — set
 * these to your Brevo SMTP credentials, distinct from the SMTP_ ones.
 */
const leaveTransporter = nodemailer_1.default.createTransport({
    host: process.env.LEAVE_SMTP_HOST,
    port: parseInt(process.env.LEAVE_SMTP_PORT || '587'),
    secure: process.env.LEAVE_SMTP_SECURE === 'true',
    auth: {
        user: process.env.LEAVE_SMTP_USER,
        pass: process.env.LEAVE_SMTP_PASSWORD,
    },
});
const LEAVE_SMTP_CONFIGURED = Boolean(process.env.LEAVE_SMTP_HOST && process.env.LEAVE_SMTP_USER && process.env.LEAVE_SMTP_PASSWORD);
async function sendViaLeaveProvider(options) {
    if (!LEAVE_SMTP_CONFIGURED) {
        console.warn(`[email:leave] LEAVE_SMTP is not configured — skipped "${options.subject}" to ${options.to}`);
        return { skipped: true };
    }
    try {
        return await leaveTransporter.sendMail(options);
    }
    catch (err) {
        console.error('[email:leave] send failed:', err.message);
        return { failed: true, error: err.message };
    }
}
exports.emailService = {
    async sendPasswordReset(email, token, name) {
        const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${token}`;
        await send({
            from: process.env.EMAIL_FROM || 'DutyLaunch HRMS <noreply@dutylaunch.com>',
            to: email,
            subject: 'Password Reset Request - DutyLaunch HRMS',
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1e40af;">DutyLaunch HRMS</h2>
          <p>Hi ${name},</p>
          <p>You requested a password reset. Click the button below to reset your password:</p>
          <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #1e40af; color: white; text-decoration: none; border-radius: 4px; margin: 16px 0;">Reset Password</a>
          <p>This link expires in 1 hour.</p>
          <p>If you did not request this, please ignore this email.</p>
          <hr/>
          <small style="color: #6b7280;">DutyLaunch Solutions Private Limited</small>
        </div>
      `,
        });
    },
    async sendWelcome(email, name, tempPassword) {
        await send({
            from: process.env.EMAIL_FROM || 'DutyLaunch HRMS <noreply@dutylaunch.com>',
            to: email,
            subject: 'Welcome to DutyLaunch HRMS',
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1e40af;">Welcome to DutyLaunch HRMS</h2>
          <p>Hi ${name},</p>
          <p>Your account has been created. Please use the following credentials:</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Temporary Password:</strong> ${tempPassword}</p>
          <p>Please change your password after first login.</p>
          <a href="${process.env.CLIENT_URL}/login" style="display: inline-block; padding: 12px 24px; background: #1e40af; color: white; text-decoration: none; border-radius: 4px;">Login Now</a>
          <hr/>
          <small style="color: #6b7280;">DutyLaunch Solutions Private Limited</small>
        </div>
      `,
        });
    },
    async sendPayslip(email, name, month, year) {
        await send({
            from: process.env.EMAIL_FROM || 'DutyLaunch HRMS <noreply@dutylaunch.com>',
            to: email,
            subject: `Payslip for ${month} ${year} - DutyLaunch HRMS`,
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1e40af;">DutyLaunch HRMS</h2>
          <p>Hi ${name},</p>
          <p>Your payslip for ${month} ${year} has been generated. Please login to the portal to view and download it.</p>
          <a href="${process.env.CLIENT_URL}/portal/payslips" style="display: inline-block; padding: 12px 24px; background: #1e40af; color: white; text-decoration: none; border-radius: 4px;">View Payslip</a>
        </div>
      `,
        });
    },
    /**
     * Notifies one approver (CTO / CEO / Project Head — see
     * utils/roles.js LEAVE_EMAIL_NOTIFY_ROLES) that a new leave request needs
     * review. Called once per recipient from leaveController.createLeaveRequest
     * right after the request is saved; a delivery failure is swallowed by
     * sendViaLeaveProvider() above and never blocks the employee's request
     * from succeeding. Deliberately sent through the separate
     * leaveTransporter (the LEAVE_SMTP_ and LEAVE_EMAIL_FROM variables)
     * rather than send() and the plain SMTP_ variables, so this one email
     * type can run on its own provider (Brevo) without touching whatever
     * the rest of the app's emails already use.
     */
    async sendLeaveRequestAlert(email, recipientName, details) {
        const {
            employeeName, employeeCode, department, leaveType, subType,
            startDate, endDate, totalDays, reason,
        } = details;
        const dateRange = startDate === endDate ? startDate : `${startDate} to ${endDate}`;
        const reviewUrl = `${process.env.CLIENT_URL}/leave`;
        await sendViaLeaveProvider({
            from: process.env.LEAVE_EMAIL_FROM || 'DutyLaunch HRMS <noreply@dutylaunch.com>',
            to: email,
            subject: `New leave request from ${employeeName} — action needed`,
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1e40af;">DutyLaunch HRMS</h2>
          <p>Hi ${recipientName},</p>
          <p><strong>${employeeName}</strong>${employeeCode ? ` (${employeeCode})` : ''}${department ? ` from ${department}` : ''} has requested leave and it is awaiting review.</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 6px 0; color: #6b7280;">Leave type</td><td style="padding: 6px 0;"><strong>${leaveType}${subType ? ` (${subType})` : ''}</strong></td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280;">Dates</td><td style="padding: 6px 0;"><strong>${dateRange}</strong></td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280;">Duration</td><td style="padding: 6px 0;"><strong>${totalDays} day(s)</strong></td></tr>
            ${reason ? `<tr><td style="padding: 6px 0; color: #6b7280; vertical-align: top;">Reason</td><td style="padding: 6px 0;">${reason}</td></tr>` : ''}
          </table>
          <a href="${reviewUrl}" style="display: inline-block; padding: 12px 24px; background: #1e40af; color: white; text-decoration: none; border-radius: 4px;">Review request</a>
          <hr/>
          <small style="color: #6b7280;">DutyLaunch Solutions Private Limited</small>
        </div>
      `,
        });
    },
};
//# sourceMappingURL=emailService.js.map