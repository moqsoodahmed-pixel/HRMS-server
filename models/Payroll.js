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
exports.CompensationRequest = exports.Payslip = exports.SalaryStructure = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const salaryStructureSchema = new mongoose_1.Schema({
    employee: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Employee', required: true },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date },
    basic: { type: Number, required: true, default: 0 },
    hra: { type: Number, default: 0 },
    da: { type: Number, default: 0 },
    specialAllowance: { type: Number, default: 0 },
    otherAllowances: { type: Number, default: 0 },
    pf: { type: Number, default: 0 },
    esi: { type: Number, default: 0 },
    tds: { type: Number, default: 0 },
    otherDeductions: { type: Number, default: 0 },
    grossSalary: { type: Number, default: 0 },
    netSalary: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
const payslipSchema = new mongoose_1.Schema({
    employee: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Employee', required: true },
    salaryStructure: { type: mongoose_1.Schema.Types.ObjectId, ref: 'SalaryStructure', required: true },
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    payPeriodStart: { type: Date, required: true },
    payPeriodEnd: { type: Date, required: true },
    basic: { type: Number, default: 0 },
    hra: { type: Number, default: 0 },
    da: { type: Number, default: 0 },
    specialAllowance: { type: Number, default: 0 },
    otherAllowances: { type: Number, default: 0 },
    totalEarnings: { type: Number, default: 0 },
    pf: { type: Number, default: 0 },
    esi: { type: Number, default: 0 },
    tds: { type: Number, default: 0 },
    otherDeductions: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 },
    grossSalary: { type: Number, default: 0 },
    netSalary: { type: Number, default: 0 },
    workingDays: { type: Number, default: 0 },
    paidDays: { type: Number, default: 0 },
    lop: { type: Number, default: 0 },
    status: { type: String, enum: ['DRAFT', 'GENERATED', 'PAID'], default: 'DRAFT' },
    paidOn: { type: Date },
    generatedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    pdfPath: { type: String },
    notes: { type: String },
}, { timestamps: true });
payslipSchema.index({ employee: 1, month: 1, year: 1 }, { unique: true });
salaryStructureSchema.index({ employee: 1, isActive: 1 });
payslipSchema.index({ year: -1, month: -1 });

/**
 * A proposed compensation change awaiting SUPER_ADMIN/CTO approval. HR can
 * create these but the live SalaryStructure is only ever touched once a
 * request here is approved — see compensationController.
 */
const compensationRequestSchema = new mongoose_1.Schema({
    employee: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Employee', required: true },
    currentBasic: { type: Number, required: true, default: 0 },
    currentHra: { type: Number, default: 0 },
    currentDa: { type: Number, default: 0 },
    currentSpecialAllowance: { type: Number, default: 0 },
    currentOtherAllowances: { type: Number, default: 0 },
    currentGross: { type: Number, default: 0 },
    proposedBasic: { type: Number, required: true },
    proposedHra: { type: Number, default: 0 },
    proposedDa: { type: Number, default: 0 },
    proposedSpecialAllowance: { type: Number, default: 0 },
    proposedOtherAllowances: { type: Number, default: 0 },
    proposedGross: { type: Number, default: 0 },
    changeAmount: { type: Number, default: 0 },
    changePercent: { type: Number, default: 0 },
    reason: { type: String, required: true },
    status: {
        type: String,
        enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
        default: 'PENDING',
        index: true,
    },
    requestedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    reviewedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewComments: { type: String },
    resultingSalaryStructure: { type: mongoose_1.Schema.Types.ObjectId, ref: 'SalaryStructure' },
}, { timestamps: true });
compensationRequestSchema.index({ employee: 1, status: 1 });
compensationRequestSchema.index({ status: 1, createdAt: -1 });

exports.SalaryStructure = mongoose_1.default.model('SalaryStructure', salaryStructureSchema);
exports.Payslip = mongoose_1.default.model('Payslip', payslipSchema);
exports.CompensationRequest = mongoose_1.default.model('CompensationRequest', compensationRequestSchema);
//# sourceMappingURL=Payroll.js.map