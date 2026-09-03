"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchesDeclaredType = matchesDeclaredType;

/**
 * The multipart Content-Type header is client-supplied and trivially spoofed
 * (multer's fileFilter only sees this declared value, not file content). This
 * checks the file's actual leading bytes against the signature expected for
 * its declared MIME type, so an executable or script renamed/mislabeled as an
 * allowed document type is rejected rather than stored and later served back
 * with that same (still-allowed) Content-Type.
 *
 * text/csv has no binary signature — it is plain text by definition — so it
 * is intentionally left unchecked here rather than risk false positives.
 */
const SIGNATURES = {
    'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
    'image/jpeg': [[0xff, 0xd8, 0xff]],
    'image/jpg': [[0xff, 0xd8, 0xff]],
    'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    // .docx / .xlsx are ZIP containers — several valid ZIP local-file-header variants exist.
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
        [0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08],
    ],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
        [0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08],
    ],
    // Legacy .xls — OLE2 compound file.
    'application/vnd.ms-excel': [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
};

function matchesDeclaredType(buffer, mimetype) {
    const candidates = SIGNATURES[mimetype];
    if (!candidates) return true; // no signature defined (e.g. text/csv) — nothing to check
    if (!buffer || buffer.length === 0) return false;
    return candidates.some((sig) => sig.every((byte, i) => buffer[i] === byte));
}
