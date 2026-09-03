"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.maskIdentityNumber = maskIdentityNumber;
const crypto_1 = __importDefault(require("crypto"));
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
function getKey() {
    const key = process.env.ENCRYPTION_KEY;
    if (!key)
        throw new Error('ENCRYPTION_KEY is not set');
    return Buffer.from(key, 'hex').slice(0, 32);
}
function encrypt(text) {
    const key = getKey();
    const iv = crypto_1.default.randomBytes(IV_LENGTH);
    const cipher = crypto_1.default.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}
function decrypt(encryptedData) {
    const key = getKey();
    const [ivHex, tagHex, encrypted] = encryptedData.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
function maskIdentityNumber(type, number) {
    const n = number.replace(/\s/g, '');
    switch (type.toUpperCase()) {
        case 'AADHAAR':
            return `XXXX-XXXX-${n.slice(-4)}`;
        case 'PAN':
            return `${n.slice(0, 2)}XXXXXXX${n.slice(-1)}`;
        case 'PASSPORT':
            return `XX${n.slice(2, -2)}XX`;
        case 'DRIVING_LICENCE':
            return `XXXXXXXX${n.slice(-4)}`;
        case 'VOTER_ID':
            return `XXXXXXXX${n.slice(-4)}`;
        default:
            return `XXXXXXXX${n.slice(-4)}`;
    }
}
//# sourceMappingURL=encryption.js.map