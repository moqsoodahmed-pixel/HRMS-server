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
exports.AuditLog = exports.Notification = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const notificationSchema = new mongoose_1.Schema({
    user: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date },
    relatedModel: { type: String },
    relatedId: { type: mongoose_1.Schema.Types.ObjectId },
}, { timestamps: true });
notificationSchema.index({ user: 1, isRead: 1 });
const auditLogSchema = new mongoose_1.Schema({
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    userEmail: { type: String },
    action: { type: String, required: true },
    module: { type: String, required: true },
    recordId: { type: String },
    recordLabel: { type: String },
    oldValue: { type: mongoose_1.Schema.Types.Mixed },
    newValue: { type: mongoose_1.Schema.Types.Mixed },
    ipAddress: { type: String },
    userAgent: { type: String },
}, {
    timestamps: { createdAt: true, updatedAt: false },
});
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ module: 1, action: 1 });
// Make audit logs immutable
auditLogSchema.pre('updateOne', function () {
    throw new Error('Audit logs are immutable');
});
auditLogSchema.pre('findOneAndUpdate', function () {
    throw new Error('Audit logs are immutable');
});
auditLogSchema.pre('deleteOne', function () {
    throw new Error('Audit logs are immutable');
});
exports.Notification = mongoose_1.default.model('Notification', notificationSchema);
exports.AuditLog = mongoose_1.default.model('AuditLog', auditLogSchema);
//# sourceMappingURL=NotificationAudit.js.map