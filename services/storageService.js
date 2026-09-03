"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.storageService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const uuid_1 = require("uuid");
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads/private';
function ensureDir(dir) {
    if (!fs_1.default.existsSync(dir)) {
        fs_1.default.mkdirSync(dir, { recursive: true });
    }
}
exports.storageService = {
    async upload(file, subDir = '') {
        const targetDir = path_1.default.join(UPLOAD_DIR, subDir);
        ensureDir(targetDir);
        const ext = path_1.default.extname(file.originalname);
        const filename = `${(0, uuid_1.v4)()}${ext}`;
        const targetPath = path_1.default.join(targetDir, filename);
        fs_1.default.writeFileSync(targetPath, file.buffer);
        return path_1.default.join(subDir, filename).replace(/\\/g, '/');
    },
    async download(filePath) {
        const fullPath = path_1.default.join(UPLOAD_DIR, filePath);
        if (!fs_1.default.existsSync(fullPath)) {
            throw new Error('File not found');
        }
        return fs_1.default.readFileSync(fullPath);
    },
    async delete(filePath) {
        const fullPath = path_1.default.join(UPLOAD_DIR, filePath);
        if (fs_1.default.existsSync(fullPath)) {
            fs_1.default.unlinkSync(fullPath);
        }
    },
    getFullPath(filePath) {
        return path_1.default.join(UPLOAD_DIR, filePath);
    },
};
//# sourceMappingURL=storageService.js.map