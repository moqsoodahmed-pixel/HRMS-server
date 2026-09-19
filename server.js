"use strict";

// Polyfill process.getBuiltinModule and web primitives for Node.js <= 18 compatibility
if (typeof process.getBuiltinModule !== 'function') {
    process.getBuiltinModule = function (name) {
        try {
            return require(name);
        } catch {
            return undefined;
        }
    };
}
if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = class DOMMatrix {
        constructor() {
            this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
        }
    };
}
if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData {
        constructor(w, h) {
            this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4);
        }
    };
}
if (typeof globalThis.Path2D === 'undefined') {
    globalThis.Path2D = class Path2D {};
}

var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const { validateEnv } = require("./config/env");
validateEnv();
const app_1 = __importDefault(require("./app"));
const database_1 = require("./config/database");
const PORT = parseInt(process.env.PORT || '5000');
async function startServer() {
    await (0, database_1.connectDatabase)();
    const server = app_1.default.listen(PORT, () => {
        console.log(`🚀 DutyLaunch HRMS Server running on port ${PORT}`);
        console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🌐 Client URL: ${process.env.CLIENT_URL || 'http://localhost:5173'}`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`❌ Port ${PORT} is already in use by another process.`);
        } else {
            console.error('Server error:', err);
        }
        process.exit(1);
    });

    const cleanup = () => {
        server.close(() => {
            process.exit(0);
        });
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
}
startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
