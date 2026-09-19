"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.storageService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const { randomUUID } = require("crypto");
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads/private';

// ---------------------------------------------------------------------------
// Storage backend switch. Defaults to the ORIGINAL local-disk behaviour —
// nothing changes for an existing deployment unless STORAGE_PROVIDER is
// explicitly set to "cloudinary" in the server .env file. This keeps every
// caller of storageService (documentController, employeeController's photo
// upload, trainingController, payrollController) working unmodified either
// way, since they only ever see the same upload()/download()/delete() shape.
// ---------------------------------------------------------------------------
const STORAGE_PROVIDER = (process.env.STORAGE_PROVIDER || 'local').toLowerCase();

function ensureDir(dir) {
    if (!fs_1.default.existsSync(dir)) {
        fs_1.default.mkdirSync(dir, { recursive: true });
    }
}

// ---- Cloudinary backend ----------------------------------------------------

let _cloudinary = null;
/** Lazily configures and returns the Cloudinary SDK. Throws a clear, actionable
 * error (instead of a cryptic SDK failure) if the package isn't installed or
 * the three required env vars aren't set — see the setup guide for exactly
 * where to add them. */
function getCloudinary() {
    if (_cloudinary) return _cloudinary;
    let sdk;
    try {
        sdk = require('cloudinary').v2;
    } catch {
        throw new Error(
            "STORAGE_PROVIDER=cloudinary is set but the 'cloudinary' package is not installed. " +
            "Run: npm install cloudinary --save (inside HRMS-server)."
        );
    }
    const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
        throw new Error(
            "STORAGE_PROVIDER=cloudinary is set but CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / " +
            "CLOUDINARY_API_SECRET are missing from the server .env file."
        );
    }
    sdk.config({
        cloud_name: CLOUDINARY_CLOUD_NAME,
        api_key: CLOUDINARY_API_KEY,
        api_secret: CLOUDINARY_API_SECRET,
        secure: true,
    });
    _cloudinary = sdk;
    return _cloudinary;
}

function uploadBufferToCloudinary(buffer, options) {
    const sdk = getCloudinary();
    return new Promise((resolve, reject) => {
        const stream = sdk.uploader.upload_stream(options, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
        stream.end(buffer);
    });
}

/** Every value this module ever returns for a Cloudinary-backed file starts
 * with this prefix, so download()/delete()/getFullPath() can tell at a glance
 * which backend produced it — this is how the two backends coexist: old
 * documents (local paths, no prefix) keep working after switching providers,
 * and only newly-uploaded files use Cloudinary. */
const CLOUDINARY_PREFIX = 'cloudinary:';

function isCloudinaryRef(filePath) {
    return typeof filePath === 'string' && filePath.startsWith(CLOUDINARY_PREFIX);
}

/** `cloudinary:<resource_type>:<public_id>` → { resourceType, publicId }.
 * public_id itself may legitimately contain ':' so everything after the 2nd
 * colon is rejoined rather than split further. */
function parseCloudinaryRef(filePath) {
    const rest = filePath.slice(CLOUDINARY_PREFIX.length);
    const firstColon = rest.indexOf(':');
    return { resourceType: rest.slice(0, firstColon), publicId: rest.slice(firstColon + 1) };
}

exports.storageService = {
    async upload(file, subDir = '') {
        if (STORAGE_PROVIDER === 'cloudinary') {
            try {
                const folder = ['hrms', subDir].filter(Boolean).join('/');
                const result = await uploadBufferToCloudinary(file.buffer, {
                    folder,
                    resource_type: 'auto',
                    type: 'authenticated',
                    access_mode: 'authenticated',
                    use_filename: false,
                    unique_filename: true,
                    overwrite: false,
                });
                return `${CLOUDINARY_PREFIX}${result.resource_type}:${result.public_id}`;
            } catch (err) {
                const isNetworkError = err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED' || (err.message && /network|getaddrinfo|timeout/i.test(err.message));
                if (process.env.NODE_ENV !== 'production' && isNetworkError) {
                    console.warn('⚠️  Cloudinary unreachable (offline) — falling back to local disk storage for this file');
                } else {
                    throw err;
                }
            }
        }
        // ---- original local-disk behaviour, byte-for-byte unchanged ----
        const targetDir = path_1.default.join(UPLOAD_DIR, subDir);
        ensureDir(targetDir);
        const ext = path_1.default.extname(file.originalname);
        const filename = `${randomUUID()}${ext}`;
        const targetPath = path_1.default.join(targetDir, filename);
        fs_1.default.writeFileSync(targetPath, file.buffer);
        return path_1.default.join(subDir, filename).replace(/\\/g, '/');
    },

    async download(filePath) {
        if (isCloudinaryRef(filePath)) {
            const { resourceType, publicId } = parseCloudinaryRef(filePath);
            const sdk = getCloudinary();
            // A brand-new signed URL every call, valid for 60 seconds. Nothing
            // about this URL is ever stored or cached — a copy-pasted link goes
            // stale almost immediately, and a fresh one always requires passing
            // assertCanAccessEmployee again first (see documentController).
            const url = sdk.utils.private_download_url(publicId, undefined, {
                resource_type: resourceType,
                type: 'authenticated',
                expires_at: Math.floor(Date.now() / 1000) + 60,
            });
            const res = await fetch(url);
            if (!res.ok) throw new Error('File not found');
            const arrayBuffer = await res.arrayBuffer();
            return Buffer.from(arrayBuffer);
        }
        // ---- original local-disk behaviour, byte-for-byte unchanged ----
        const fullPath = path_1.default.join(UPLOAD_DIR, filePath);
        if (!fs_1.default.existsSync(fullPath)) {
            throw new Error('File not found');
        }
        return fs_1.default.readFileSync(fullPath);
    },

    async delete(filePath) {
        if (isCloudinaryRef(filePath)) {
            const { resourceType, publicId } = parseCloudinaryRef(filePath);
            const sdk = getCloudinary();
            await sdk.uploader.destroy(publicId, { resource_type: resourceType, type: 'authenticated' }).catch(() => { });
            return;
        }
        // ---- original local-disk behaviour, byte-for-byte unchanged ----
        const fullPath = path_1.default.join(UPLOAD_DIR, filePath);
        if (fs_1.default.existsSync(fullPath)) {
            fs_1.default.unlinkSync(fullPath);
        }
    },

    getFullPath(filePath) {
        if (isCloudinaryRef(filePath)) return filePath; // not a local filesystem path
        return path_1.default.join(UPLOAD_DIR, filePath);
    },
};