"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = __importDefault(require("./auth"));
const employees_1 = __importDefault(require("./employees"));
const { authenticate, authorize, requireOnboardingApproved } = require("../middleware/auth");
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
const onboardingProfileController_1 = require("../controllers/onboardingProfileController");
const attendanceRequestController_1 = require("../controllers/attendanceRequestController");
const shiftController_1 = require("../controllers/shiftController");
const trainingController_1 = require("../controllers/trainingController");
const performanceController_1 = require("../controllers/performanceController");
const exitRequestController_1 = require("../controllers/exitRequestController");
const orgSettingsController_1 = require("../controllers/orgSettingsController");
const leadController_1 = require("../controllers/leadController");
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

// Sales leads — any employee in the Sales department can view;
// only Founder/CEO/CTO can upload. The controller enforces the upload gate.
const SALES_ROLES = ['EMPLOYEE', 'MANAGER', 'PROJECT_HEAD', 'HR_ADMIN', 'FINANCE', 'DIRECTOR', 'IT_HEAD'];

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

router.get('/leave/stats', authenticate, requireOnboardingApproved(), leaveController_1.getLeaveStats);
router.get('/leave/requests', authenticate, requireOnboardingApproved(), leaveController_1.getLeaveRequests);
router.post('/leave/requests', authenticate, requireOnboardingApproved(), leaveController_1.createLeaveRequest);
router.patch('/leave/requests/:id/approve', authenticate, authorize(...HR_MANAGER), leaveController_1.approveLeave);
router.patch('/leave/requests/:id/reject', authenticate, authorize(...HR_MANAGER), leaveController_1.rejectLeave);
router.patch('/leave/requests/:id/cancel', authenticate, requireOnboardingApproved(), leaveController_1.cancelLeave);

router.get('/leave/balances/me', authenticate, requireOnboardingApproved(), leaveController_1.getMyLeaveBalances);
router.get('/leave/balances/:employeeId', authenticate, leaveController_1.getLeaveBalances);

router.get('/leave/holidays', authenticate, leaveController_1.getHolidays);
router.post('/leave/holidays', authenticate, authorize(...HR), leaveController_1.createHoliday);
router.patch('/leave/holidays/:id', authenticate, authorize(...HR), leaveController_1.updateHoliday);
router.delete('/leave/holidays/:id', authenticate, authorize(...HR), leaveController_1.deleteHoliday);

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------
router.get('/attendance', authenticate, requireOnboardingApproved(), attendanceController_1.getAttendance);
router.get('/attendance/stats', authenticate, requireOnboardingApproved(), attendanceController_1.getAttendanceStats);
router.get('/attendance/me/today', authenticate, requireOnboardingApproved(), attendanceController_1.getMyToday);
router.post('/attendance', authenticate, authorize(...HR), attendanceController_1.markAttendance);
router.post('/attendance/checkin', authenticate, requireOnboardingApproved(), attendanceController_1.checkIn);
router.post('/attendance/checkout', authenticate, requireOnboardingApproved(), attendanceController_1.checkOut);
router.patch('/attendance/:id', authenticate, authorize(...HR), attendanceController_1.updateAttendance);

router.post('/attendance/requests', authenticate, requireOnboardingApproved(), attendanceRequestController_1.createRequest);
router.get('/attendance/requests', authenticate, authorize(...REPORTS), attendanceRequestController_1.listRequests);
router.get('/attendance/requests/:id', authenticate, authorize(...REPORTS), attendanceRequestController_1.getRequest);
router.patch('/attendance/requests/:id/approve', authenticate, authorize(...HR), attendanceRequestController_1.approveRequest);
router.patch('/attendance/requests/:id/reject', authenticate, authorize(...HR), attendanceRequestController_1.rejectRequest);

router.get('/shifts', authenticate, shiftController_1.listShifts);
router.post('/shifts', authenticate, authorize(...HR), shiftController_1.createShift);
router.patch('/shifts/:id', authenticate, authorize(...HR), shiftController_1.updateShift);
router.patch('/employees/:id/shift', authenticate, authorize(...HR), shiftController_1.assignShift);

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------
router.get('/payroll/summary', authenticate, authorize(...PAYROLL_VIEW), payrollController_1.getPayrollSummary);
router.get('/payroll/salary', authenticate, authorize(...PAYROLL_VIEW), payrollController_1.listSalaryStructures);
router.get('/payroll/salary/:employeeId', authenticate, requireOnboardingApproved(), payrollController_1.getSalaryStructures);
router.post('/payroll/salary/:employeeId', authenticate, authorize(...PAYROLL), payrollController_1.createSalaryStructure);
router.get('/payroll/payslips', authenticate, requireOnboardingApproved(), payrollController_1.getPayslips);
router.post('/payroll/payslips/generate', authenticate, authorize(...PAYROLL), payrollController_1.generatePayslip);
router.post('/payroll/payslips/generate-bulk', authenticate, authorize(...PAYROLL), payrollController_1.generatePayslipsBulk);
router.patch('/payroll/payslips/:id/status', authenticate, authorize(...PAYROLL), payrollController_1.updatePayslipStatus);
router.get('/payroll/payslips/:id/download', authenticate, requireOnboardingApproved(), payrollController_1.downloadPayslip);

router.get('/payroll/compensation-requests', authenticate, authorize(...PAYROLL_VIEW), compensationController_1.listRequests);
router.post('/payroll/compensation-requests', authenticate, authorize(...COMPENSATION_REQUEST), compensationController_1.createRequest);
router.get('/payroll/compensation-requests/:id', authenticate, authorize(...PAYROLL_VIEW), compensationController_1.getRequest);
router.patch('/payroll/compensation-requests/:id/approve', authenticate, authorize(...COMPENSATION_APPROVE), compensationController_1.approveRequest);
router.patch('/payroll/compensation-requests/:id/reject', authenticate, authorize(...COMPENSATION_APPROVE), compensationController_1.rejectRequest);
router.patch('/payroll/compensation-requests/:id/cancel', authenticate, authorize(...COMPENSATION_REQUEST), compensationController_1.cancelRequest);

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
router.get('/documents', authenticate, requireOnboardingApproved(), documentController_1.listDocuments);
router.get('/documents/stats', authenticate, documentController_1.getDocumentStats);
router.post('/documents/upload', authenticate, requireOnboardingApproved(), upload_1.upload.single('file'), documentController_1.uploadDocument);
router.get('/documents/:id/download', authenticate, requireOnboardingApproved(), documentController_1.downloadDocument);
router.patch('/documents/:id/verify', authenticate, authorize(...HR), documentController_1.verifyDocument);
router.patch('/documents/:id/reject', authenticate, authorize(...HR), documentController_1.rejectDocument);
router.patch('/documents/:id/archive', authenticate, authorize(...HR), documentController_1.archiveDocument);
router.get('/employees/:id/documents', authenticate, requireOnboardingApproved(), documentController_1.getDocuments);
router.get('/employees/:id/documents/checklist', authenticate, requireOnboardingApproved(), documentController_1.getDocumentChecklist);

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
router.get('/assets', authenticate, requireOnboardingApproved(), assetController_1.getAssets);
router.get('/assets/stats', authenticate, assetController_1.getAssetStats);
router.post('/assets', authenticate, authorize(...HR), assetController_1.createAsset);
router.get('/assets/:id', authenticate, requireOnboardingApproved(), assetController_1.getAsset);
router.patch('/assets/:id', authenticate, authorize(...HR), assetController_1.updateAsset);
router.post('/assets/:id/assign', authenticate, authorize(...HR), assetController_1.assignAsset);
router.post('/assets/:id/return', authenticate, authorize(...HR), assetController_1.returnAsset);
router.get('/assets/:id/history', authenticate, requireOnboardingApproved(), assetController_1.getAssetHistory);

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------
router.get('/onboarding', authenticate, taskController_1.getTaskOverview('onboarding'));
router.post('/onboarding', authenticate, authorize(...HR), taskController_1.createTask('onboarding'));
router.get('/onboarding/:employeeId', authenticate, taskController_1.getEmployeeTasks('onboarding'));
router.post('/onboarding/:employeeId/template', authenticate, authorize(...HR), taskController_1.applyTemplate('onboarding'));
router.patch('/onboarding/task/:id', authenticate, taskController_1.updateTask('onboarding'));
router.delete('/onboarding/task/:id', authenticate, authorize(...HR), taskController_1.deleteTask('onboarding'));

// ---------------------------------------------------------------------------
// Offboarding
// ---------------------------------------------------------------------------
router.get('/offboarding', authenticate, requireOnboardingApproved(), taskController_1.getTaskOverview('offboarding'));
router.post('/offboarding', authenticate, authorize(...HR), taskController_1.createTask('offboarding'));
router.get('/offboarding/:employeeId', authenticate, requireOnboardingApproved(), taskController_1.getEmployeeTasks('offboarding'));
router.get('/offboarding/:employeeId/clearance', authenticate, requireOnboardingApproved(), taskController_1.getOffboardingClearance);
router.post('/offboarding/:employeeId/initiate', authenticate, authorize(...HR), taskController_1.initiateOffboarding);
router.post('/offboarding/:employeeId/template', authenticate, authorize(...HR), taskController_1.applyTemplate('offboarding'));
router.patch('/offboarding/task/:id', authenticate, requireOnboardingApproved(), taskController_1.updateTask('offboarding'));
router.delete('/offboarding/task/:id', authenticate, authorize(...HR), taskController_1.deleteTask('offboarding'));

// ---------------------------------------------------------------------------
// Employee self-service onboarding wizard
// ---------------------------------------------------------------------------
router.get('/onboarding-profile/me', authenticate, onboardingProfileController_1.getMyOnboarding);
router.put('/onboarding-profile/me/step/:stepKey', authenticate, onboardingProfileController_1.saveOnboardingStep);
router.post('/onboarding-profile/me/submit', authenticate, onboardingProfileController_1.submitOnboarding);
router.get('/onboarding-profile', authenticate, authorize(...REPORTS), onboardingProfileController_1.listOnboardingSubmissions);
router.get('/onboarding-profile/:employeeId', authenticate, authorize(...REPORTS), onboardingProfileController_1.getOnboardingSubmission);
router.patch('/onboarding-profile/:employeeId/approve', authenticate, authorize(...HR), onboardingProfileController_1.approveOnboarding);
router.patch('/onboarding-profile/:employeeId/reject', authenticate, authorize(...HR), onboardingProfileController_1.rejectOnboarding);

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------
router.get('/training/stats', authenticate, authorize(...HR), trainingController_1.getTrainingStats);
router.get('/training/assignments/me', authenticate, requireOnboardingApproved(), trainingController_1.getMyAssignments);
router.patch('/training/assignments/me/:id', authenticate, requireOnboardingApproved(), trainingController_1.updateMyAssignment);
router.get('/training', authenticate, authorize(...HR), trainingController_1.listTrainings);
router.post('/training', authenticate, authorize(...HR), upload_1.upload.single('file'), trainingController_1.createTraining);
router.get('/training/:id', authenticate, authorize(...HR), trainingController_1.getTraining);
router.patch('/training/:id', authenticate, authorize(...HR), upload_1.upload.single('file'), trainingController_1.updateTraining);
router.delete('/training/:id', authenticate, authorize(...HR), trainingController_1.deleteTraining);
router.post('/training/:id/assign', authenticate, authorize(...HR), trainingController_1.assignTraining);
router.get('/training/:id/assignees', authenticate, authorize(...HR), trainingController_1.getTrainingAssignees);
router.get('/training/:id/download', authenticate, requireOnboardingApproved(), trainingController_1.downloadTrainingFile);

// ---------------------------------------------------------------------------
// Performance Reviews
// ---------------------------------------------------------------------------
router.get('/performance-reviews/me', authenticate, requireOnboardingApproved(), performanceController_1.getMyReviews);
router.get('/performance-reviews/stats', authenticate, authorize(...HR), performanceController_1.getPerformanceStats);
router.get('/performance-reviews', authenticate, authorize(...HR), performanceController_1.listReviews);
router.post('/performance-reviews', authenticate, authorize(...HR), performanceController_1.createReview);
router.get('/performance-reviews/:id', authenticate, authorize(...HR), performanceController_1.getReview);
router.patch('/performance-reviews/:id', authenticate, authorize(...HR), performanceController_1.updateReview);
router.patch('/performance-reviews/:id/submit', authenticate, authorize(...HR), performanceController_1.submitReview);
router.patch('/performance-reviews/:id/complete', authenticate, authorize(...HR), performanceController_1.completeReview);
router.delete('/performance-reviews/:id', authenticate, authorize(...HR), performanceController_1.deleteReview);

// ---------------------------------------------------------------------------
// Exit requests
// ---------------------------------------------------------------------------
router.post('/exit-requests/me', authenticate, requireOnboardingApproved(), exitRequestController_1.createExitRequest);
router.get('/exit-requests/me', authenticate, requireOnboardingApproved(), exitRequestController_1.getMyExitRequests);
router.patch('/exit-requests/me/:id/cancel', authenticate, requireOnboardingApproved(), exitRequestController_1.cancelExitRequest);
router.get('/exit-requests', authenticate, authorize(...HR_MANAGER), exitRequestController_1.listExitRequests);
router.get('/exit-requests/:id', authenticate, authorize(...HR_MANAGER), exitRequestController_1.getExitRequest);
router.patch('/exit-requests/:id/approve', authenticate, authorize(...HR), exitRequestController_1.approveExitRequest);
router.patch('/exit-requests/:id/reject', authenticate, authorize(...HR), exitRequestController_1.rejectExitRequest);
router.patch('/exit-requests/:id/complete', authenticate, authorize(...HR), exitRequestController_1.completeExitRequest);

// ---------------------------------------------------------------------------
// Organization settings
// ---------------------------------------------------------------------------
router.get('/settings', authenticate, authorize(), orgSettingsController_1.getSettings);
router.patch('/settings', authenticate, authorize(), orgSettingsController_1.updateSettings);
router.post('/settings/telegram/test', authenticate, authorize(), orgSettingsController_1.testTelegramNotification);

// ---------------------------------------------------------------------------
// Sales Leads — Founder/CEO uploads CSV/Excel; Sales team views leads.
// Upload is elevated-only (controller double-checks). Viewing is open to all
// authenticated employees so every sales rep can see their call list.
// ---------------------------------------------------------------------------
router.post('/leads/upload', authenticate, upload_1.upload.single('file'), leadController_1.uploadLeads);
router.get('/leads', authenticate, requireOnboardingApproved(), leadController_1.getLeads);
router.patch('/leads/:id/status', authenticate, requireOnboardingApproved(), leadController_1.updateLeadStatus);
router.get('/leads/batches', authenticate, leadController_1.getUploadBatches);
router.delete('/leads/batch/:batch', authenticate, leadController_1.deleteBatch);

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