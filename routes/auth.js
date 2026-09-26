"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authController_1 = require("../controllers/authController");
const auth_1 = require("../middleware/auth");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const router = (0, express_1.Router)();
const loginLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many login attempts, please try again later' } },
});
// Keeps a single IP from spamming OTP-request emails or brute-forcing the
// 6-digit code across many attempts within the window.
const forgotLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many reset requests, please try again later' } },
});
const resetLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts, please try again later' } },
});
router.post('/login', loginLimiter, authController_1.login);
router.post('/logout', auth_1.authenticate, authController_1.logout);
router.get('/me', auth_1.authenticate, authController_1.getMe);
router.post('/forgot-password', forgotLimiter, authController_1.forgotPassword);
router.post('/reset-password', resetLimiter, authController_1.resetPassword);
router.post('/change-password', auth_1.authenticate, authController_1.changePassword);
exports.default = router;
//# sourceMappingURL=auth.js.map