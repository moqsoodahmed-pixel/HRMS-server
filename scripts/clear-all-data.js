"use strict";
/**
 * clear-all-data.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Wipes ALL data from every collection in the DutyLaunch HRMS database,
 * then re-creates the Founder/CEO seed admin account so you can log back in.
 *
 * ⚠️  THIS IS IRREVERSIBLE. Take a backup before running.
 *
 * Usage (from HRMS-server directory):
 *   node scripts/clear-all-data.js
 *
 * Optional: preserve the seed admin automatically (default: YES)
 *   node scripts/clear-all-data.js --no-seed   ← also clears admin user
 */

require("dotenv/config");
const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");
const readline = require("readline");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/dutylaunch-hrms";

// ─── Seed admin restored after wipe ──────────────────────────────────────────
const SEED_ADMIN = {
  email:    process.env.SEED_ADMIN_EMAIL    || "admin@dutylaunch.com",
  password: process.env.SEED_ADMIN_PASSWORD || "Admin@123456",
  role:     "FOUNDER_CEO",
};

// ─── All collections to wipe (mirrors every model in models/) ────────────────
const COLLECTIONS = [
  "appointmentletters",
  "assetonboardings",
  "attendances",
  "attendancerequests",
  "dailyreports",
  "documents",
  "employees",
  "employeeeditRequests",
  "exitrequests",
  "leads",
  "leaves",
  "notificationaudits",
  "orgsettings",
  "payrolls",
  "performancereviews",
  "policyannouncements",
  "shifts",
  "trainings",
  "users",
  // catch-all: any other collections Mongoose may have created
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

function plural(n, word) { return `${n} ${word}${n === 1 ? "" : "s"}`; }

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const noSeed = process.argv.includes("--no-seed");

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║          DutyLaunch HRMS — FULL DATABASE WIPE               ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
  console.log(`  Database : ${MONGODB_URI}`);
  console.log(`  Seed admin will be ${noSeed ? "⚠️  DELETED (--no-seed flag set)" : "✅ re-created after wipe"}`);
  console.log("\n  ⚠️  ALL employees, attendance, payroll, leads, documents,");
  console.log("     assets, leaves, trainings, and user accounts will be");
  console.log("     permanently deleted.\n");

  const confirm = await ask("  Type YES to proceed, anything else to abort: ");
  if (confirm.trim() !== "YES") {
    console.log("\n  Aborted. Nothing was changed.\n");
    process.exit(0);
  }

  console.log("\n  Connecting to MongoDB…");
  await mongoose.connect(MONGODB_URI);
  console.log("  ✅ Connected.\n");

  // Get actual collection names from the DB (catches any extra collections)
  const db         = mongoose.connection.db;
  const existing   = await db.listCollections().toArray();
  const existNames = existing.map((c) => c.name);

  // Build union of known + discovered collection names
  const toWipe = [...new Set([...COLLECTIONS, ...existNames])];

  let totalDeleted = 0;
  console.log("  Wiping collections…");
  for (const col of toWipe) {
    if (!existNames.includes(col)) continue;          // skip if doesn't exist
    const result = await db.collection(col).deleteMany({});
    const n = result.deletedCount;
    totalDeleted += n;
    if (n > 0) console.log(`    ✓ ${col.padEnd(30)} ${plural(n, "document")} deleted`);
    else        console.log(`    – ${col.padEnd(30)} already empty`);
  }

  console.log(`\n  ✅ Wipe complete. ${plural(totalDeleted, "document")} removed across ${toWipe.length} collections.\n`);

  // ── Re-create seed admin ──────────────────────────────────────────────────
  if (!noSeed) {
    console.log("  Re-creating seed admin account…");
    const { User } = require("../models/User");
    const hash = await bcrypt.hash(SEED_ADMIN.password, 12);
    await User.create({
      email:        SEED_ADMIN.email,
      passwordHash: hash,
      role:         SEED_ADMIN.role,
    });
    console.log("  ✅ Seed admin created:");
    console.log(`       Email    : ${SEED_ADMIN.email}`);
    console.log(`       Password : ${SEED_ADMIN.password}`);
    console.log(`       Role     : ${SEED_ADMIN.role}\n`);
    console.log("  ⚠️  Change the password after first login!\n");
  }

  await mongoose.disconnect();
  console.log("  ✅ Disconnected. Fresh start ready!\n");
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});