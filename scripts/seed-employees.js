"use strict";
/**
 * seed-employees.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Bulk-creates User + Employee records for all DutyLaunch team members.
 *
 * Password rule: firstname (lowercase) + @launcherdesk2026
 *   e.g.  Moqsood Ahmed Abdul  →  moqsood@launcherdesk2026
 *         Faiqha sheikh        →  faiqha@launcherdesk2026
 *
 * Usage (from HRMS-server directory):
 *   node scripts/seed-employees.js
 *
 * Safe to re-run — skips any email/code that already exists.
 *
 * ─── ROLE REFERENCE ──────────────────────────────────────────────────────────
 *  FOUNDER_CEO  │ PROJECT_HEAD  │ CTO         │ DIRECTOR
 *  HR_ADMIN     │ FINANCE       │ MANAGER     │ EMPLOYEE
 *  IT_HEAD      │ AUDITOR       │ SUPER_ADMIN
 * ─────────────────────────────────────────────────────────────────────────────
 */

require("dotenv/config");
const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

const { User }     = require("../models/User");
const { Employee } = require("../models/Employee");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/dutylaunch-hrms";

// ─── Helper: first word of full name, lowercase ───────────────────────────────
function makePassword(fullName) {
  const first = fullName.trim().split(/\s+/)[0].toLowerCase();
  return `${first}@launcherdesk2026`;
}

// ─── Helper: split full name into parts ──────────────────────────────────────
function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0];
  const lastName  = parts.length > 1 ? parts.slice(1).join(" ") : ".";
  return { firstName, lastName };
}

// ─── Employee master data ─────────────────────────────────────────────────────
// Add / remove rows here. Columns:
//   employeeCode, fullName, email, role, designation, department, dateOfJoining, workLocation
const EMPLOYEES = [
  {
    employeeCode: "DL001",
    fullName:     "Moqsood Ahmed Abdul",
    email:        "moqsood@launcherdesk.com",
    role:         "FOUNDER_CEO",
    designation:  "Founder & CEO",
    department:   "Management",
    dateOfJoining:"2025-12-01",
    workLocation: "Bengaluru HQ",
  },
  {
    employeeCode: "DL002",
    fullName:     "Santhosh Kolar Ramesh",
    email:        "contact@launcherdesk.com",
    role:         "DIRECTOR",
    designation:  "COO",
    department:   "Management",
    dateOfJoining:"2025-12-01",
    workLocation: "Bengaluru HQ",
  },
  {
    employeeCode: "DL003",
    fullName:     "Junaid Khan",
    email:        "junaid@launcherdesk.com",
    role:         "DIRECTOR",
    designation:  "Director",
    department:   "Management",
    dateOfJoining:"2025-12-01",
    workLocation: "Bengaluru HQ",
  },
  {
    employeeCode: "DL004",
    fullName:     "Umme Saani",
    email:        "umme@launcherdesk.com",
    role:         "EMPLOYEE",
    designation:  "Developer",
    department:   "Engineering",
    dateOfJoining:"2025-12-01",
    workLocation: "Bengaluru HQ",
  },
  {
    employeeCode: "DL005",
    fullName:     "Ameena Nikhath",
    email:        "ameena@launcherdesk.com",
    role:         "DIRECTOR",
    designation:  "Director",
    department:   "Management",
    dateOfJoining:"2026-01-11",
    workLocation: "Bengaluru HQ",
  },
  {
    employeeCode: "DL006",
    fullName:     "Akash Pani",
    email:        "akash@launcherdesk.com",
    role:         "EMPLOYEE",
    designation:  "Junior Accounts Executive",
    department:   "Finance",
    dateOfJoining:"2026-07-26",
    workLocation: "Bengaluru HQ",
  },
  {
    employeeCode: "DL007",
    fullName:     "Bhojraj R",
    email:        "bhojaraj@launcherdesk.com",
    role:         "CTO",
    designation:  "CTO",
    department:   "Engineering",
    dateOfJoining:"2026-09-01",
    workLocation: "Bengaluru HQ",
  },
  {
    employeeCode: "DL008",
    fullName:     "Srinivas Sutar",
    email:        "srinivas@launcherdesk.com",
    role:         "PROJECT_HEAD",
    designation:  "Project Head",
    department:   "Engineering",
    dateOfJoining:"2026-08-16",
    workLocation: "Bengaluru HQ",
  },
  {
    employeeCode: "DL009",
    fullName:     "Jeevan Majjigi",
    email:        "jeevan@launcherdesk.com",
    role:         "EMPLOYEE",
    designation:  "Full Stack Trainee",
    department:   "Engineering",
    dateOfJoining:"2026-08-20",
    workLocation: "Bengaluru HQ",
  },
  {
    employeeCode: "DL010",
    fullName:     "Faiqha Shaikh",
    email:        "faiqha@launcherdesk.com",
    role:         "EMPLOYEE",
    designation:  "Sales Executive",
    department:   "Sales",
    dateOfJoining:"2026-09-01",
    workLocation: "Bengaluru HQ",
  },
  {
    employeeCode: "DL011",
    fullName:     "Chandu BG",
    email:        "chandu@launcherdesk.com",
    role:         "EMPLOYEE",
    designation:  "Backend Trainee",
    department:   "Engineering",
    dateOfJoining:"2026-09-02",
    workLocation: "Bengaluru HQ",
  },
  {
    employeeCode: "DL012",
    fullName:     "Abhishek Jidge",
    email:        "abhishek@launcherdesk.com",
    role:         "EMPLOYEE",
    designation:  "Tester & Frontend Dev",
    department:   "Engineering",
    dateOfJoining:"2026-09-05",
    workLocation: "Bengaluru HQ",
  },
  {
    employeeCode: "DL013",
    fullName:     "A Joseph",
    email:        "joseph@launcherdesk.com",
    role:         "MANAGER",
    designation:  "Admin Manager",
    department:   "Operations",
    dateOfJoining:"2026-09-02",
    workLocation: "Bengaluru HQ",
  },
  {
    employeeCode: "DL014",
    fullName:     "Ayesha Siddiqua",
    email:        "ayesha@launcherdesk.com",
    role:         "EMPLOYEE",
    designation:  "Business Development Executive",
    department:   "Sales",
    dateOfJoining:"2026-09-08",
    workLocation: "Bengaluru HQ",
  },
  {
    employeeCode: "DL015",
    fullName:     "V M Prahalya",
    email:        "prahalya@launcherdesk.com",
    role:         "HR_ADMIN",
    designation:  "HR Executive",
    department:   "HR",
    dateOfJoining:"2026-09-10",
    workLocation: "Bengaluru HQ",
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║       DutyLaunch HRMS — Bulk Employee Seeder                ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  await mongoose.connect(MONGODB_URI);
  console.log(`✅ Connected: ${MONGODB_URI}\n`);

  let created = 0, skipped = 0;

  for (const emp of EMPLOYEES) {
    const password = makePassword(emp.fullName);
    const { firstName, lastName } = splitName(emp.fullName);

    // Skip if email already exists
    const existingUser = await User.findOne({ email: emp.email.toLowerCase() });
    if (existingUser) {
      console.log(`⏭  SKIP  ${emp.employeeCode}  ${emp.fullName.padEnd(25)} — email already exists`);
      skipped++;
      continue;
    }

    // Skip if employee code already exists
    const existingEmp = await Employee.findOne({ employeeCode: emp.employeeCode });
    if (existingEmp) {
      console.log(`⏭  SKIP  ${emp.employeeCode}  ${emp.fullName.padEnd(25)} — employee code already exists`);
      skipped++;
      continue;
    }

    try {
      const hash = await bcrypt.hash(password, 12);

      // 1. Create User account
      const user = await User.create({
        email:    emp.email.toLowerCase(),
        password: hash,
        role:     emp.role,
        isActive: true,
      });

      // 2. Create Employee profile
      const employee = await Employee.create({
        user:             user._id,
        firstName,
        lastName,
        fullName:         emp.fullName,
        employeeCode:     emp.employeeCode,
        officialEmail:    emp.email.toLowerCase(),
        designation:      emp.designation,
        department:       emp.department,
        dateOfJoining:    new Date(emp.dateOfJoining),
        workLocation:     emp.workLocation || "Bengaluru HQ",
        employmentType:   "FULL_TIME",
        status:           "ACTIVE",
        onboardingStatus: "APPROVED",
        onboardingStep:   0,
      });

      // 3. Link employee back to user
      await User.findByIdAndUpdate(user._id, { employee: employee._id });

      console.log(`✅ CREATED ${emp.employeeCode}  ${emp.fullName.padEnd(25)}  ${emp.role.padEnd(15)}  pwd: ${password}`);
      created++;

    } catch (err) {
      console.error(`❌ ERROR   ${emp.employeeCode}  ${emp.fullName} — ${err.message}`);
    }
  }

  console.log("\n──────────────────────────────────────────────────────────────");
  console.log(`  ✅ Created : ${created}`);
  console.log(`  ⏭  Skipped : ${skipped}`);
  console.log(`  Total     : ${EMPLOYEES.length}`);
  console.log("──────────────────────────────────────────────────────────────\n");
  console.log("  Password format: firstname@launcherdesk2026");
  console.log("  e.g. Abhishek Jidge → abhishek@launcherdesk2026\n");

  await mongoose.disconnect();
  console.log("✅ Done!\n");
}

main().catch((err) => {
  console.error("\n❌ Fatal:", err.message);
  process.exit(1);
});