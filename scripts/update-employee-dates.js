"use strict";
/**
 * update-employee-dates.js
 * ────────────────────────────────────────────────────────────────────────────
 * Updates employee joining dates, statuses and exit dates based on the
 * official employee register.
 *
 * Usage (from HRMS-server directory):
 *   node scripts/update-employee-dates.js
 *
 * Safe to re-run — uses updateOne with the employee code as key.
 */

require("dotenv/config");
const mongoose = require("mongoose");
const { Employee } = require("../models/Employee");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/dutylaunch-hrms";

// ─── Employee master data from the official register ─────────────────────────
// status: ACTIVE | INACTIVE
// dateOfExit: set only for INACTIVE employees
const EMPLOYEES = [
  {
    employeeCode: "DL001",
    fullName:     "Moqsood Ahmed Abdul",
    dateOfJoining:"2025-12-01",
    status:       "ACTIVE",
    dateOfExit:   null,
  },
  {
    employeeCode: "DL002",
    fullName:     "Santhosh Kolar Ramesh",
    dateOfJoining:"2025-12-01",
    status:       "INACTIVE",
    dateOfExit:   "2026-01-11",
  },
  {
    employeeCode: "DL003",
    fullName:     "Junaid Khan",
    dateOfJoining:"2025-12-01",
    status:       "INACTIVE",
    dateOfExit:   "2026-01-11",
  },
  {
    employeeCode: "DL004",
    fullName:     "Umme Saani",
    dateOfJoining:"2025-12-01",
    status:       "INACTIVE",
    dateOfExit:   "2026-01-11",
  },
  {
    employeeCode: "DL005",
    fullName:     "Ameena Nikhath",
    dateOfJoining:"2026-01-11",
    status:       "ACTIVE",
    dateOfExit:   null,
  },
  {
    employeeCode: "DL006",
    fullName:     "Akash Pani",
    dateOfJoining:"2026-07-26",
    status:       "INACTIVE",
    dateOfExit:   "2026-08-10",
  },
  {
    employeeCode: "DL007",
    fullName:     "Bhojraj R",
    dateOfJoining:"2026-09-01",
    status:       "ACTIVE",
    dateOfExit:   null,
  },
  {
    employeeCode: "DL008",
    fullName:     "Srinivas Sutar",
    dateOfJoining:"2026-08-16",
    status:       "ACTIVE",
    dateOfExit:   null,
  },
  {
    employeeCode: "DL009",
    fullName:     "Jeevan Majjigi",
    dateOfJoining:"2026-08-20",
    status:       "ACTIVE",
    dateOfExit:   null,
  },
  {
    employeeCode: "DL010",
    fullName:     "Faiqha Shaikh",
    dateOfJoining:"2026-09-01",
    status:       "ACTIVE",
    dateOfExit:   null,
  },
  {
    employeeCode: "DL011",
    fullName:     "Chandu BG",
    dateOfJoining:"2026-09-02",
    status:       "ACTIVE",
    dateOfExit:   null,
  },
  {
    employeeCode: "DL012",
    fullName:     "Abhishek Jidge",
    dateOfJoining:"2026-09-05",
    status:       "ACTIVE",
    dateOfExit:   null,
  },
  {
    employeeCode: "DL013",
    fullName:     "A Joseph",
    dateOfJoining:"2026-09-02",
    status:       "ACTIVE",
    dateOfExit:   null,
  },
  {
    employeeCode: "DL014",
    fullName:     "Ayesha Siddiqua",
    dateOfJoining:"2026-09-08",
    status:       "ACTIVE",
    dateOfExit:   null,
  },
  {
    employeeCode: "DL015",
    fullName:     "V M Prahalya",
    dateOfJoining:"2026-09-10",
    status:       "ACTIVE",
    dateOfExit:   null,
  },
];

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║     DutyLaunch HRMS — Update Employee Dates & Status        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  await mongoose.connect(MONGODB_URI);
  console.log(`✅ Connected: ${MONGODB_URI}\n`);

  let updated = 0, notFound = 0;

  for (const emp of EMPLOYEES) {
    const update = {
      dateOfJoining: new Date(emp.dateOfJoining),
      status:        emp.status,
    };

    if (emp.dateOfExit) {
      update.dateOfExit = new Date(emp.dateOfExit);
    } else {
      // Clear any previously set exit date
      update.$unset = { dateOfExit: 1 };
    }

    const result = await Employee.updateOne(
      { employeeCode: emp.employeeCode },
      emp.dateOfExit
        ? { $set: update }
        : { $set: { dateOfJoining: update.dateOfJoining, status: update.status }, $unset: { dateOfExit: 1 } }
    );

    if (result.matchedCount === 0) {
      console.log(`⚠️  NOT FOUND  ${emp.employeeCode}  ${emp.fullName}`);
      notFound++;
    } else {
      const joinStr = emp.dateOfJoining;
      const exitStr = emp.dateOfExit ? `  exit: ${emp.dateOfExit}` : '';
      console.log(`✅ UPDATED    ${emp.employeeCode}  ${emp.fullName.padEnd(25)}  ${emp.status.padEnd(10)}  joined: ${joinStr}${exitStr}`);
      updated++;
    }
  }

  console.log("\n──────────────────────────────────────────────────────────────");
  console.log(`  ✅ Updated  : ${updated}`);
  console.log(`  ⚠️  Not found: ${notFound}`);
  console.log("──────────────────────────────────────────────────────────────\n");

  await mongoose.disconnect();
  console.log("✅ Done!\n");
}

main().catch((err) => {
  console.error("\n❌ Fatal:", err.message);
  process.exit(1);
});