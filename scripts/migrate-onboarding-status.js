"use strict";
/**
 * One-time, idempotent backfill for the new Employee.onboardingStatus field
 * (see models/Employee.js and middleware/auth.js requireOnboardingApproved).
 *
 * The schema default for onboardingStatus is NOT_STARTED so brand-new hires
 * are correctly locked out until HR/Admin approves their onboarding. Without
 * this backfill, every employee that already existed before this feature
 * shipped would read as NOT_STARTED too (Mongoose applies the schema default
 * to any document missing the field) and would suddenly find themselves
 * locked out of attendance/leave/payroll/documents — which is exactly the
 * regression this migration prevents.
 *
 * This sets onboardingStatus = APPROVED (and onboardingApprovedAt = now) on
 * every Employee document that does not already have an onboardingStatus
 * value. It never touches a document that already has one, so it is safe to
 * run more than once and safe to run after new hires have started using the
 * onboarding wizard (their in-progress/submitted/approved/rejected status is
 * never overwritten).
 *
 * Run with:
 *   node scripts/migrate-onboarding-status.js
 */
require('dotenv/config');
const mongoose = require('mongoose');
const { Employee } = require('../models/Employee');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dutylaunch-hrms';

async function run() {
    await mongoose.connect(MONGODB_URI);

    const result = await Employee.updateMany(
        { onboardingStatus: { $exists: false } },
        { $set: { onboardingStatus: 'APPROVED', onboardingApprovedAt: new Date() } },
    );

    console.log(`Backfilled onboardingStatus=APPROVED on ${result.modifiedCount} pre-existing employee record(s).`);

    await mongoose.disconnect();
}

run().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});
