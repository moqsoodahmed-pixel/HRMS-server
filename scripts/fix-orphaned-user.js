"use strict";
/**
 * fix-orphaned-user.js
 * ────────────────────
 * The previous create-sales-employee.js created the User but failed on
 * the Employee profile (missing firstName/lastName). This script deletes
 * that orphaned User so you can run create-sales-employee.js fresh.
 *
 * Usage:
 *   node scripts/fix-orphaned-user.js
 */

require("dotenv/config");
const mongoose = require("mongoose");
const { User } = require("../models/User");
const { Employee } = require("../models/Employee");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/dutylaunch-hrms";
const EMAIL_TO_FIX = "sales1@launcherdesk.com";

async function main() {
  console.log("Connecting to MongoDB…");
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connected to:", MONGODB_URI);

  const user = await User.findOne({ email: EMAIL_TO_FIX });
  if (!user) {
    console.log(`⚠️  No user found with email ${EMAIL_TO_FIX} — nothing to fix.`);
    await mongoose.disconnect();
    return;
  }

  // Check if an Employee profile already exists for this user
  const emp = await Employee.findOne({ user: user._id });
  if (emp) {
    console.log(`ℹ️  Employee profile already exists: ${emp.fullName} (${emp.employeeCode})`);
    console.log("   The account is fully set up — no fix needed!");
    console.log(`   Login: ${EMAIL_TO_FIX} / Sales@123456`);
    await mongoose.disconnect();
    return;
  }

  // No Employee profile — this is the orphaned user, safe to delete
  await User.deleteOne({ _id: user._id });
  console.log(`✅ Deleted orphaned User: ${EMAIL_TO_FIX}`);
  console.log("");
  console.log("Now run:");
  console.log("  node scripts/create-sales-employee.js");

  await mongoose.disconnect();
  console.log("✅ Done.");
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
