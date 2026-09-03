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
exports.Holiday = exports.LeaveRequest = exports.LeaveBalance = exports.LeaveType = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const leaveTypeSchema = new mongoose_1.Schema({
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true, uppercase: true },
    description: { type: String },
    maxDaysPerYear: { type: Number, required: true },
    isCarryForward: { type: Boolean, default: false },
    maxCarryForwardDays: { type: Number },
    isPaid: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
}, { timestamps: true });
const leaveBalanceSchema = new mongoose_1.Schema({
    employee: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Employee', required: true },
    leaveType: { type: mongoose_1.Schema.Types.ObjectId, ref: 'LeaveType', required: true },
    year: { type: Number, required: true },
    totalDays: { type: Number, default: 0 },
    usedDays: { type: Number, default: 0 },
    pendingDays: { type: Number, default: 0 },
    remainingDays: { type: Number, default: 0 },
}, { timestamps: true });
leaveBalanceSchema.index({ employee: 1, leaveType: 1, year: 1 }, { unique: true });
const leaveRequestSchema = new mongoose_1.Schema({
    employee: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Employee', required: true },
    leaveType: { type: mongoose_1.Schema.Types.ObjectId, ref: 'LeaveType', required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    totalDays: { type: Number, required: true },
    isHalfDay: { type: Boolean, default: false },
    halfDayType: { type: String, enum: ['FIRST_HALF', 'SECOND_HALF'] },
    reason: { type: String, required: true },
    status: {
        type: String,
        enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
        default: 'PENDING',
        index: true,
    },
    approvedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    rejectedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: { type: Date },
    rejectionReason: { type: String },
    managerNote: { type: String },
}, { timestamps: true });
const holidaySchema = new mongoose_1.Schema({
    name: { type: String, required: true },
    date: { type: Date, required: true },
    type: { type: String, enum: ['NATIONAL', 'OPTIONAL', 'COMPANY'], default: 'NATIONAL' },
    isActive: { type: Boolean, default: true },
    year: { type: Number, required: true },
}, { timestamps: true });
leaveRequestSchema.index({ employee: 1, startDate: -1 });
holidaySchema.index({ year: 1, date: 1 });
exports.LeaveType = mongoose_1.default.model('LeaveType', leaveTypeSchema);
exports.LeaveBalance = mongoose_1.default.model('LeaveBalance', leaveBalanceSchema);
exports.LeaveRequest = mongoose_1.default.model('LeaveRequest', leaveRequestSchema);
exports.Holiday = mongoose_1.default.model('Holiday', holidaySchema);
//# sourceMappingURL=Leave.js.map