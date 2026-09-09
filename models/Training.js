"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrainingAssignment = exports.Training = void 0;
const mongoose = require("mongoose");

/**
 * Training catalog item. Was a frontend-only placeholder before this step —
 * this is the first real backend model for it. Material is either an
 * uploaded file (reusing the exact same storageService/upload middleware as
 * EmployeeDocument — no parallel storage) or an external video/link URL, so
 * large video files never have to pass through the existing 10MB multer
 * memory-storage upload path.
 */
const trainingSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    description: { type: String },
    category: { type: String, required: true, trim: true },
    materialType: { type: String, enum: ['FILE', 'VIDEO_URL', 'LINK'], required: true },
    filePath: { type: String },
    fileName: { type: String },
    fileMimeType: { type: String },
    fileSize: { type: Number },
    externalUrl: { type: String },
    durationMinutes: { type: Number },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

const trainingAssignmentSchema = new mongoose.Schema({
    training: { type: mongoose.Schema.Types.ObjectId, ref: 'Training', required: true, index: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    status: { type: String, enum: ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED'], default: 'ASSIGNED' },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assignedAt: { type: Date, default: Date.now },
    startedAt: { type: Date },
    completedAt: { type: Date },
}, { timestamps: true });
trainingAssignmentSchema.index({ training: 1, employee: 1 }, { unique: true });

exports.Training = mongoose.model('Training', trainingSchema);
exports.TrainingAssignment = mongoose.model('TrainingAssignment', trainingAssignmentSchema);
