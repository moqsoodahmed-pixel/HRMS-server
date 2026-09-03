"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

/**
 * Central role-group definitions. This is the ONLY place that should ever
 * enumerate roles for authorization purposes — controllers and routes import
 * these groups instead of writing their own `['SUPER_ADMIN', ...]` arrays, so
 * a role's effective power is defined in one place and can never drift.
 *
 * ELEVATED_ROLES is the platform-administrator tier: SUPER_ADMIN plus any
 * role that has been granted the same effective power (currently just CTO,
 * per the "Bhojraj has SUPER_ADMIN-equivalent access" business rule). Nothing
 * here ever checks a name or email — only the stored `role` field decides.
 */
const ELEVATED_ROLES = ['SUPER_ADMIN', 'CTO'];
const HR_ROLES = [...ELEVATED_ROLES, 'HR_ADMIN'];
const HR_MANAGER_ROLES = [...HR_ROLES, 'MANAGER'];
const FINANCE_ROLES = [...ELEVATED_ROLES, 'FINANCE'];
const PAYROLL_VIEW_ROLES = [...ELEVATED_ROLES, 'HR_ADMIN', 'FINANCE'];
// Direct salary/allowance writes stay with the roles that already had them
// (SUPER_ADMIN/CTO and FINANCE, who process payroll). HR_ADMIN never appears
// here — a compensation change from HR always goes through the request/
// approval workflow instead. See compensationController.
const PAYROLL_WRITE_ROLES = [...ELEVATED_ROLES, 'FINANCE'];
// Only the platform-administrator tier may approve or reject a compensation
// change — this is the enforcement point for "HR can request, only
// SUPER_ADMIN/CTO can approve."
const COMPENSATION_APPROVER_ROLES = [...ELEVATED_ROLES];
const COMPENSATION_REQUESTER_ROLES = [...ELEVATED_ROLES, 'HR_ADMIN'];
const AUDIT_ROLES = [...ELEVATED_ROLES, 'AUDITOR'];
const REPORT_ROLES = [...ELEVATED_ROLES, 'HR_ADMIN', 'FINANCE', 'MANAGER', 'AUDITOR'];
const CONTENT_ADMIN_ROLES = [...HR_ROLES];
const LEAVE_APPROVER_ROLES = [...HR_ROLES, 'MANAGER'];
const ACTIVITY_FEED_ROLES = [...ELEVATED_ROLES, 'HR_ADMIN', 'AUDITOR'];

/** True when `role` carries platform-administrator (SUPER_ADMIN-equivalent) power. */
function isElevated(role) {
    return ELEVATED_ROLES.includes(role);
}

/** True when `role` is elevated or explicitly listed in `roles`. */
function isAuthorized(role, roles) {
    return isElevated(role) || roles.includes(role);
}

module.exports = {
    ELEVATED_ROLES,
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
};
