"use strict";
const { Router } = require("express");
const _authRoutes = require("./auth");
const _employeeRoutes = require("./employees");
const authRoutes = _authRoutes.default || _authRoutes;
const employeeRoutes = _employeeRoutes.default || _employeeRoutes;

const { authenticate, authorize, requireOnboardingApproved } = require("../middleware/auth");

// Controllers
const dashboardController = require("../controllers/dashboardController");
const leaveController = require("../controllers/leaveController");
const attendanceController = require("../controllers/attendanceController");
const payrollController = require("../controllers/payrollController");
const documentController = require("../controllers/documentController");
const contentController = require("../controllers/contentController");
const notificationController = require("../controllers/notificationController");
const assetController = require("../controllers/assetController");
const taskController = require("../controllers/taskController");
const reportController = require("../controllers/reportController");
const compensationController = require("../controllers/compensationController");
const onboardingProfileController = require("../controllers/onboardingProfileController");
const attendanceRequestController = require("../controllers/attendanceRequestController");
const shiftController = require("../controllers/shiftController");
const trainingController = require("../controllers/trainingController");
const performanceController = require("../controllers/performanceController");
const exitRequestController = require("../controllers/exitRequestController");
const orgSettingsController = require("../controllers/orgSettingsController");
const leadController = require("../controllers/leadController");
const dailyReportController = require("../controllers/dailyReportController");
const appointmentLetterController = require("../controllers/appointmentLetterController");

// Unwrap TS default exports from compiled controllers
function unwrap(m) { return m.default || m; }
const dc = unwrap(dashboardController);
const lc = unwrap(leaveController);
const ac = unwrap(attendanceController);
const pc = unwrap(payrollController);
const docc = unwrap(documentController);
const cc = unwrap(contentController);
const nc = unwrap(notificationController);
const assc = unwrap(assetController);
const tc = unwrap(taskController);
const rc = unwrap(reportController);
const compc = unwrap(compensationController);
const oc = unwrap(onboardingProfileController);
const arc = unwrap(attendanceRequestController);
const sc = unwrap(shiftController);
const trc = unwrap(trainingController);
const perfC = unwrap(performanceController);
const exitC = unwrap(exitRequestController);
const orgC = unwrap(orgSettingsController);

const _upload = require("../middleware/upload");
const upload = _upload.upload || _upload.default || _upload;

const roles = require("../utils/roles");

const HR = roles.HR_ROLES;
const HR_MANAGER = roles.HR_MANAGER_ROLES;
const PAYROLL = roles.PAYROLL_WRITE_ROLES;
const PAYROLL_VIEW = roles.PAYROLL_VIEW_ROLES;
const COMPENSATION_REQUEST = roles.COMPENSATION_REQUESTER_ROLES;
const COMPENSATION_APPROVE = roles.COMPENSATION_APPROVER_ROLES;
const REPORTS = roles.REPORT_ROLES;
const AUDIT = roles.AUDIT_ROLES;

const router = Router();

// ─── Auth & employees ────────────────────────────────────────────────────────
router.use('/auth', authRoutes);
router.use('/employees', employeeRoutes);

// ─── Dashboard ───────────────────────────────────────────────────────────────
router.get('/dashboard/stats', authenticate, dc.getDashboardStats);

// ─── Leave ───────────────────────────────────────────────────────────────────
router.get('/leave/types', authenticate, lc.getLeaveTypes);
router.post('/leave/types', authenticate, authorize(...HR), lc.createLeaveType);
router.patch('/leave/types/:id', authenticate, authorize(...HR), lc.updateLeaveType);
router.get('/leave/stats', authenticate, requireOnboardingApproved(), lc.getLeaveStats);
router.get('/leave/requests', authenticate, requireOnboardingApproved(), lc.getLeaveRequests);
router.post('/leave/requests', authenticate, requireOnboardingApproved(), lc.createLeaveRequest);
router.patch('/leave/requests/:id/approve', authenticate, authorize(...HR_MANAGER), lc.approveLeave);
router.patch('/leave/requests/:id/reject', authenticate, authorize(...HR_MANAGER), lc.rejectLeave);
router.patch('/leave/requests/:id/cancel', authenticate, requireOnboardingApproved(), lc.cancelLeave);
router.get('/leave/balances/me', authenticate, requireOnboardingApproved(), lc.getMyLeaveBalances);
router.get('/leave/balances/:employeeId', authenticate, lc.getLeaveBalances);
router.get('/leave/holidays', authenticate, lc.getHolidays);
router.post('/leave/holidays', authenticate, authorize(...HR), lc.createHoliday);
router.patch('/leave/holidays/:id', authenticate, authorize(...HR), lc.updateHoliday);
router.delete('/leave/holidays/:id', authenticate, authorize(...HR), lc.deleteHoliday);

// ─── Attendance ──────────────────────────────────────────────────────────────
router.get('/attendance', authenticate, requireOnboardingApproved(), ac.getAttendance);
router.get('/attendance/stats', authenticate, requireOnboardingApproved(), ac.getAttendanceStats);
router.get('/attendance/me/today', authenticate, requireOnboardingApproved(), ac.getMyToday);
router.post('/attendance', authenticate, authorize(...HR), ac.markAttendance);
router.post('/attendance/checkin', authenticate, requireOnboardingApproved(), ac.checkIn);
router.post('/attendance/checkout', authenticate, requireOnboardingApproved(), ac.checkOut);
router.patch('/attendance/:id', authenticate, authorize(...HR), ac.updateAttendance);
router.post('/attendance/requests', authenticate, requireOnboardingApproved(), arc.createRequest);
router.get('/attendance/requests', authenticate, authorize(...REPORTS), arc.listRequests);
router.get('/attendance/requests/:id', authenticate, authorize(...REPORTS), arc.getRequest);
router.patch('/attendance/requests/:id/approve', authenticate, authorize(...HR), arc.approveRequest);
router.patch('/attendance/requests/:id/reject', authenticate, authorize(...HR), arc.rejectRequest);
router.get('/shifts', authenticate, sc.listShifts);
router.post('/shifts', authenticate, authorize(...HR), sc.createShift);
router.patch('/shifts/:id', authenticate, authorize(...HR), sc.updateShift);
router.patch('/employees/:id/shift', authenticate, authorize(...HR), sc.assignShift);

// ─── Payroll ─────────────────────────────────────────────────────────────────
router.get('/payroll/summary', authenticate, authorize(...PAYROLL_VIEW), pc.getPayrollSummary);
router.get('/payroll/salary', authenticate, authorize(...PAYROLL_VIEW), pc.listSalaryStructures);
router.get('/payroll/salary/:employeeId', authenticate, requireOnboardingApproved(), pc.getSalaryStructures);
router.post('/payroll/salary/:employeeId', authenticate, authorize(...PAYROLL), pc.createSalaryStructure);
router.get('/payroll/payslips', authenticate, requireOnboardingApproved(), pc.getPayslips);
router.post('/payroll/payslips/generate', authenticate, authorize(...PAYROLL), pc.generatePayslip);
router.post('/payroll/payslips/generate-bulk', authenticate, authorize(...PAYROLL), pc.generatePayslipsBulk);
router.patch('/payroll/payslips/:id/status', authenticate, authorize(...PAYROLL), pc.updatePayslipStatus);
router.get('/payroll/payslips/:id/download', authenticate, requireOnboardingApproved(), pc.downloadPayslip);
router.get('/payroll/compensation-requests', authenticate, authorize(...PAYROLL_VIEW), compc.listRequests);
router.post('/payroll/compensation-requests', authenticate, authorize(...COMPENSATION_REQUEST), compc.createRequest);
router.get('/payroll/compensation-requests/:id', authenticate, authorize(...PAYROLL_VIEW), compc.getRequest);
router.patch('/payroll/compensation-requests/:id/approve', authenticate, authorize(...COMPENSATION_APPROVE), compc.approveRequest);
router.patch('/payroll/compensation-requests/:id/reject', authenticate, authorize(...COMPENSATION_APPROVE), compc.rejectRequest);
router.patch('/payroll/compensation-requests/:id/cancel', authenticate, authorize(...COMPENSATION_REQUEST), compc.cancelRequest);

// ─── Documents ───────────────────────────────────────────────────────────────
router.get('/documents', authenticate, requireOnboardingApproved(), docc.listDocuments);
router.get('/documents/stats', authenticate, docc.getDocumentStats);
router.post('/documents/upload', authenticate, requireOnboardingApproved(), upload.single('file'), docc.uploadDocument);
router.get('/documents/:id/download', authenticate, requireOnboardingApproved(), docc.downloadDocument);
router.patch('/documents/:id/verify', authenticate, authorize(...HR), docc.verifyDocument);
router.patch('/documents/:id/reject', authenticate, authorize(...HR), docc.rejectDocument);
router.patch('/documents/:id/archive', authenticate, authorize(...HR), docc.archiveDocument);
router.get('/employees/:id/documents', authenticate, requireOnboardingApproved(), docc.getDocuments);
router.get('/employees/:id/documents/checklist', authenticate, requireOnboardingApproved(), docc.getDocumentChecklist);
router.get('/employees/:id/identity', authenticate, docc.getIdentityDocuments);
router.post('/employees/:id/identity', authenticate, authorize(...HR), docc.createIdentityDocument);
router.post('/employees/:id/identity/:docType/reveal', authenticate, authorize(...HR), docc.revealIdentityNumber);

// ─── Announcements ───────────────────────────────────────────────────────────
router.get('/announcements', authenticate, cc.getAnnouncements);
router.post('/announcements', authenticate, authorize(...HR), cc.createAnnouncement);
router.patch('/announcements/:id', authenticate, authorize(...HR), cc.updateAnnouncement);
router.delete('/announcements/:id', authenticate, authorize(...HR), cc.deleteAnnouncement);
router.post('/announcements/:id/read', authenticate, cc.markAnnouncementRead);

// ─── Policies ────────────────────────────────────────────────────────────────
router.get('/policies', authenticate, cc.getPolicies);
router.post('/policies', authenticate, authorize(...HR), cc.createPolicy);
router.get('/policies/:id', authenticate, cc.getPolicy);
router.patch('/policies/:id', authenticate, authorize(...HR), cc.updatePolicy);
router.patch('/policies/:id/publish', authenticate, authorize(...HR), cc.publishPolicy);
router.patch('/policies/:id/archive', authenticate, authorize(...HR), cc.archivePolicy);
router.post('/policies/:id/acknowledge', authenticate, cc.acknowledgePolicy);

// ─── Notifications ───────────────────────────────────────────────────────────
router.get('/notifications', authenticate, nc.getNotifications);
router.patch('/notifications/read-all', authenticate, nc.markAllRead);
router.patch('/notifications/:id/read', authenticate, nc.markNotificationRead);

// ─── Audit ───────────────────────────────────────────────────────────────────
router.get('/audit', authenticate, authorize(...AUDIT), nc.getAuditLogs);
router.get('/audit/filters', authenticate, authorize(...AUDIT), nc.getAuditFilters);
router.get('/audit/:id', authenticate, authorize(...AUDIT), nc.getAuditLog);

// ─── Assets ──────────────────────────────────────────────────────────────────
router.get('/assets', authenticate, requireOnboardingApproved(), assc.getAssets);
router.get('/assets/stats', authenticate, assc.getAssetStats);
router.post('/assets', authenticate, authorize(...HR), assc.createAsset);
router.get('/assets/:id', authenticate, requireOnboardingApproved(), assc.getAsset);
router.patch('/assets/:id', authenticate, authorize(...HR), assc.updateAsset);
router.post('/assets/:id/assign', authenticate, authorize(...HR), assc.assignAsset);
router.post('/assets/:id/return', authenticate, authorize(...HR), assc.returnAsset);
router.get('/assets/:id/history', authenticate, requireOnboardingApproved(), assc.getAssetHistory);

// ─── Onboarding ──────────────────────────────────────────────────────────────
router.get('/onboarding', authenticate, tc.getTaskOverview('onboarding'));
router.post('/onboarding', authenticate, authorize(...HR), tc.createTask('onboarding'));
router.get('/onboarding/:employeeId', authenticate, tc.getEmployeeTasks('onboarding'));
router.post('/onboarding/:employeeId/template', authenticate, authorize(...HR), tc.applyTemplate('onboarding'));
router.patch('/onboarding/task/:id', authenticate, tc.updateTask('onboarding'));
router.delete('/onboarding/task/:id', authenticate, authorize(...HR), tc.deleteTask('onboarding'));

// ─── Offboarding ─────────────────────────────────────────────────────────────
router.get('/offboarding', authenticate, requireOnboardingApproved(), tc.getTaskOverview('offboarding'));
router.post('/offboarding', authenticate, authorize(...HR), tc.createTask('offboarding'));
router.get('/offboarding/:employeeId', authenticate, requireOnboardingApproved(), tc.getEmployeeTasks('offboarding'));
router.get('/offboarding/:employeeId/clearance', authenticate, requireOnboardingApproved(), tc.getOffboardingClearance);
router.post('/offboarding/:employeeId/initiate', authenticate, authorize(...HR), tc.initiateOffboarding);
router.post('/offboarding/:employeeId/template', authenticate, authorize(...HR), tc.applyTemplate('offboarding'));
router.patch('/offboarding/task/:id', authenticate, requireOnboardingApproved(), tc.updateTask('offboarding'));
router.delete('/offboarding/task/:id', authenticate, authorize(...HR), tc.deleteTask('offboarding'));

// ─── Employee self-service onboarding ────────────────────────────────────────
router.get('/onboarding-profile/me', authenticate, oc.getMyOnboarding);
router.put('/onboarding-profile/me/step/:stepKey', authenticate, oc.saveOnboardingStep);
router.post('/onboarding-profile/me/submit', authenticate, oc.submitOnboarding);
router.get('/onboarding-profile', authenticate, authorize(...REPORTS), oc.listOnboardingSubmissions);
router.get('/onboarding-profile/:employeeId', authenticate, authorize(...REPORTS), oc.getOnboardingSubmission);
router.patch('/onboarding-profile/:employeeId/approve', authenticate, authorize(...HR), oc.approveOnboarding);
router.patch('/onboarding-profile/:employeeId/reject', authenticate, authorize(...HR), oc.rejectOnboarding);

// ─── Training ────────────────────────────────────────────────────────────────
router.get('/training/stats', authenticate, authorize(...HR), trc.getTrainingStats);
router.get('/training/assignments/me', authenticate, requireOnboardingApproved(), trc.getMyAssignments);
router.patch('/training/assignments/me/:id', authenticate, requireOnboardingApproved(), trc.updateMyAssignment);
router.get('/training', authenticate, authorize(...HR), trc.listTrainings);
router.post('/training', authenticate, authorize(...HR), upload.single('file'), trc.createTraining);
router.get('/training/:id', authenticate, authorize(...HR), trc.getTraining);
router.patch('/training/:id', authenticate, authorize(...HR), upload.single('file'), trc.updateTraining);
router.delete('/training/:id', authenticate, authorize(...HR), trc.deleteTraining);
router.post('/training/:id/assign', authenticate, authorize(...HR), trc.assignTraining);
router.get('/training/:id/assignees', authenticate, authorize(...HR), trc.getTrainingAssignees);
router.get('/training/:id/download', authenticate, requireOnboardingApproved(), trc.downloadTrainingFile);

// ─── Performance Reviews ─────────────────────────────────────────────────────
router.get('/performance-reviews/me', authenticate, requireOnboardingApproved(), perfC.getMyReviews);
router.get('/performance-reviews/stats', authenticate, authorize(...HR), perfC.getPerformanceStats);
router.get('/performance-reviews', authenticate, authorize(...HR), perfC.listReviews);
router.post('/performance-reviews', authenticate, authorize(...HR), perfC.createReview);
router.get('/performance-reviews/:id', authenticate, authorize(...HR), perfC.getReview);
router.patch('/performance-reviews/:id', authenticate, authorize(...HR), perfC.updateReview);
router.patch('/performance-reviews/:id/submit', authenticate, authorize(...HR), perfC.submitReview);
router.patch('/performance-reviews/:id/complete', authenticate, authorize(...HR), perfC.completeReview);
router.delete('/performance-reviews/:id', authenticate, authorize(...HR), perfC.deleteReview);

// ─── Exit requests ───────────────────────────────────────────────────────────
router.post('/exit-requests/me', authenticate, requireOnboardingApproved(), exitC.createExitRequest);
router.get('/exit-requests/me', authenticate, requireOnboardingApproved(), exitC.getMyExitRequests);
router.patch('/exit-requests/me/:id/cancel', authenticate, requireOnboardingApproved(), exitC.cancelExitRequest);
router.get('/exit-requests', authenticate, authorize(...HR_MANAGER), exitC.listExitRequests);
router.get('/exit-requests/:id', authenticate, authorize(...HR_MANAGER), exitC.getExitRequest);
router.patch('/exit-requests/:id/approve', authenticate, authorize(...HR), exitC.approveExitRequest);
router.patch('/exit-requests/:id/reject', authenticate, authorize(...HR), exitC.rejectExitRequest);
router.patch('/exit-requests/:id/complete', authenticate, authorize(...HR), exitC.completeExitRequest);

// ─── Organization settings ───────────────────────────────────────────────────
router.get('/settings', authenticate, authorize(), orgC.getSettings);
router.patch('/settings', authenticate, authorize(), orgC.updateSettings);
router.post('/settings/telegram/test', authenticate, authorize(), orgC.testTelegramNotification);

// ─── Sales Leads ─────────────────────────────────────────────────────────────
// NOTE: specific sub-paths BEFORE /:id to avoid route conflicts
router.post('/leads/preview', authenticate, upload.single('file'), leadController.previewLeads);
router.post('/leads/upload', authenticate, upload.single('file'), leadController.uploadLeads);
router.get('/leads/stats', authenticate, requireOnboardingApproved(), leadController.getLeadStats);
router.get('/leads/batches', authenticate, leadController.getUploadBatches);
router.delete('/leads/batch/:batch', authenticate, leadController.deleteBatch);
router.get('/leads', authenticate, requireOnboardingApproved(), leadController.getLeads);
router.get('/leads/:id', authenticate, requireOnboardingApproved(), leadController.getLead);
router.patch('/leads/:id/status', authenticate, requireOnboardingApproved(), leadController.updateLeadStatus);
router.patch('/leads/:id/assign', authenticate, leadController.reassignLead);
router.post('/leads/:id/reveal', authenticate, requireOnboardingApproved(), leadController.revealLead);

// ─── Daily Reports ───────────────────────────────────────────────────────────
router.get('/daily-reports/stats', authenticate, dailyReportController.getReportStats);
router.get('/daily-reports/me', authenticate, dailyReportController.getMyReports);
router.post('/daily-reports', authenticate, dailyReportController.createReport);
router.get('/daily-reports', authenticate, dailyReportController.getAllReports);
router.get('/daily-reports/:id', authenticate, dailyReportController.getReport);
router.patch('/daily-reports/:id', authenticate, dailyReportController.updateReport);
router.post('/daily-reports/:id/submit', authenticate, dailyReportController.submitReport);
router.post('/daily-reports/:id/review', authenticate, dailyReportController.reviewReport);

// ─── Appointment Letters ─────────────────────────────────────────────────────
router.post('/appointment-letters', authenticate, appointmentLetterController.createLetter);
router.get('/appointment-letters', authenticate, appointmentLetterController.listLetters);
router.get('/appointment-letters/:id', authenticate, appointmentLetterController.getLetter);
router.patch('/appointment-letters/:id', authenticate, appointmentLetterController.updateLetter);
router.post('/appointment-letters/:id/generate', authenticate, appointmentLetterController.generatePDF);
router.get('/appointment-letters/:id/pdf', authenticate, appointmentLetterController.downloadPDF);
// ── Documenso e-signing ──
router.post('/appointment-letters/:id/send-for-signing', authenticate, appointmentLetterController.sendLetterForSigning);
router.post('/appointment-letters/:id/cancel-signing', authenticate, appointmentLetterController.cancelSigning);
// ── Manual status sync (Free plan workaround — no webhooks needed) ──
// HR calls this to pull the latest signing status from Documenso on demand.
router.get('/appointment-letters/:id/sync-status', authenticate, appointmentLetterController.syncSigningStatus);
// ── Documenso Webhook — no authenticate middleware; Documenso calls this directly.
// Secret verification is handled inside documensoWebhook() using DOCUMENSO_WEBHOOK_SECRET.
router.post('/webhooks/documenso', appointmentLetterController.documensoWebhook);

// ─── Reports ─────────────────────────────────────────────────────────────────
router.get('/reports/employees', authenticate, authorize(...REPORTS), rc.getEmployeeReport);
router.get('/reports/attendance', authenticate, authorize(...REPORTS), rc.getAttendanceReport);
router.get('/reports/leave', authenticate, authorize(...REPORTS), rc.getLeaveReport);
router.get('/reports/payroll', authenticate, authorize(...PAYROLL_VIEW, 'AUDITOR'), rc.getPayrollReport);
router.get('/reports/assets', authenticate, authorize(...REPORTS), rc.getAssetReport);
router.get('/reports/lifecycle', authenticate, authorize(...REPORTS), rc.getLifecycleReport);

exports.default = router;
module.exports = router;
module.exports.default = router;