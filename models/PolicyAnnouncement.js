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
exports.AnnouncementRead = exports.Announcement = exports.PolicyAcknowledgement = exports.Policy = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const policySchema = new mongoose_1.Schema({
    title: { type: String, required: true },
    description: { type: String },
    category: { type: String, required: true },
    content: { type: String },
    filePath: { type: String },
    version: { type: String, required: true, default: '1.0' },
    status: { type: String, enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'], default: 'DRAFT' },
    publishedAt: { type: Date },
    publishedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    isAcknowledgementRequired: { type: Boolean, default: false },
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
const policyAcknowledgementSchema = new mongoose_1.Schema({
    policy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Policy', required: true },
    employee: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Employee', required: true },
    acknowledgedAt: { type: Date, default: Date.now },
    version: { type: String, required: true },
}, { timestamps: true });
policyAcknowledgementSchema.index({ policy: 1, employee: 1 }, { unique: true });
const announcementSchema = new mongoose_1.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'], default: 'MEDIUM' },
    targetAudience: { type: String, enum: ['ALL', 'DEPARTMENT', 'DESIGNATION', 'SPECIFIC'], default: 'ALL' },
    targetDepartments: [{ type: String }],
    targetDesignations: [{ type: String }],
    targetEmployees: [{ type: mongoose_1.Schema.Types.ObjectId, ref: 'Employee' }],
    filePath: { type: String },
    publishDate: { type: Date },
    expiryDate: { type: Date },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
const announcementReadSchema = new mongoose_1.Schema({
    announcement: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Announcement', required: true },
    employee: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Employee', required: true },
    readAt: { type: Date, default: Date.now },
}, { timestamps: false });
announcementReadSchema.index({ announcement: 1, employee: 1 }, { unique: true });
exports.Policy = mongoose_1.default.model('Policy', policySchema);
exports.PolicyAcknowledgement = mongoose_1.default.model('PolicyAcknowledgement', policyAcknowledgementSchema);
exports.Announcement = mongoose_1.default.model('Announcement', announcementSchema);
exports.AnnouncementRead = mongoose_1.default.model('AnnouncementRead', announcementReadSchema);
//# sourceMappingURL=PolicyAnnouncement.js.map