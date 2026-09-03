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
exports.Employee = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const employeeSchema = new mongoose_1.Schema({
    employeeCode: { type: String, required: true, unique: true, index: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    officialEmail: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    personalEmail: { type: String, lowercase: true, trim: true },
    personalMobile: { type: String },
    officialMobile: { type: String },
    designation: { type: String, required: true, index: true },
    department: { type: String, required: true, index: true },
    manager: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Employee' },
    employmentType: {
        type: String,
        enum: ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT'],
        default: 'FULL_TIME',
    },
    status: {
        type: String,
        enum: ['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'PROBATION', 'NOTICE_PERIOD'],
        default: 'ACTIVE',
        index: true,
    },
    dateOfJoining: { type: Date, required: true },
    probationEndDate: { type: Date },
    confirmationDate: { type: Date },
    dateOfExit: { type: Date },
    exitReason: { type: String },
    noticePeriodDays: { type: Number },
    workLocation: { type: String },
    profilePhoto: { type: String },
    dateOfBirth: { type: Date },
    gender: { type: String },
    bloodGroup: { type: String },
    nationality: { type: String },
    isArchived: { type: Boolean, default: false },
    user: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    /**
     * Mandatory-document completion gate. Orthogonal to `status` (employment
     * state): an employee can be ACTIVE and logged in from day one while this
     * stays PENDING. It only becomes COMPLETE once every required document
     * (see utils/documentRequirements.js) is VERIFIED. Kept in sync by
     * documentController whenever a document is uploaded/verified/rejected —
     * see documentController.syncDocumentStatus.
     */
    documentStatus: {
        type: String,
        enum: ['PENDING', 'COMPLETE'],
        default: 'PENDING',
        index: true,
    },
    // Lets the HR list and filters distinguish "nothing uploaded yet" from
    // "something was uploaded and rejected" without a third top-level status.
    hasRejectedDocuments: { type: Boolean, default: false },
}, { timestamps: true });
exports.Employee = mongoose_1.default.model('Employee', employeeSchema);
//# sourceMappingURL=Employee.js.map