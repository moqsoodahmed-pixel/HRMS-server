"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDatabase = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const connectDatabase = async () => {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dutylaunch-hrms';
    const isAtlas = uri.includes('mongodb.net') || uri.startsWith('mongodb+srv');

    // Safety guard: prevent test / development environment from accidentally modifying Atlas
    if (process.env.NODE_ENV !== 'production' && isAtlas && process.env.ALLOW_ATLAS_IN_DEV !== 'true') {
        console.error('🚫 SAFETY GUARD BLOCKED CONNECTION:');
        console.error('   You are in development/test mode, but MONGODB_URI points to MongoDB Atlas.');
        console.error('   To prevent accidental modifications to production Atlas, connection is blocked.');
        console.error('   Please use local MongoDB Compass: mongodb://127.0.0.1:27017/dutylaunch-hrms');
        process.exit(1);
    }

    try {
        await mongoose_1.default.connect(uri);
        if (isAtlas) {
            console.log('☁️  Connected to MongoDB Atlas');
        } else {
            console.log('💻 Connected to LOCAL MongoDB (Compass: localhost:27017) — Atlas data is 100% untouched');
        }
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