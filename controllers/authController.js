"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.changePassword = exports.resetPassword = exports.forgotPassword = exports.getMe = exports.logout = exports.login = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const User_1 = require("../models/User");
const Employee_1 = require("../models/Employee");
const auditService_1 = require("../services/auditService");
const emailService_1 = require("../services/emailService");
const errorHandler_1 = require("../middleware/errorHandler");
const cookieConfig_1 = require("../utils/cookieConfig");
const zod_1 = require("zod");
const { getOrCreateSettings } = require("./orgSettingsController");
const { evaluateLoginAccess } = require("../services/accessControlService");
const { classifyDevice } = require("../utils/deviceDetection");
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(1),
    rememberMe: zod_1.z.boolean().optional(),
    // Optional browser Geolocation API result, sent by the login form when
    // permission is granted (see HRMS-client/src/pages/Login.jsx). Absent
    // entirely when geolocation isn't available/permitted/attempted — that
    // is itself meaningful (see accessControlService "Location Permission
    // Denied") and is never invented/defaulted here.
    location: zod_1.z.object({
        latitude: zod_1.z.number(),
        longitude: zod_1.z.number(),
        accuracy: zod_1.z.number().optional(),
    }).optional().nullable(),
});
const forgotSchema = zod_1.z.object({ email: zod_1.z.string().email() });
const resetSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    otp: zod_1.z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
    password: zod_1.z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, 'Password must contain uppercase, lowercase, number, and special character'),
});
// A wrong code is allowed this many guesses before it's locked out and a
// fresh one has to be requested — keeps a 6-digit code from being brute-forced.
const MAX_OTP_ATTEMPTS = 5;
const changeSchema = zod_1.z.object({
    currentPassword: zod_1.z.string(),
    newPassword: zod_1.z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, 'Password must contain uppercase, lowercase, number, and special character'),
});
const login = async (req, res, next) => {
    try {
        const { email, password, rememberMe, location } = loginSchema.parse(req.body);
        const user = await User_1.User.findOne({ email: email.toLowerCase() })
            .select('+password');
        if (!user) {
            await auditService_1.auditService.log(req, { action: 'LOGIN_FAILED', module: 'AUTH', recordLabel: email });
            res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
            return;
        }
        // Check if locked. `lockReason`/`lockedBy` set (see models/User.js)
        // means an HR/CTO/PROJECT_HEAD/FOUNDER_CEO-tier admin locked this
        // account deliberately (controllers/accountAccessController.js)
        // rather than the 5-failed-attempts auto-lock below — the message
        // stays generic either way (no account-state details to an
        // unauthenticated caller), but the audit trail still distinguishes
        // the two so admins reviewing locked accounts can tell them apart.
        if (user.lockedUntil && user.lockedUntil > new Date()) {
            await auditService_1.auditService.log(req, {
                action: 'LOGIN_FAILED_LOCKED', module: 'AUTH', recordId: user._id.toString(), recordLabel: email,
                newValue: { manuallyLocked: Boolean(user.lockReason || user.lockedBy) },
            });
            res.status(401).json({ error: { code: 'ACCOUNT_LOCKED', message: 'Account temporarily locked. Try again later.' } });
            return;
        }
        if (!user.isActive) {
            res.status(403).json({ error: { code: 'ACCOUNT_INACTIVE', message: 'Your account has been deactivated' } });
            return;
        }
        const isValid = await bcryptjs_1.default.compare(password, user.password);
        if (!isValid) {
            user.failedLoginAttempts += 1;
            if (user.failedLoginAttempts >= 5) {
                user.lockedUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 min
            }
            await user.save();
            await auditService_1.auditService.log(req, { action: 'LOGIN_FAILED', module: 'AUTH', recordId: user._id.toString(), recordLabel: email });
            res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
            return;
        }
        // Password is correct at this point. Fetch the linked Employee (if
        // any) once here — reused both for the device/location/ABAC check
        // below and for the response payload further down, replacing what
        // was previously a second, separate query for the same document.
        const employee = user.employee ? await Employee_1.Employee.findById(user.employee).select('fullName employeeCode designation department officialEmail employmentType status noticePeriodDays profilePhoto onboardingStatus onboardingStep onboardingRejectionReason') : null;

        // ── Mobile Device Restriction / Geo-Fencing (ABAC) ──────────────────
        // Runs AFTER password verification (so a wrong password never leaks
        // device/location policy to an unauthenticated caller) and BEFORE any
        // session/token is created or "successful login" bookkeeping happens
        // — a denial here must leave zero trace of a completed authentication.
        // See services/accessControlService.js for the full rule set (PARTS 1-4).
        const settingsDoc = await getOrCreateSettings();
        const access = await evaluateLoginAccess({ role: user.role, employee, req, location: location || null, settings: settingsDoc.security });
        if (!access.allowed) {
            const device = classifyDevice(req);
            await auditService_1.auditService.log(req, {
                action: 'LOGIN_DENIED',
                module: 'AUTH',
                recordId: user._id.toString(),
                recordLabel: email,
                newValue: {
                    reason: access.reason,
                    code: access.code,
                    deviceType: device?.deviceType,
                    browser: device?.browser,
                    os: device?.os,
                    ip: req.ip || req.socket?.remoteAddress,
                    latitude: access.details?.latitude ?? null,
                    longitude: access.details?.longitude ?? null,
                    ...access.details,
                },
            });
            res.status(403).json({ error: { code: access.code, message: access.message } });
            return;
        }

        // Reset failed attempts
        user.failedLoginAttempts = 0;
        user.lockedUntil = undefined;
        user.lockReason = undefined;
        user.lockedBy = undefined;
        user.lastLogin = new Date();
        user.lastLoginIp = req.ip;
        user.lastLoginUserAgent = req.headers['user-agent'];
        await user.save();
        const { session, remember } = (0, cookieConfig_1.resolveSessionDurations)();
        const { expiresIn, maxAge: cookieMaxAge } = rememberMe ? remember : session;
        const token = jsonwebtoken_1.default.sign({ userId: user._id.toString(), role: user.role, email: user.email }, process.env.JWT_SECRET, { expiresIn });
        res.cookie(cookieConfig_1.AUTH_COOKIE_NAME, token, (0, cookieConfig_1.getAuthCookieOptions)({ maxAge: cookieMaxAge }));
        await auditService_1.auditService.log(req, { action: 'LOGIN', module: 'AUTH', recordId: user._id.toString(), recordLabel: email });
        res.json({
            data: {
                user: { id: user._id, email: user.email, role: user.role },
                employee,
            },
        });
    }
    catch (err) {
        next(err);
    }
};
exports.login = login;
const logout = async (req, res, next) => {
    try {
        await auditService_1.auditService.log(req, { action: 'LOGOUT', module: 'AUTH' });
        res.clearCookie(cookieConfig_1.AUTH_COOKIE_NAME, (0, cookieConfig_1.getClearCookieOptions)());
        res.json({ message: 'Logged out successfully' });
    }
    catch (err) {
        next(err);
    }
};
exports.logout = logout;
const getMe = async (req, res, next) => {
    try {
        const user = await User_1.User.findById(req.user?.userId);
        if (!user) {
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
            return;
        }
        const employee = user.employee
            ? await Employee_1.Employee.findById(user.employee).select('fullName employeeCode designation department officialEmail employmentType status noticePeriodDays profilePhoto onboardingStatus onboardingStep onboardingRejectionReason')
            : null;
        res.json({ data: { user: { id: user._id, email: user.email, role: user.role }, employee } });
    }
    catch (err) {
        next(err);
    }
};
exports.getMe = getMe;
const forgotPassword = async (req, res, next) => {
    try {
        const { email } = forgotSchema.parse(req.body);
        const user = await User_1.User.findOne({ email: email.toLowerCase() });
        // Always return success to prevent email enumeration
        if (!user) {
            res.json({ message: 'If the email exists, a reset code has been sent' });
            return;
        }
        // A real 6-digit numeric code, not a link — only its hash is ever
        // stored, so reading the DB can't hand anyone the working code.
        const otp = crypto_1.default.randomInt(100000, 1000000).toString();
        user.passwordResetToken = crypto_1.default.createHash('sha256').update(otp).digest('hex');
        user.passwordResetExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        user.passwordResetAttempts = 0;
        await user.save();
        const employee = user.employee ? await Employee_1.Employee.findById(user.employee) : null;
        const name = employee?.fullName || user.email;
        // Always the account's own address — email is read from the user
        // record we just looked up, never taken from anywhere else in the request.
        await emailService_1.emailService.sendPasswordResetOtp(user.email, otp, name);
        res.json({ message: 'If the email exists, a reset code has been sent' });
    }
    catch (err) {
        next(err);
    }
};
exports.forgotPassword = forgotPassword;
const resetPassword = async (req, res, next) => {
    try {
        const { email, otp, password } = resetSchema.parse(req.body);
        const invalid = () => res.status(400).json({ error: { code: 'INVALID_OTP', message: 'That code is invalid or has expired' } });
        const user = await User_1.User.findOne({ email: email.toLowerCase() })
            .select('+passwordResetToken +passwordResetExpires +passwordResetAttempts');
        if (!user || !user.passwordResetToken || !user.passwordResetExpires || user.passwordResetExpires < new Date()) {
            invalid();
            return;
        }
        if ((user.passwordResetAttempts || 0) >= MAX_OTP_ATTEMPTS) {
            invalid();
            return;
        }
        const hashedOtp = crypto_1.default.createHash('sha256').update(otp).digest('hex');
        if (hashedOtp !== user.passwordResetToken) {
            user.passwordResetAttempts = (user.passwordResetAttempts || 0) + 1;
            await user.save();
            invalid();
            return;
        }
        user.password = await bcryptjs_1.default.hash(password, 12);
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        user.passwordResetAttempts = 0;
        user.failedLoginAttempts = 0;
        user.lockedUntil = undefined;
        user.lockReason = undefined;
        user.lockedBy = undefined;
        await user.save();
        await auditService_1.auditService.log(req, { action: 'PASSWORD_RESET', module: 'AUTH', recordId: user._id.toString() });
        res.json({ message: 'Password reset successfully' });
    }
    catch (err) {
        next(err);
    }
};
exports.resetPassword = resetPassword;
const changePassword = async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = changeSchema.parse(req.body);
        const user = await User_1.User.findById(req.user?.userId).select('+password');
        if (!user)
            throw new errorHandler_1.AppError('User not found', 404, 'NOT_FOUND');
        const isValid = await bcryptjs_1.default.compare(currentPassword, user.password);
        if (!isValid) {
            res.status(400).json({ error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect' } });
            return;
        }
        user.password = await bcryptjs_1.default.hash(newPassword, 12);
        await user.save();
        await auditService_1.auditService.log(req, { action: 'PASSWORD_CHANGED', module: 'AUTH', recordId: user._id.toString() });
        res.json({ message: 'Password changed successfully' });
    }
    catch (err) {
        next(err);
    }
};
exports.changePassword = changePassword;
//# sourceMappingURL=authController.js.map