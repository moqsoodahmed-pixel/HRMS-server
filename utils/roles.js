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

const HR_ROLES = [...ELEVATED_ROLES, 'HR_ADMIN'];
const HR_MANAGER_ROLES = [...HR_ROLES, ...TEAM_SCOPED_ROLES];
const FINANCE_ROLES = [...ELEVATED_ROLES, 'FINANCE'];
// View-only payroll access additionally includes DIRECTOR (read-only company
// payroll). IT_HEAD/PROJECT_HEAD/MANAGER are deliberately never added here —
// no team- or department-head role gets company payroll access.
const PAYROLL_VIEW_ROLES = [...ELEVATED_ROLES, 'HR_ADMIN', 'FINANCE', 'DIRECTOR'];
// Direct salary/allowance writes stay with the roles that already had them
// (the elevated tier and FINANCE, who process payroll). HR_ADMIN never
// appears here — a compensation change from HR always goes through the
// request/approval workflow instead. See compensationController.
const PAYROLL_WRITE_ROLES = [...ELEVATED_ROLES, 'FINANCE'];
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
    isElevated,
    isAuthorized,
    isReadOnly,
    isDepartmentScoped,
    isTeamScoped,
};
