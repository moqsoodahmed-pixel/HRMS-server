"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const morgan_1 = __importDefault(require("morgan"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const express_mongo_sanitize_1 = __importDefault(require("express-mongo-sanitize"));
const compression_1 = __importDefault(require("compression"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const routes_1 = __importDefault(require("./routes"));
const errorHandler_1 = require("./middleware/errorHandler");
const app = (0, express_1.default)();
const isProd = process.env.NODE_ENV === 'production';
// Security
app.use((0, helmet_1.default)({
    // The SPA is served from the same origin; allow it to load its own assets.
    crossOriginResourcePolicy: { policy: 'same-site' },
    contentSecurityPolicy: isProd ? undefined : false,
}));
app.set('trust proxy', 1);
// CORS
app.use((0, cors_1.default)({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
// Rate limiting. A dashboard SPA fires many parallel reads on every page, so the
// development budget is larger; production keeps the tight limit.
const globalLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX || (isProd ? '300' : '3000')),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, please slow down.' } },
});
app.use('/api', globalLimiter);
// Body parsing
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
app.use((0, cookie_parser_1.default)());
app.use((0, express_mongo_sanitize_1.default)());
app.use((0, compression_1.default)());
// Logging
if (process.env.NODE_ENV !== 'test') {
    app.use((0, morgan_1.default)('dev'));
}
// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// API Routes
app.use('/api', routes_1.default);
// Unknown API routes must answer with JSON, never with the SPA shell.
app.use('/api', errorHandler_1.notFound);
// Serve the built React frontend when it exists (production / preview builds).
const CLIENT_DIST = path_1.default.join(__dirname, '../client/dist');
if (fs_1.default.existsSync(path_1.default.join(CLIENT_DIST, 'index.html'))) {
    app.use(express_1.default.static(CLIENT_DIST));
    app.get('*', (_req, res) => {
        res.sendFile(path_1.default.join(CLIENT_DIST, 'index.html'));
    });
}
// Not found
app.use(errorHandler_1.notFound);
// Error handler
app.use(errorHandler_1.errorHandler);
exports.default = app;
