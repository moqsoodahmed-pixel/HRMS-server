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
exports.IdentityDocument = exports.EmployeeDocument = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const documentSchema = new mongoose_1.Schema({
    employee: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Employee', required: true },
    category: { type: String, required: true },
    name: { type: String, required: true },
    originalName: { type: String, required: true },
    filePath: { type: String, required: true },
    fileType: { type: String, required: true },
    fileSize: { type: Number, required: true },
    issueDate: { type: Date },
    expiryDate: { type: Date, index: true },
    isVerified: { type: Boolean, default: false },
    status: {
        type: String,
        enum: ['PENDING', 'VERIFIED', 'REJECTED', 'ARCHIVED'],
        default: 'PENDING',
        index: true,
    },
    rejectionReason: { type: String },
    verifiedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: { type: Date },
    notes: { type: String },
    version: { type: Number, default: 1 },
    isArchived: { type: Boolean, default: false },
    uploadedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
const identityDocumentSchema = new mongoose_1.Schema({
    employee: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Employee', required: true },
    documentType: {
        type: String,
        enum: ['AADHAAR', 'PAN', 'PASSPORT', 'DRIVING_LICENCE', 'VOTER_ID', 'OTHER'],
        required: true,
    },
    encryptedNumber: { type: String, required: true, select: false },
    maskedNumber: { type: String, required: true },
    issueDate: { type: Date },
    expiryDate: { type: Date },
    filePath: { type: String },
    isVerified: { type: Boolean, default: false },
    notes: { type: String },
}, { timestamps: true });
identityDocumentSchema.index({ employee: 1, documentType: 1 }, { unique: true });
documentSchema.index({ employee: 1, isArchived: 1 });
documentSchema.index({ createdAt: -1 });
exports.EmployeeDocument = mongoose_1.default.model('EmployeeDocument', documentSchema);
exports.IdentityDocument = mongoose_1.default.model('IdentityDocument', identityDocumentSchema);
//# sourceMappingURL=Document.js.map