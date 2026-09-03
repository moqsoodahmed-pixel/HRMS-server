"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadImage = exports.upload = void 0;
const multer_1 = __importDefault(require("multer"));
const errorHandler_1 = require("./errorHandler");
const ALLOWED_MIMETYPES = [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const storage = multer_1.default.memoryStorage();
const fileFilter = (_req, file, cb) => {
    if (ALLOWED_MIMETYPES.includes(file.mimetype)) {
        cb(null, true);
    }
    else {
        cb(new errorHandler_1.AppError(`File type ${file.mimetype} is not allowed`, 400, 'INVALID_FILE_TYPE'));
    }
};
exports.upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter,
});
exports.uploadImage = (0, multer_1.default)({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB for images
    fileFilter: (_req, file, cb) => {
        if (['image/jpeg', 'image/jpg', 'image/png'].includes(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new errorHandler_1.AppError('Only JPG and PNG images are allowed', 400, 'INVALID_FILE_TYPE'));
        }
    },
});
//# sourceMappingURL=upload.js.map