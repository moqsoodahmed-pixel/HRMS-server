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
const zod_1 = require("zod");
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(1),
    rememberMe: zod_1.z.boolean().optional(),
});
const forgotSchema = zod_1.z.object({ email: zod_1.z.string().email() });
const resetSchema = zod_1.z.object({
    token: zod_1.z.string(),
    password: zod_1.z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, 'Password must contain uppercase, lowercase, number, and special character'),
});
const changeSchema = zod_1.z.object({
    currentPassword: zod_1.z.string(),
    newPassword: zod_1.z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/, 'Password must contain uppercase, lowercase, number, and special character'),
});
const login = async (req, res, next) => {
    try {
        const { email, password, rememberMe } = loginSchema.parse(req.body);
        const user = await User_1.User.findOne({ email: email.toLowerCase() })
            .select('+password');
        if (!user) {
            await auditService_1.auditService.log(req, { action: 'LOGIN_FAILED', module: 'AUTH', recordLabel: email });
            res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
            return;
        }
        // Check if locked
        if (user.lockedUntil && user.lockedUntil > new Date()) {
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
        // Reset failed attempts
        user.failedLoginAttempts = 0;
        user.lockedUntil = undefined;
        user.lastLogin = new Date();
        user.lastLoginIp = req.ip;
        user.lastLoginUserAgent = req.headers['user-agent'];
        await user.save();
        const expiresIn = rememberMe ? '7d' : '30m';
        const token = jsonwebtoken_1.default.sign({ userId: user._id.toString(), role: user.role, email: user.email }, process.env.JWT_SECRET, { expiresIn });
        const cookieMaxAge = rememberMe ? 7 * 24 * 60 * 60 * 1000 : 30 * 60 * 1000;
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: cookieMaxAge,
        });
        await auditService_1.auditService.log(req, { action: 'LOGIN', module: 'AUTH', recordId: user._id.toString(), recordLabel: email });
        const employee = user.employee ? await Employee_1.Employee.findById(user.employee).select('fullName employeeCode designation department profilePhoto') : null;
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
        res.clearCookie('token');
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
            ? await Employee_1.Employee.findById(user.employee).select('fullName employeeCode designation department profilePhoto')
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
            res.json({ message: 'If the email exists, a reset link has been sent' });
            return;
        }
        const token = crypto_1.default.randomBytes(32).toString('hex');
        user.passwordResetToken = token;
        user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await user.save();
        const employee = user.employee ? await Employee_1.Employee.findById(user.employee) : null;
        const name = employee?.fullName || user.email;
        await emailService_1.emailService.sendPasswordReset(user.email, token, name);
        res.json({ message: 'If the email exists, a reset link has been sent' });
    }
    catch (err) {
        next(err);
    }
};
exports.forgotPassword = forgotPassword;
const resetPassword = async (req, res, next) => {
    try {
        const { token, password } = resetSchema.parse(req.body);
        const user = await User_1.User.findOne({
            passwordResetToken: token,
            passwordResetExpires: { $gt: new Date() },
        }).select('+passwordResetToken +passwordResetExpires');
        if (!user) {
            res.status(400).json({ error: { code: 'INVALID_TOKEN', message: 'Reset token is invalid or expired' } });
            return;
        }
        user.password = await bcryptjs_1.default.hash(password, 12);
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        user.failedLoginAttempts = 0;
        user.lockedUntil = undefined;
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