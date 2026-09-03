/**
 * One-time patch: replace ad-hoc role arrays in controllers with imports
 * from the central utils/roles.js module, so CTO (and any future elevated
 * role) is automatically included everywhere without scattering checks.
 */
const fs = require('fs');
const path = require('path');
const C = path.join(__dirname, '..', 'controllers');

function patch(file, requireLine, subs) {
  const p = path.join(C, file);
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes(requireLine)) {
    // Insert after the last existing require/import line at the top of the file.
    const lines = s.split('\n');
    let lastRequire = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/^const .* = require\(/.test(lines[i])) lastRequire = i;
    }
    lines.splice(lastRequire + 1, 0, requireLine);
    s = lines.join('\n');
  }
  for (const [old, nw] of subs) {
    if (!s.includes(old)) { console.error(`MISS in ${file}: ${old.slice(0, 90)}`); process.exit(1); }
    s = s.split(old).join(nw);
  }
  fs.writeFileSync(p, s);
  console.log('patched', file);
}

patch('contentController.js',
  "const roles_1 = require(\"../utils/roles\");",
  [
    ["const CONTENT_ADMIN_ROLES = ['SUPER_ADMIN', 'HR_ADMIN'];\nexports.CONTENT_ADMIN_ROLES = CONTENT_ADMIN_ROLES;",
     "const CONTENT_ADMIN_ROLES = roles_1.CONTENT_ADMIN_ROLES;\nexports.CONTENT_ADMIN_ROLES = CONTENT_ADMIN_ROLES;"],
  ]);

patch('dashboardController.js',
  "const roles_1 = require(\"../utils/roles\");",
  [
    ["const PAYROLL_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'FINANCE'];",
     "const PAYROLL_ROLES = roles_1.PAYROLL_VIEW_ROLES;"],
    ["const ACTIVITY_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'AUDITOR'];",
     "const ACTIVITY_ROLES = roles_1.ACTIVITY_FEED_ROLES;"],
  ]);

patch('documentController.js',
  "const roles_1 = require(\"../utils/roles\");",
  [
    ["    if (['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user?.role)) return;",
     "    if (roles_1.HR_ROLES.includes(req.user?.role)) return;"],
    ["        if (!['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user?.role || '')) {",
     "        if (!roles_1.HR_ROLES.includes(req.user?.role || '')) {"],
  ]);

patch('leaveController.js',
  "const roles_1 = require(\"../utils/roles\");",
  [
    ["const APPROVER_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'];",
     "const APPROVER_ROLES = roles_1.LEAVE_APPROVER_ROLES;"],
    ["            && ['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user?.role);",
     "            && roles_1.HR_ROLES.includes(req.user?.role);"],
    ["    const canFileForOthers = ['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user?.role);",
     "    const canFileForOthers = roles_1.HR_ROLES.includes(req.user?.role);"],
    ["    if (['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user?.role)) return;",
     "    if (roles_1.HR_ROLES.includes(req.user?.role)) return;"],
    ["        const isAdmin = ['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user?.role);",
     "        const isAdmin = roles_1.HR_ROLES.includes(req.user?.role);"],
  ]);

patch('payrollController.js',
  "const roles_1 = require(\"../utils/roles\");",
  [
    ["const PAYROLL_VIEW_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'FINANCE'];\nexports.PAYROLL_VIEW_ROLES = PAYROLL_VIEW_ROLES;",
     "const PAYROLL_VIEW_ROLES = roles_1.PAYROLL_VIEW_ROLES;\nexports.PAYROLL_VIEW_ROLES = PAYROLL_VIEW_ROLES;"],
  ]);

patch('taskController.js',
  "const roles_1 = require(\"../utils/roles\");",
  [
    ["const ADMIN_ROLES = ['SUPER_ADMIN', 'HR_ADMIN'];",
     "const ADMIN_ROLES = roles_1.HR_ROLES;"],
  ]);
