"use strict";
/**
 * Resets the demo organization down to exactly 5 employees:
 *   Moqsood (FOUNDER_CEO), Ameena (DIRECTOR), Bhojraj (CTO),
 *   Srinivas (PROJECT_HEAD), Jeevan (EMPLOYEE).
 *
 * Everyone else — every other Employee/User record and every piece of
 * employee-specific data belonging to them (attendance, leave, payroll,
 * documents, tasks, notifications, ...) — is deleted. Data belonging to the
 * 5 kept employees is left untouched. Audit logs are never touched (the app
 * treats them as an immutable historical record by design).
 *
 * Matches everyone by officialEmail/email — NEVER by anything else. Safe to
 * re-run: it always resolves the keeper set fresh from the DB by email, and
 * deletions of an already-empty set are no-ops.
 *
 * Run with: node scripts/reset-demo-organization.js
 */
require('dotenv/config');
const mongoose = require('mongoose');
const { User } = require('../models/User');
const { Employee } = require('../models/Employee');
const { Attendance } = require('../models/Attendance');
const { LeaveRequest, LeaveBalance } = require('../models/Leave');
const { SalaryStructure, Payslip, CompensationRequest } = require('../models/Payroll');
const { EmployeeDocument, IdentityDocument } = require('../models/Document');
const { Asset, AssetAssignment, OnboardingTask, OffboardingTask } = require('../models/AssetOnboarding');
const { Notification } = require('../models/NotificationAudit');
const { Announcement, AnnouncementRead, PolicyAcknowledgement } = require('../models/PolicyAnnouncement');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dutylaunch-hrms';

const KEEPERS = [
    { email: 'moqsood@launcherdesk.com', role: 'FOUNDER_CEO', designation: 'Founder / CEO', department: 'Management' },
    { email: 'ameena@launcherdesk.com', role: 'DIRECTOR', designation: 'Director', department: 'Management' },
    { email: 'bhojraj@launcherdesk.com', role: 'CTO', designation: 'CTO / Director', department: 'Management' },
    { email: 'srinivas@launcherdesk.com', role: 'PROJECT_HEAD', designation: 'Project Head', department: 'Engineering' },
    { email: 'jeevan@launcherdesk.com', role: 'EMPLOYEE', designation: 'Trainee', department: 'Engineering' },
];

async function upsertKeepers() {
    const byEmail = {};
    for (const k of KEEPERS) {
        const email = k.email.toLowerCase();
        let employee = await Employee.findOne({ officialEmail: email });
        if (!employee) {
            throw new Error(`Required employee ${email} does not exist — refusing to fabricate a brand-new record for a named person. Create it manually first if this is truly a fresh install.`);
        }
        const changes = {};
        if (employee.designation !== k.designation) changes.designation = k.designation;
        if (employee.department !== k.department) changes.department = k.department;
        if (Object.keys(changes).length) {
            await Employee.updateOne({ _id: employee._id }, { $set: changes });
            console.log(`✅ Employee ${email}: ${JSON.stringify(changes)}`);
        } else {
            console.log(`—  Employee ${email}: designation/department already correct`);
        }

        let user = await User.findOne({ email });
        if (!user) {
            throw new Error(`Required user ${email} does not exist — refusing to fabricate credentials for a named person. Create it manually (with a hashed password) first.`);
        }
        if (user.role !== k.role) {
            const prev = user.role;
            await User.updateOne({ _id: user._id }, { $set: { role: k.role } });
            console.log(`✅ User ${email}: role ${prev} → ${k.role}`);
        } else {
            console.log(`—  User ${email}: role already ${k.role}`);
        }

        employee = await Employee.findOne({ officialEmail: email }).select('_id').lean();
        user = await User.findOne({ email }).select('_id').lean();
        byEmail[email] = { employeeId: employee._id, userId: user._id };
    }

    // Jeevan reports to Srinivas.
    const jeevan = byEmail['jeevan@launcherdesk.com'];
    const srinivas = byEmail['srinivas@launcherdesk.com'];
    const jeevanDoc = await Employee.findById(jeevan.employeeId).select('manager').lean();
    if (String(jeevanDoc.manager || '') !== String(srinivas.employeeId)) {
        await Employee.updateOne({ _id: jeevan.employeeId }, { $set: { manager: srinivas.employeeId } });
        console.log('✅ Employee jeevan@launcherdesk.com: manager → Srinivas (Project Head)');
    } else {
        console.log('—  Employee jeevan@launcherdesk.com: manager already Srinivas');
    }
    // Leadership has no manager of their own.
    for (const email of ['moqsood@launcherdesk.com', 'ameena@launcherdesk.com', 'bhojraj@launcherdesk.com', 'srinivas@launcherdesk.com']) {
        await Employee.updateOne({ _id: byEmail[email].employeeId }, { $unset: { manager: '' } });
    }

    return byEmail;
}

async function reset() {
    await mongoose.connect(MONGODB_URI);
    console.log(`Connected to ${MONGODB_URI.replace(/\/\/[^@]+@/, '//<credentials>@')}`);

    const byEmail = await upsertKeepers();
    const keepEmployeeIds = Object.values(byEmail).map((v) => v.employeeId);
    const keepUserIds = Object.values(byEmail).map((v) => v.userId);
    const keepEmails = KEEPERS.map((k) => k.email.toLowerCase());

    const deleteEmployees = await Employee.find({ _id: { $nin: keepEmployeeIds } }).select('_id').lean();
    const deleteEmployeeIds = deleteEmployees.map((e) => e._id);
    const deleteUsers = await User.find({ email: { $nin: keepEmails } }).select('_id').lean();
    const deleteUserIds = deleteUsers.map((u) => u._id);

    console.log(`\nEmployees to delete: ${deleteEmployeeIds.length}`);
    console.log(`Users to delete: ${deleteUserIds.length}`);

    if (deleteEmployeeIds.length === 0 && deleteUserIds.length === 0) {
        console.log('\nNothing to delete — organization is already reduced to the 5 keepers.');
    } else {
        const empScope = { employee: { $in: deleteEmployeeIds } };

        const results = {};
        results.Attendance = await Attendance.deleteMany(empScope);
        results.LeaveRequest = await LeaveRequest.deleteMany(empScope);
        results.LeaveBalance = await LeaveBalance.deleteMany(empScope);
        results.SalaryStructure = await SalaryStructure.deleteMany(empScope);
        results.Payslip = await Payslip.deleteMany(empScope);
        results.CompensationRequest = await CompensationRequest.deleteMany(empScope);
        results.EmployeeDocument = await EmployeeDocument.deleteMany(empScope);
        results.IdentityDocument = await IdentityDocument.deleteMany(empScope);
        results.OnboardingTask = await OnboardingTask.deleteMany(empScope);
        results.OffboardingTask = await OffboardingTask.deleteMany(empScope);
        results.PolicyAcknowledgement = await PolicyAcknowledgement.deleteMany(empScope);
        results.AnnouncementRead = await AnnouncementRead.deleteMany(empScope);
        results.Notification = await Notification.deleteMany({ user: { $in: deleteUserIds } });

        // Assets: unassign (never delete the physical inventory record) rather
        // than destroy company asset records; delete the assignment *history*
        // rows that reference a now-deleted employee.
        const unassignRes = await Asset.updateMany(
            { assignedTo: { $in: deleteEmployeeIds } },
            { $set: { status: 'AVAILABLE' }, $unset: { assignedTo: '', assignedAt: '' } },
        );
        results['Asset (unassigned)'] = unassignRes;
        results.AssetAssignment = await AssetAssignment.deleteMany({ employee: { $in: deleteEmployeeIds } });

        // Remove dangling references to deleted employees from SPECIFIC-targeted announcements.
        const announcementPull = await Announcement.updateMany(
            { targetEmployees: { $in: deleteEmployeeIds } },
            { $pull: { targetEmployees: { $in: deleteEmployeeIds } } },
        );
        results['Announcement (targetEmployees pulled)'] = announcementPull;

        for (const [name, res] of Object.entries(results)) {
            console.log(`  ${name}: ${res.deletedCount ?? res.modifiedCount ?? 0} affected`);
        }

        const userDel = await User.deleteMany({ _id: { $in: deleteUserIds } });
        console.log(`  User: ${userDel.deletedCount} deleted`);
        const empDel = await Employee.deleteMany({ _id: { $in: deleteEmployeeIds } });
        console.log(`  Employee: ${empDel.deletedCount} deleted`);
    }

    const finalEmployees = await Employee.find({}).select('employeeCode fullName officialEmail designation department manager').sort({ employeeCode: 1 }).lean();
    const finalUsers = await User.find({}).select('email role isActive').sort({ email: 1 }).lean();
    console.log(`\nFinal employee count: ${finalEmployees.length}`);
    finalEmployees.forEach((e) => console.log(`  ${e.employeeCode} | ${e.fullName} | ${e.officialEmail} | ${e.designation} | ${e.department} | manager: ${e.manager || '-'}`));
    console.log(`Final user count: ${finalUsers.length}`);
    finalUsers.forEach((u) => console.log(`  ${u.email} | ${u.role} | active: ${u.isActive}`));

    await mongoose.disconnect();
    console.log('\nReset complete.');
}

reset()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Reset failed:', err);
        process.exit(1);
    });
