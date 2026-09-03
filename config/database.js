"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDatabase = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const connectDatabase = async () => {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dutylaunch-hrms';
    try {
        await mongoose_1.default.connect(uri);
        console.log('✅ MongoDB connected successfully');
    }
    catch (error) {
        console.error('❌ MongoDB connection error:', error);
        process.exit(1);
    }
    mongoose_1.default.connection.on('disconnected', () => {
        console.warn('⚠️  MongoDB disconnected');
    });
    mongoose_1.default.connection.on('error', (err) => {
        console.error('MongoDB error:', err);
    });
};
exports.connectDatabase = connectDatabase;
//# sourceMappingURL=database.js.map