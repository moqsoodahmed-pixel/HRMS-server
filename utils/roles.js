"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

/**
 * Central role-group definitions. This is the ONLY place that should ever
 * enumerate roles for authorization purposes — controllers and routes import
 * these groups instead of writing their own `['SUPER_ADMIN', ...]` arrays, so
 * a role's effective power is defined in one place and can never drift.
 *
 * ELEVATED_ROLES is the platform-administrator tier: FOUNDER_CEO and CTO have
 * identical, full effective power everywhere in the system (Bhojraj/CTO is
 * never a lesser copy of Moqsood/FOUNDER_CEO). SUPER_ADMIN is kept here only
 * for backward compatibility with any pre-migration accounts/tokens — new
 * elevated accounts use FOUNDER_CEO. Nothing here (or anywhere downstream)
 * ever checks a name or email — only the stored `role` field decides.
 */
const ELEVATED_ROLES = ['FOUNDER_CEO', 'CTO', 'SUPER_ADMIN'];

/**
 * DIRECTOR is a company-wide, READ-ONLY tier: full visibility into every
 * department and module, zero write/approve/manage power anywhere. It is
 * deliberately left out of every *_ROLES group that guards a write, approve
 * or manage route (HR_ROLES, PAYROLL_WRITE_ROLES, COMPENSATION_*_ROLES,
 * LEAVE_APPROVER_ROLES, CONTENT_ADMIN_ROLES, ...) so `authorize()` rejects it
 * with 403 there, and only ever added to the view-only groups below
 * (PAYROLL_VIEW_ROLES, REPORT_ROLES, AUDIT_ROLES, ACTIVITY_FEED_ROLES).
 */
const DIRECTOR_ROLES = ['DIRECTOR'];

/**
 * Roles whose employee/record visibility is restricted to their own
 * department (see utils/helpers.js resolveEmployeeScope, which reads this
 * list). Authorization here is always role + the caller's own linked
 * Employee.department — never a name, email or client-supplied filter.
 */
const DEPARTMENT_SCOPED_ROLES = ['IT_HEAD'];

/**
 * Roles whose employee/record visibility is restricted to themselves plus
 * their direct reports (see utils/helpers.js resolveEmployeeScope, which
 * reads this list and walks Employee.manager — never a name or email).
 * PROJECT_HEAD is a centralized, reusable role for anyone leading a project
 * team without company-wide administrative power — it is deliberately never
 * added to HR_ROLES, PAYROLL_*_ROLES, COMPENSATION_*_ROLES, CONTENT_ADMIN_ROLES
 * or AUDIT_ROLES, so it can never reach unrestricted company administration,
 * payroll administration, or global audit access.
 */
const TEAM_SCOPED_ROLES = ['MANAGER', 'PROJECT_HEAD'];

const HR_ROLES = [...ELEVATED_ROLES, 'HR_ADMIN', 'PROJECT_HEAD'];
const HR_MANAGER_ROLES = [...HR_ROLES, ...TEAM_SCOPED_ROLES];
const FINANCE_ROLES = [...ELEVATED_ROLES, 'FINANCE'];
// View-only payroll access additionally includes DIRECTOR (read-only company
// payroll). IT_HEAD/PROJECT_HEAD/MANAGER are deliberately never added here —
// no team- or department-head role gets company payroll access.
const PAYROLL_VIEW_ROLES = [...ELEVATED_ROLES, 'HR_ADMIN', 'FINANCE', 'DIRECTOR'];
// Direct salary/allowance writes: the elevated tier, FINANCE, and HR_ADMIN.
// HR administers day-to-day payroll operations here (entering a salary
// structure, generating/reissuing payslips) — this is HR's own operational
// data entry, not a pay-RATE decision. Changing what someone's salary
// actually IS still only ever happens through the separate compensation
// request/approval workflow below (COMPENSATION_REQUESTER/APPROVER_ROLES),
// where HR can request a change but only FOUNDER_CEO/CTO can approve it —
// that separation-of-duties check is untouched by this list.
const PAYROLL_WRITE_ROLES = [...ELEVATED_ROLES, 'FINANCE', 'HR_ADMIN'];
// Only the platform-administrator tier may approve or reject a compensation
// change — this is the enforcement point for "HR can request, only
// FOUNDER_CEO/CTO can approve."
const COMPENSATION_APPROVER_ROLES = [...ELEVATED_ROLES];
const COMPENSATION_REQUESTER_ROLES = [...ELEVATED_ROLES, 'HR_ADMIN'];
// Audit visibility: the platform-administrator tier, AUDITOR, and DIRECTOR
// (read-only oversight). IT_HEAD/PROJECT_HEAD/HR_ADMIN are deliberately
// excluded — none of those roles has a company-wide audit requirement.
const AUDIT_ROLES = [...ELEVATED_ROLES, 'AUDITOR', 'DIRECTOR'];
// IT_HEAD/PROJECT_HEAD get scoped reports (employees/attendance/leave/assets/
// lifecycle, narrowed to their resolveEmployeeScope() — never payroll, which
// is gated separately by PAYROLL_VIEW_ROLES and does not include either
// role). reportController applies that same scope regardless of what the
// client's query string requests.
const REPORT_ROLES = [...ELEVATED_ROLES, 'HR_ADMIN', 'FINANCE', 'AUDITOR', 'DIRECTOR', 'IT_HEAD', ...TEAM_SCOPED_ROLES];
const CONTENT_ADMIN_ROLES = [...HR_ROLES];
const LEAVE_APPROVER_ROLES = [...HR_ROLES, ...TEAM_SCOPED_ROLES];
const ACTIVITY_FEED_ROLES = [...ELEVATED_ROLES, 'HR_ADMIN', 'AUDITOR', 'DIRECTOR'];

/**
 * Roles exempt from BOTH the mobile-device login restriction and the
 * office-geo-fencing login restriction (see services/accessControlService.js,
 * wired into controllers/authController.js login()). Per spec this is "CEO,
 * CTO, Project Head" — mapped onto this schema's actual role names:
 * FOUNDER_CEO (the CEO), CTO, and PROJECT_HEAD. SUPER_ADMIN is included
 * alongside them because utils/roles.js already documents it as a
 * backward-compatible, functionally-identical stand-in for FOUNDER_CEO on
 * pre-migration accounts — never because of a name/email, only the role
 * enum value. This list is deliberately separate from ELEVATED_ROLES (which
 * governs RBAC route access, not device/location policy) so device/location
 * exemption can never silently change if ELEVATED_ROLES is ever edited for
 * an unrelated reason.
 */
const DEVICE_LOCATION_EXEMPT_ROLES = [...ELEVATED_ROLES, 'PROJECT_HEAD'];

/**
 * Roles that must NOT appear in, or be counted by, the attendance "absent"
 * views — leadership who are not expected to clock in/out day to day, so
 * counting them as "absent" is meaningless and (per the reported issue)
 * makes the dashboard's Absent-Today number look wrong. Per the request this
 * is "Project Head, CTO, Director, CEO / Founder": FOUNDER_CEO (+ SUPER_ADMIN,
 * its documented backward-compatible equivalent), CTO, PROJECT_HEAD and
 * DIRECTOR. Built on DEVICE_LOCATION_EXEMPT_ROLES (which already omits daily
 * check-in for these leaders) plus DIRECTOR, and kept as its own list so
 * "who is hidden from Absent" can never silently drift from the RBAC groups
 * above. Excludes an employee from BOTH the dashboard Absent-Today count
 * (dashboardController) AND the drill-down list (attendanceController
 * getAbsentees), so the number and the names always match.
 */
const ATTENDANCE_EXEMPT_ROLES = [...DEVICE_LOCATION_EXEMPT_ROLES, 'DIRECTOR'];

/**
 * Roles allowed to grant a Temporary Remote Work Access exception (see
 * models/RemoteWorkApproval.js / controllers/remoteWorkController.js) that
 * bypasses geo-fencing for a specific employee during a specific date range.
 * Per spec: "HR, CEO, CTO, Project Head". ELEVATED_ROLES already covers
 * CEO/CTO/SUPER_ADMIN; HR_ADMIN and PROJECT_HEAD are added explicitly.
 */
const REMOTE_WORK_APPROVER_ROLES = [...ELEVATED_ROLES, 'HR_ADMIN', 'PROJECT_HEAD'];

/**
 * Roles allowed to reach the performance-review management routes. The
 * company-wide reviewers (HR_ROLES = elevated + HR_ADMIN + PROJECT_HEAD) plus
 * MANAGER — a MANAGER (a Sales Team Lead, per the chosen design) is admitted
 * at the route here but then hard-scoped INSIDE performanceController to only
 * their own direct reports (resolveReviewableScope / assertReviewableSubject),
 * so a team lead can review their team and no one else. This is deliberately
 * its own group rather than adding MANAGER to HR_ROLES, which would wrongly
 * hand a team lead company-wide HR/payroll/content powers everywhere else.
 */
const PERFORMANCE_MANAGE_ROLES = [...HR_ROLES, 'MANAGER'];

/** True when `role` carries platform-administrator (FOUNDER_CEO-equivalent) power. */
function isElevated(role) {
    return ELEVATED_ROLES.includes(role);
}

/** True when `role` is elevated or explicitly listed in `roles`. */
function isAuthorized(role, roles) {
    return isElevated(role) || roles.includes(role);
}

/** True when `role` is the company-wide, view-only tier (DIRECTOR). */
function isReadOnly(role) {
    return DIRECTOR_ROLES.includes(role);
}

/** True when `role`'s visibility is restricted to its own department. */
function isDepartmentScoped(role) {
    return DEPARTMENT_SCOPED_ROLES.includes(role);
}

/** True when `role`'s visibility is restricted to itself plus direct reports. */
function isTeamScoped(role) {
    return TEAM_SCOPED_ROLES.includes(role);
}

/** True when `role` is exempt from mobile-device and geo-fencing login restrictions. */
function isDeviceLocationExempt(role) {
    return DEVICE_LOCATION_EXEMPT_ROLES.includes(role);
}

/** True when `role` is hidden from the attendance "absent" count and list (leadership). */
function isAttendanceExempt(role) {
    return ATTENDANCE_EXEMPT_ROLES.includes(role);
}

module.exports = {
    ELEVATED_ROLES,
    DIRECTOR_ROLES,
    DEPARTMENT_SCOPED_ROLES,
    TEAM_SCOPED_ROLES,
    HR_ROLES,
    HR_MANAGER_ROLES,
    FINANCE_ROLES,
    PAYROLL_VIEW_ROLES,
    PAYROLL_WRITE_ROLES,
    COMPENSATION_APPROVER_ROLES,
    COMPENSATION_REQUESTER_ROLES,
    AUDIT_ROLES,
    REPORT_ROLES,
    CONTENT_ADMIN_ROLES,
    LEAVE_APPROVER_ROLES,
    ACTIVITY_FEED_ROLES,
    DEVICE_LOCATION_EXEMPT_ROLES,
    ATTENDANCE_EXEMPT_ROLES,
    REMOTE_WORK_APPROVER_ROLES,
    PERFORMANCE_MANAGE_ROLES,
    isElevated,
    isAuthorized,
    isReadOnly,
    isDepartmentScoped,
    isTeamScoped,
    isDeviceLocationExempt,
    isAttendanceExempt,
};