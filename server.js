"use strict";
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
    app_1.default.listen(PORT, () => {
        console.log(`🚀 DutyLaunch HRMS Server running on port ${PORT}`);
        console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🌐 Client URL: ${process.env.CLIENT_URL || 'http://localhost:5173'}`);
    });
}
startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
