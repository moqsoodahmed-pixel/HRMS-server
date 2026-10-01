"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function (o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function () { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function (o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function (o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function (o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function (o) {
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
exports.OffboardingTask = exports.OnboardingTask = exports.AssetEvent = exports.AssetCounter = exports.AssetAssignment = exports.Asset = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const assetSchema = new mongoose_1.Schema({
    assetCode: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    company: { type: String, enum: ['DutyLaunch', 'LauncherDesk'], required: true },
    assetCategory: { type: String, required: true },
    type: { type: String, required: true },
    brand: { type: String },
    model: { type: String },
    serialNumber: { type: String },
    purchaseDate: { type: Date },
    purchaseValue: { type: Number },
    condition: { type: String, enum: ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'], default: 'NEW' },
    status: {
        type: String,
        enum: ['AVAILABLE', 'ASSIGNED', 'RETURNED', 'MAINTENANCE', 'RETIRED', 'UNDER_REPAIR', 'DISPOSED', 'LOST', 'TRANSFERRED'],
        default: 'AVAILABLE',
        index: true,
    },
    assignedTo: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Employee' },
    assignedAt: { type: Date },
    location: { type: String },
    notes: { type: String },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    qrCode: { type: String },
    barcode: { type: String },
    warrantyStart: { type: Date },
    warrantyEnd: { type: Date },
    amc: { type: Boolean, default: false },
    amcStart: { type: Date },
    amcEnd: { type: Date },
    vendorName: { type: String },
    vendorContact: { type: String },
    invoiceNumber: { type: String },
    poNumber: { type: String },
    serviceCenter: { type: String },
    department: { type: String },
    branch: { type: String },
    floor: { type: String },
    expectedReturn: { type: Date },
    transferredTo: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Employee' },
}, { timestamps: true });
const assetAssignmentSchema = new mongoose_1.Schema({
    asset: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Asset', required: true },
    employee: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Employee', required: true },
    assignedAt: { type: Date, default: Date.now },
    returnedAt: { type: Date },
    conditionAtAssignment: { type: String, required: true },
    conditionAtReturn: { type: String },
    notes: { type: String },
    assignedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    returnedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
const assetCounterSchema = new mongoose_1.Schema({
    prefix: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0 },
});
const assetEventSchema = new mongoose_1.Schema({
    asset: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Asset', required: true, index: true },
    eventType: { type: String, required: true },
    description: String,
    oldValue: mongoose_1.Schema.Types.Mixed,
    newValue: mongoose_1.Schema.Types.Mixed,
    performedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    performedAt: { type: Date, default: Date.now },
}, { timestamps: false });
const onboardingTaskSchema = new mongoose_1.Schema({
    employee: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Employee', required: true },
    taskName: { type: String, required: true },
    description: { type: String },
    assignedTo: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    dueDate: { type: Date },
    status: { type: String, enum: ['TODO', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'SKIPPED'], default: 'TODO', index: true },
    completedAt: { type: Date },
    completedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    category: { type: String, required: true },
    isRequired: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
}, { timestamps: true });
const offboardingTaskSchema = new mongoose_1.Schema({
    employee: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Employee', required: true },
    taskName: { type: String, required: true },
    description: { type: String },
    assignedTo: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    dueDate: { type: Date },
    status: { type: String, enum: ['TODO', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'SKIPPED'], default: 'TODO', index: true },
    completedAt: { type: Date },
    completedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    category: { type: String, required: true },
    isRequired: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
}, { timestamps: true });
assetAssignmentSchema.index({ asset: 1, assignedAt: -1 });
assetAssignmentSchema.index({ employee: 1 });
onboardingTaskSchema.index({ employee: 1, order: 1 });
offboardingTaskSchema.index({ employee: 1, order: 1 });
exports.Asset = mongoose_1.default.model('Asset', assetSchema);
exports.AssetAssignment = mongoose_1.default.model('AssetAssignment', assetAssignmentSchema);
exports.AssetCounter = mongoose_1.default.model('AssetCounter', assetCounterSchema);
exports.AssetEvent = mongoose_1.default.model('AssetEvent', assetEventSchema);
exports.OnboardingTask = mongoose_1.default.model('OnboardingTask', onboardingTaskSchema);
exports.OffboardingTask = mongoose_1.default.model('OffboardingTask', offboardingTaskSchema);
//# sourceMappingURL=AssetOnboarding.js.map