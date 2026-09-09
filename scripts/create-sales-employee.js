"use strict";
/**
 * create-sales-employee.js
 * ────────────────────────
 * One-time script to create a Sales team employee account.
 *
 * Usage:
 *   node scripts/create-sales-employee.js
 *
 * You can run it multiple times safely — it checks if the email already exists
 * before creating anything.
 *
 * To customize the employee details, edit the SALES_EMPLOYEE object below.
 */

require("dotenv/config");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const { User } = require("../models/User");
const { Employee } = require("../models/Employee");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/dutylaunch-hrms";

// ─── Customize this block ────────────────────────────────────────────────────
const SALES_EMPLOYEE = {
  // Login credentials
  email: "sales1@launcherdesk.com",
  password: "Sales@123456",

  // Employee profile
  firstName: "Arjun",
  lastName: "Mehta",
  fullName: "Arjun Mehta",
  employeeCode: "DL-SALES-001",
  department: "Sales",
  designation: "Sales Executive",
  employmentType: "FULL_TIME", // FULL_TIME | PART_TIME | CONTRACT | INTERN | CONSULTANT
  officialEmail: "sales1@launcherdesk.com",
  phone: "+919876500001",
  dateOfJoining: new Date("2026-09-01"),
};
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Connecting to MongoDB…");
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connected to:", MONGODB_URI);

  // Check if user already exists
  const existing = await User.findOne({ email: SALES_EMPLOYEE.email });
  if (existing) {
    console.log(`⚠️  User ${SALES_EMPLOYEE.email} already exists. Skipping creation.`);
    console.log("   If you want to recreate, delete the user from MongoDB first.");
    await mongoose.disconnect();
    return;
  }

  // Check if employee code already exists
  const existingEmp = await Employee.findOne({ employeeCode: SALES_EMPLOYEE.employeeCode });
  if (existingEmp) {
    console.log(`⚠️  Employee code ${SALES_EMPLOYEE.employeeCode} already exists. Change it in the script.`);
    await mongoose.disconnect();
    return;
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(SALES_EMPLOYEE.password, 12);

  // Create User
  const user = await User.create({
    email: SALES_EMPLOYEE.email,
    password: hashedPassword,
    role: "EMPLOYEE",
    isActive: true,
  });
  console.log(`✅ User created: ${user.email} (role: EMPLOYEE)`);

  // Create Employee profile
  // NOTE: Employee model requires firstName, lastName AND fullName as separate fields
  const employee = await Employee.create({
    user: user._id,
    firstName: SALES_EMPLOYEE.firstName,
    lastName: SALES_EMPLOYEE.lastName,
    fullName: SALES_EMPLOYEE.fullName,
    employeeCode: SALES_EMPLOYEE.employeeCode,
    department: SALES_EMPLOYEE.department,
    designation: SALES_EMPLOYEE.designation,
    employmentType: SALES_EMPLOYEE.employmentType,
    officialEmail: SALES_EMPLOYEE.officialEmail,
    officialMobile: SALES_EMPLOYEE.phone,
    dateOfJoining: SALES_EMPLOYEE.dateOfJoining,
    status: "ACTIVE",
    onboardingStatus: "APPROVED", // Skip onboarding wizard so they can access all modules
    onboardingStep: 0,
  });

  // Link employee back to user
  await User.findByIdAndUpdate(user._id, { employee: employee._id });

  console.log(`✅ Employee profile created: ${employee.fullName} (${employee.employeeCode})`);
  console.log(`   Department: ${employee.department}`);
  console.log(`   Designation: ${employee.designation}`);
  console.log("");
  console.log("────────────────────────────────────────");
  console.log("🎉 Sales employee account created!");
  console.log("");
  console.log("   Login URL:  http://localhost:5173");
  console.log(`   Email:      ${SALES_EMPLOYEE.email}`);
  console.log(`   Password:   ${SALES_EMPLOYEE.password}`);
  console.log("");
  console.log("   This employee can:");
  console.log("   ✅ View all Sales Leads uploaded by Founder/CEO");
  console.log("   ✅ Update lead status (Contacted, Interested, etc.)");
  console.log("   ✅ Click phone numbers to call directly");
  console.log("   ✅ Click emails to send mail");
  console.log("   ✅ Access full employee modules (Attendance, Leave, etc.)");
  console.log("────────────────────────────────────────");

  await mongoose.disconnect();
  console.log("✅ Disconnected. Done!");
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});