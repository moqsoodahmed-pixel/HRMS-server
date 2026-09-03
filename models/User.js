"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.User = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const userSchema = new mongoose_1.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    password: { type: String, required: true, select: false },
    role: {
        type: String,
        // FOUNDER_CEO and CTO carry identical, full platform-administrator
        // permissions (see utils/roles.js ELEVATED_ROLES) while remaining
        // distinct, identifiable roles for display and audit purposes.
        // SUPER_ADMIN is kept only for backward compatibility with
        // pre-migration accounts/tokens — new elevated accounts use FOUNDER_CEO.
        // PROJECT_HEAD and IT_HEAD/MANAGER are all team/department-scoped,
        // non-elevated roles (see utils/roles.js TEAM_SCOPED_ROLES).
        enum: ['FOUNDER_CEO', 'SUPER_ADMIN', 'CTO', 'DIRECTOR', 'IT_HEAD', 'PROJECT_HEAD', 'HR_ADMIN', 'FINANCE', 'MANAGER', 'EMPLOYEE', 'AUDITOR'],
        default: 'EMPLOYEE',
    },
    isActive: { type: Boolean, default: true },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    lastLogin: { type: Date },
    lastLoginIp: { type: String },
    lastLoginUserAgent: { type: String },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    employee: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Employee' },
}, { timestamps: true });
exports.User = mongoose_1.default.model('User', userSchema);
//# sourceMappingURL=User.js.map