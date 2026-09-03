"use strict";
/**
 * One-time, idempotent migration onto the FOUNDER_CEO / CTO / DIRECTOR /
 * PROJECT_HEAD role model. Matches existing accounts by officialEmail/email —
 * NEVER by name — and only ever writes role/department/designation/manager.
 * Passwords, employee records and every other field are left untouched.
 * Safe to run more than once: each write is a no-op once the target values
 * already match.
 *
 * NOTE: scripts/reset-demo-organization.js is now the authoritative script
 * for the organization's current shape (exactly 5 employees). The targets
 * below are kept in sync with it purely so this script stays harmless
 * (a no-op) if it is ever re-run; prefer reset-demo-organization.js going forward.
 *
 * This does NOT reseed or clear any collection. Run with:
 *   npm run migrate:rbac-roles
 */
require('dotenv/config');
const mongoose = require('mongoose');
const { User } = require('../models/User');
const { Employee } = require('../models/Employee');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dutylaunch-hrms';

const TARGETS = [
    {
        email: 'moqsood@launcherdesk.com',
        role: 'FOUNDER_CEO',
        designation: 'Founder & CEO',
        department: 'Management',
    },
    {
        email: 'bhojraj@launcherdesk.com',
        role: 'CTO',
        designation: 'CTO / Director',
        department: 'Management',
    },
    {
        email: 'ameena@launcherdesk.com',
        role: 'DIRECTOR',
        designation: 'Director',
        department: 'Management',
    },
    {
        email: 'srinivas@launcherdesk.com',
        role: 'PROJECT_HEAD',
        designation: 'Project Head',
        department: 'Engineering',
    },
];

async function migrateAccount(target) {
    const email = target.email.toLowerCase();
    const employee = await Employee.findOne({ officialEmail: email });
    if (!employee) {
        console.warn(`⚠️  No employee found for ${email} — skipped`);
        return;
    }

    const employeeChanges = {};
    if (employee.designation !== target.designation) employeeChanges.designation = target.designation;
    if (employee.department !== target.department) employeeChanges.department = target.department;
    if (Object.keys(employeeChanges).length) {
        await Employee.updateOne({ _id: employee._id }, { $set: employeeChanges });
        console.log(`✅ Employee ${email}: ${JSON.stringify(employeeChanges)}`);
    } else {
        console.log(`—  Employee ${email}: already up to date`);
    }

    const user = await User.findOne({ email });
    if (!user) {
        console.warn(`⚠️  No user account found for ${email} — role not migrated`);
        return;
    }
    if (user.role !== target.role) {
        const previousRole = user.role;
        await User.updateOne({ _id: user._id }, { $set: { role: target.role } });
        console.log(`✅ User ${email}: role ${previousRole} → ${target.role}`);
    } else {
        console.log(`—  User ${email}: role already ${target.role}`);
    }
}

/**
 * Ravi Chandran (IT Administrator) should report to Srinivas (Head of IT),
 * not Bhojraj — Shruti already reports to Ravi, which keeps her under
 * Srinivas transitively. Matched by officialEmail, never by name for
 * authorization purposes (this is purely fixing the `manager` reference).
 */
async function fixItTeamReportingLine() {
    const srinivas = await Employee.findOne({ officialEmail: 'srinivas@launcherdesk.com' }).select('_id').lean();
    // Matched by department + designation, not by a guessed email pattern —
    // the "IT Administrator" in the IT department is unambiguous either way.
    const ravi = await Employee.findOne({ department: 'IT', designation: 'IT Administrator' }).select('_id officialEmail manager').lean();
    if (!srinivas || !ravi) {
        console.warn('⚠️  Could not verify the IT Administrator → Srinivas reporting line (one or both employees not found) — skipped');
        return;
    }
    if (String(ravi.manager || '') !== String(srinivas._id)) {
        await Employee.updateOne({ _id: ravi._id }, { $set: { manager: srinivas._id } });
        console.log(`✅ Employee ${ravi.officialEmail}: manager → Srinivas (Head of IT)`);
    } else {
        console.log(`—  Employee ${ravi.officialEmail}: manager already Srinivas`);
    }
}

async function migrate() {
    await mongoose.connect(MONGODB_URI);
    console.log(`Connected to ${MONGODB_URI.replace(/\/\/[^@]+@/, '//<credentials>@')}`);

    for (const target of TARGETS) {
        // eslint-disable-next-line no-await-in-loop
        await migrateAccount(target);
    }
    await fixItTeamReportingLine();

    await mongoose.disconnect();
    console.log('Migration complete.');
}

migrate()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Migration failed:', err);
        process.exit(1);
    });
