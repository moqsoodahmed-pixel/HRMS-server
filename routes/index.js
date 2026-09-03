"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = __importDefault(require("./auth"));
const employees_1 = __importDefault(require("./employees"));
const { authenticate, authorize } = require("../middleware/auth");
const dashboardController_1 = require("../controllers/dashboardController");
const leaveController_1 = require("../controllers/leaveController");
const attendanceController_1 = require("../controllers/attendanceController");
const payrollController_1 = require("../controllers/payrollController");
const documentController_1 = require("../controllers/documentController");
const contentController_1 = require("../controllers/contentController");
const notificationController_1 = require("../controllers/notificationController");
const assetController_1 = require("../controllers/assetController");
const taskController_1 = require("../controllers/taskController");
const reportController_1 = require("../controllers/reportController");
const compensationController_1 = require("../controllers/compensationController");
const upload_1 = require("../middleware/upload");
const roles_1 = require("../utils/roles");

const router = (0, express_1.Router)();

// Role groups come from utils/roles.js — the one place an elevated role
// (SUPER_ADMIN, CTO) is ever enumerated. `authorize()` also lets any elevated
// role through regardless of what is listed here; these names are kept for
// readability at each call site.
const HR = roles_1.HR_ROLES;
const HR_MANAGER = roles_1.HR_MANAGER_ROLES;
const PAYROLL = roles_1.PAYROLL_WRITE_ROLES;
const PAYROLL_VIEW = roles_1.PAYROLL_VIEW_ROLES;
const COMPENSATION_REQUEST = roles_1.COMPENSATION_REQUESTER_ROLES;
const COMPENSATION_APPROVE = roles_1.COMPENSATION_APPROVER_ROLES;
const REPORTS = roles_1.REPORT_ROLES;
const AUDIT = roles_1.AUDIT_ROLES;

// ---------------------------------------------------------------------------
// Auth & employees
// ---------------------------------------------------------------------------
router.use('/auth', auth_1.default);
router.use('/employees', employees_1.default);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
router.get('/dashboard/stats', authenticate, dashboardController_1.getDashboardStats);

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------
router.get('/leave/types', authenticate, leaveController_1.getLeaveTypes);
router.post('/leave/types', authenticate, authorize(...HR), leaveController_1.createLeaveType);
router.patch('/leave/types/:id', authenticate, authorize(...HR), leaveController_1.updateLeaveType);

router.get('/leave/stats', authenticate, leaveController_1.getLeaveStats);
router.get('/leave/requests', authenticate, leaveController_1.getLeaveRequests);
router.post('/leave/requests', authenticate, leaveController_1.createLeaveRequest);
router.patch('/leave/requests/:id/approve', authenticate, authorize(...HR_MANAGER), leaveController_1.approveLeave);
router.patch('/leave/requests/:id/reject', authenticate, authorize(...HR_MANAGER), leaveController_1.rejectLeave);
// Cancellation is owner-or-HR; the controller enforces that.
router.patch('/leave/requests/:id/cancel', authenticate, leaveController_1.cancelLeave);

router.get('/leave/balances/me', authenticate, leaveController_1.getMyLeaveBalances);
router.get('/leave/balances/:employeeId', authenticate, leaveController_1.getLeaveBalances);

router.get('/leave/holidays', authenticate, leaveController_1.getHolidays);
router.post('/leave/holidays', authenticate, authorize(...HR), leaveController_1.createHoliday);
router.delete('/leave/holidays/:id', authenticate, authorize(...HR), leaveController_1.deleteHoliday);

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------
router.get('/attendance', authenticate, attendanceController_1.getAttendance);
router.get('/attendance/stats', authenticate, attendanceController_1.getAttendanceStats);
router.get('/attendance/me/today', authenticate, attendanceController_1.getMyToday);
router.post('/attendance', authenticate, authorize(...HR), attendanceController_1.markAttendance);
router.post('/attendance/checkin', authenticate, attendanceController_1.checkIn);
router.post('/attendance/checkout', authenticate, attendanceController_1.checkOut);
router.patch('/attendance/:id', authenticate, authorize(...HR), attendanceController_1.updateAttendance);

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------
router.get('/payroll/summary', authenticate, authorize(...PAYROLL_VIEW), payrollController_1.getPayrollSummary);
router.get('/payroll/salary', authenticate, authorize(...PAYROLL_VIEW), payrollController_1.listSalaryStructures);
router.get('/payroll/salary/:employeeId', authenticate, payrollController_1.getSalaryStructures);
router.post('/payroll/salary/:employeeId', authenticate, authorize(...PAYROLL), payrollController_1.createSalaryStructure);
router.get('/payroll/payslips', authenticate, payrollController_1.getPayslips);
router.post('/payroll/payslips/generate', authenticate, authorize(...PAYROLL), payrollController_1.generatePayslip);
router.post('/payroll/payslips/generate-bulk', authenticate, authorize(...PAYROLL), payrollController_1.generatePayslipsBulk);
router.patch('/payroll/payslips/:id/status', authenticate, authorize(...PAYROLL), payrollController_1.updatePayslipStatus);
router.get('/payroll/payslips/:id/download', authenticate, payrollController_1.downloadPayslip);

// Compensation change requests — HR requests, only SUPER_ADMIN/CTO may approve.
// This is the ONLY path by which HR_ADMIN can influence a salary/allowance
// change; there is no HR-accessible endpoint that writes to SalaryStructure directly.
router.get('/payroll/compensation-requests', authenticate, authorize(...PAYROLL_VIEW), compensationController_1.listRequests);
router.post('/payroll/compensation-requests', authenticate, authorize(...COMPENSATION_REQUEST), compensationController_1.createRequest);
router.get('/payroll/compensation-requests/:id', authenticate, authorize(...PAYROLL_VIEW), compensationController_1.getRequest);
router.patch('/payroll/compensation-requests/:id/approve', authenticate, authorize(...COMPENSATION_APPROVE), compensationController_1.approveRequest);
router.patch('/payroll/compensation-requests/:id/reject', authenticate, authorize(...COMPENSATION_APPROVE), compensationController_1.rejectRequest);
router.patch('/payroll/compensation-requests/:id/cancel', authenticate, authorize(...COMPENSATION_REQUEST), compensationController_1.cancelRequest);

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
router.get('/documents', authenticate, documentController_1.listDocuments);
router.get('/documents/stats', authenticate, documentController_1.getDocumentStats);
// Not HR-only: an employee may upload their own required documents. The
// controller enforces that a non-admin can only upload for their own record.
router.post('/documents/upload', authenticate, upload_1.upload.single('file'), documentController_1.uploadDocument);
router.get('/documents/:id/download', authenticate, documentController_1.downloadDocument);
router.patch('/documents/:id/verify', authenticate, authorize(...HR), documentController_1.verifyDocument);
router.patch('/documents/:id/reject', authenticate, authorize(...HR), documentController_1.rejectDocument);
router.patch('/documents/:id/archive', authenticate, authorize(...HR), documentController_1.archiveDocument);
router.get('/employees/:id/documents', authenticate, documentController_1.getDocuments);
router.get('/employees/:id/documents/checklist', authenticate, documentController_1.getDocumentChecklist);

// Identity documents (encrypted at rest, revealed only with an audit trail)
router.get('/employees/:id/identity', authenticate, documentController_1.getIdentityDocuments);
router.post('/employees/:id/identity', authenticate, authorize(...HR), documentController_1.createIdentityDocument);
router.post('/employees/:id/identity/:docType/reveal', authenticate, authorize(...HR), documentController_1.revealIdentityNumber);

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------
router.get('/announcements', authenticate, contentController_1.getAnnouncements);
router.post('/announcements', authenticate, authorize(...HR), contentController_1.createAnnouncement);
router.patch('/announcements/:id', authenticate, authorize(...HR), contentController_1.updateAnnouncement);
router.delete('/announcements/:id', authenticate, authorize(...HR), contentController_1.deleteAnnouncement);
router.post('/announcements/:id/read', authenticate, contentController_1.markAnnouncementRead);

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------
router.get('/policies', authenticate, contentController_1.getPolicies);
router.post('/policies', authenticate, authorize(...HR), contentController_1.createPolicy);
router.get('/policies/:id', authenticate, contentController_1.getPolicy);
router.patch('/policies/:id', authenticate, authorize(...HR), contentController_1.updatePolicy);
router.patch('/policies/:id/publish', authenticate, authorize(...HR), contentController_1.publishPolicy);
router.patch('/policies/:id/archive', authenticate, authorize(...HR), contentController_1.archivePolicy);
router.post('/policies/:id/acknowledge', authenticate, contentController_1.acknowledgePolicy);

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
router.get('/notifications', authenticate, notificationController_1.getNotifications);
router.patch('/notifications/read-all', authenticate, notificationController_1.markAllRead);
router.patch('/notifications/:id/read', authenticate, notificationController_1.markNotificationRead);

// ---------------------------------------------------------------------------
// Audit (read-only, restricted)
// ---------------------------------------------------------------------------
router.get('/audit', authenticate, authorize(...AUDIT), notificationController_1.getAuditLogs);
router.get('/audit/filters', authenticate, authorize(...AUDIT), notificationController_1.getAuditFilters);
router.get('/audit/:id', authenticate, authorize(...AUDIT), notificationController_1.getAuditLog);

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
router.get('/assets', authenticate, assetController_1.getAssets);
router.get('/assets/stats', authenticate, assetController_1.getAssetStats);
router.post('/assets', authenticate, authorize(...HR), assetController_1.createAsset);
router.get('/assets/:id', authenticate, assetController_1.getAsset);
router.patch('/assets/:id', authenticate, authorize(...HR), assetController_1.updateAsset);
router.post('/assets/:id/assign', authenticate, authorize(...HR), assetController_1.assignAsset);
router.post('/assets/:id/return', authenticate, authorize(...HR), assetController_1.returnAsset);
router.get('/assets/:id/history', authenticate, assetController_1.getAssetHistory);

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------
router.get('/onboarding', authenticate, taskController_1.getTaskOverview('onboarding'));
router.post('/onboarding', authenticate, authorize(...HR), taskController_1.createTask('onboarding'));
router.get('/onboarding/:employeeId', authenticate, taskController_1.getEmployeeTasks('onboarding'));
router.post('/onboarding/:employeeId/template', authenticate, authorize(...HR), taskController_1.applyTemplate('onboarding'));
// Employees may move their own tasks along; the controller limits what they can change.
router.patch('/onboarding/task/:id', authenticate, taskController_1.updateTask('onboarding'));
router.delete('/onboarding/task/:id', authenticate, authorize(...HR), taskController_1.deleteTask('onboarding'));

// ---------------------------------------------------------------------------
// Offboarding
// ---------------------------------------------------------------------------
router.get('/offboarding', authenticate, taskController_1.getTaskOverview('offboarding'));
router.post('/offboarding', authenticate, authorize(...HR), taskController_1.createTask('offboarding'));
router.get('/offboarding/:employeeId', authenticate, taskController_1.getEmployeeTasks('offboarding'));
router.get('/offboarding/:employeeId/clearance', authenticate, taskController_1.getOffboardingClearance);
router.post('/offboarding/:employeeId/initiate', authenticate, authorize(...HR), taskController_1.initiateOffboarding);
router.post('/offboarding/:employeeId/template', authenticate, authorize(...HR), taskController_1.applyTemplate('offboarding'));
router.patch('/offboarding/task/:id', authenticate, taskController_1.updateTask('offboarding'));
router.delete('/offboarding/task/:id', authenticate, authorize(...HR), taskController_1.deleteTask('offboarding'));

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
router.get('/reports/employees', authenticate, authorize(...REPORTS), reportController_1.getEmployeeReport);
router.get('/reports/attendance', authenticate, authorize(...REPORTS), reportController_1.getAttendanceReport);
router.get('/reports/leave', authenticate, authorize(...REPORTS), reportController_1.getLeaveReport);
router.get('/reports/payroll', authenticate, authorize(...PAYROLL_VIEW, 'AUDITOR'), reportController_1.getPayrollReport);
router.get('/reports/assets', authenticate, authorize(...REPORTS), reportController_1.getAssetReport);
router.get('/reports/lifecycle', authenticate, authorize(...REPORTS), reportController_1.getLifecycleReport);

exports.default = router;
