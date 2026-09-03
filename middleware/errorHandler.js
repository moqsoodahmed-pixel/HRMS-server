"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFound = exports.errorHandler = exports.AppError = void 0;
const zod_1 = require("zod");

class AppError extends Error {
    constructor(message, statusCode, code) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
    }
}
exports.AppError = AppError;

/** Human-readable summary of the first Zod issue, e.g. "officialEmail: Invalid email". */
function zodMessage(err) {
    const first = err.errors?.[0];
    if (!first) return 'Validation failed';
    const field = first.path?.join('.');
    return field ? `${field}: ${first.message}` : first.message;
}

const errorHandler = (err, _req, res, _next) => {
    if (err instanceof zod_1.ZodError) {
        res.status(422).json({
            error: {
                code: 'VALIDATION_ERROR',
                message: zodMessage(err),
                details: err.errors,
            },
        });
        return;
    }

    if (err instanceof AppError) {
        res.status(err.statusCode).json({
            error: { code: err.code, message: err.message },
        });
        return;
    }

    // Mongoose: bad ObjectId / bad cast
    if (err?.name === 'CastError') {
        res.status(400).json({
            error: { code: 'INVALID_ID', message: `Invalid value for "${err.path}"` },
        });
        return;
    }

    // Mongoose: schema validation
    if (err?.name === 'ValidationError') {
        const details = Object.values(err.errors || {}).map((e) => ({ path: [e.path], message: e.message }));
        res.status(422).json({
            error: {
                code: 'VALIDATION_ERROR',
                message: details[0] ? `${details[0].path[0]}: ${details[0].message}` : 'Validation failed',
                details,
            },
        });
        return;
    }

    // MongoDB: unique index violation
    if (err?.code === 11000) {
        const field = Object.keys(err.keyPattern || err.keyValue || {}).join(', ');
        res.status(409).json({
            error: {
                code: 'DUPLICATE',
                message: field ? `A record with this ${field} already exists` : 'Duplicate record',
            },
        });
        return;
    }

    // Multer upload errors
    if (err?.name === 'MulterError') {
        const message = err.code === 'LIMIT_FILE_SIZE'
            ? 'File is too large'
            : `Upload failed: ${err.message}`;
        res.status(400).json({ error: { code: err.code || 'UPLOAD_ERROR', message } });
        return;
    }

    // Unexpected: log server-side, never leak internals to the client in production.
    console.error('[error]', err);
    const isDev = process.env.NODE_ENV !== 'production';
    res.status(500).json({
        error: {
            code: 'INTERNAL_ERROR',
            message: 'An internal server error occurred',
            ...(isDev && { details: err?.message }),
        },
    });
};
exports.errorHandler = errorHandler;

const notFound = (req, res) => {
    res.status(404).json({
        error: {
            code: 'NOT_FOUND',
            message: `Route ${req.originalUrl} not found`,
        },
    });
};
exports.notFound = notFound;
