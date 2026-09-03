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
};
//# sourceMappingURL=emailService.js.map