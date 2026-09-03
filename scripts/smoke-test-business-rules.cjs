/**
 * Business-rule smoke test for the CTO / compensation-approval / document-
 * checklist / leave-consistency update. Complements scripts/smoke-test.cjs,
 * which covers the original module surface — this file only covers what is
 * NEW or CHANGED by this update.
 *
 *   node scripts/smoke-test-business-rules.cjs [baseUrl]
 */
const BASE = process.argv[2] || 'http://localhost:5000';
const API = `${BASE}/api`;

let passed = 0;
let failed = 0;
const failures = [];

function record(ok, label, detail) {
  if (ok) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; failures.push(`${label} — ${detail}`); console.log(`  FAIL ${label} — ${detail}`); }
}

function makeSession() { return { cookie: '' }; }

async function call(session, method, path, body) {
  const headers = {};
  if (session.cookie) headers.cookie = session.cookie;
  let payload = body;
  if (body !== undefined && body !== null && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, { method, headers, body: payload, redirect: 'manual' });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookie) if (c.startsWith('token=')) session.cookie = c.split(';')[0];
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

async function expect(label, session, method, path, body, check) {
  try {
    const res = await call(session, method, path, body);
    const problem = check(res);
    record(!problem, label, problem || '');
    return res;
  } catch (err) { record(false, label, err.message); return { status: 0, data: null }; }
}

const ok = (res) => (res.status >= 200 && res.status < 300 ? null : `expected 2xx, got ${res.status} ${JSON.stringify(res.data)?.slice(0, 160)}`);
const status = (want) => (res) => (res.status === want ? null : `expected ${want}, got ${res.status} ${JSON.stringify(res.data)?.slice(0, 160)}`);
const okAnd = (fn) => (res) => ok(res) || fn(res);

async function login(email, password) {
  const session = makeSession();
  const res = await call(session, 'POST', '/auth/login', { email, password, rememberMe: true });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.data)}`);
  session.user = res.data.data.user;
  session.employee = res.data.data.employee;
  return session;
}

async function run() {
  const ADMIN_PW = process.env.SEED_ADMIN_PASSWORD || 'Admin@123456';
  const EMP_PW = process.env.SEED_EMPLOYEE_PASSWORD || 'Employee@123456';

  const admin = await login('admin@launcherdesk.com', ADMIN_PW);
  const cto = await login('bhojraj@launcherdesk.com', EMP_PW);
  const hr = await login('hr@launcherdesk.com', ADMIN_PW);
  const finance = await login('finance@launcherdesk.com', ADMIN_PW);
  const manager = await login('srinivas@launcherdesk.com', EMP_PW);
  const employee = await login('jeevan@launcherdesk.com', EMP_PW);
  const auditor = await login('auditor@launcherdesk.com', ADMIN_PW);

  record(cto.user.role === 'CTO', 'Bhojraj logs in with role CTO (not disguised as SUPER_ADMIN)', `got ${cto.user.role}`);

  console.log('\n--- CTO elevated permissions ---');
  await expect('CTO can list employees org-wide', cto, 'GET', '/employees?limit=50', null, okAnd((r) => (r.data.data.length > 1 ? null : 'CTO appears scoped like an EMPLOYEE')));
  await expect('CTO can access payroll salary listing (SUPER_ADMIN-only route)', cto, 'GET', '/payroll/salary?limit=5', null, ok);
  await expect('CTO can access the audit log', cto, 'GET', '/audit?limit=5', null, ok);
  await expect('CTO can create a leave type (HR/admin-only route)', cto, 'POST', '/leave/types', { name: 'CTO Smoke Leave', code: `CS${Date.now().toString().slice(-4)}`, maxDaysPerYear: 3 }, ok);
  await expect('CTO can create an announcement (HR/admin-only route)', cto, 'POST', '/announcements', { title: 'CTO smoke announcement', description: 'Verifying elevated access works end to end.' }, ok);

  console.log('\n--- Compensation change workflow ---');
  const staff = await call(admin, 'GET', '/employees/options');
  const candidate = staff.data.data.managers.find((m) => !['Bhojraj R', 'Ameena Nikhath', 'Moqsood Ahmed Abdul'].includes(m.fullName));

  // Give the candidate a known baseline structure so the math in the test is deterministic.
  await call(admin, 'POST', `/payroll/salary/${candidate._id}`, {
    effectiveFrom: '2026-01-01', basic: 50000, hra: 20000, da: 5000, specialAllowance: 5000, otherAllowances: 0,
    pf: 1800, esi: 0, tds: 0, otherDeductions: 0,
  });

  await expect('HR_ADMIN cannot directly write a salary structure', hr, 'POST', `/payroll/salary/${candidate._id}`, {
    effectiveFrom: '2026-02-01', basic: 999999, hra: 0, da: 0, specialAllowance: 0, otherAllowances: 0, pf: 0, esi: 0, tds: 0, otherDeductions: 0,
  }, status(403));

  const beforeStructures = await call(admin, 'GET', `/payroll/salary/${candidate._id}`);
  const activeBefore = beforeStructures.data.data.find((s) => s.isActive);
  record(activeBefore.basic === 50000, 'salary is unchanged after the blocked HR write attempt', `basic is ${activeBefore.basic}`);

  await expect('EMPLOYEE cannot create a compensation request', employee, 'POST', '/payroll/compensation-requests', { employeeId: candidate._id, proposedBasic: 60000, reason: 'Should be rejected' }, status(403));
  await expect('MANAGER cannot create a compensation request', manager, 'POST', '/payroll/compensation-requests', { employeeId: candidate._id, proposedBasic: 60000, reason: 'Should be rejected' }, status(403));

  const created = await expect('HR_ADMIN can create a compensation request', hr, 'POST', '/payroll/compensation-requests', {
    employeeId: candidate._id, proposedBasic: 60000, proposedHra: 20000, proposedDa: 5000, proposedSpecialAllowance: 5000, proposedOtherAllowances: 0,
    reason: 'Annual performance increment — smoke test',
  }, okAnd((r) => (r.data.data.status === 'PENDING' ? null : `expected PENDING, got ${r.data.data.status}`)));
  const requestId = created.data?.data?._id;

  await expect('a second pending request for the same employee is refused', hr, 'POST', '/payroll/compensation-requests', {
    employeeId: candidate._id, proposedBasic: 65000, reason: 'Duplicate attempt',
  }, status(409));

  const afterRequest = await call(admin, 'GET', `/payroll/salary/${candidate._id}`);
  record(afterRequest.data.data.find((s) => s.isActive).basic === 50000, 'creating a request does not change the live salary structure', 'salary changed before approval');

  await expect('HR sees the pending compensation request in the queue', hr, 'GET', '/payroll/compensation-requests?status=PENDING', null, okAnd((r) => (r.data.data.some((x) => x._id === requestId) ? null : 'request not visible to HR')));
  await expect('FINANCE cannot approve a compensation request', finance, 'PATCH', `/payroll/compensation-requests/${requestId}/approve`, null, status(403));
  await expect('HR_ADMIN cannot approve their own compensation request', hr, 'PATCH', `/payroll/compensation-requests/${requestId}/approve`, null, status(403));

  await expect('SUPER_ADMIN can approve a compensation request', admin, 'PATCH', `/payroll/compensation-requests/${requestId}/approve`, { comments: 'Approved by smoke test' }, okAnd((r) => (r.data.data.status === 'APPROVED' ? null : `expected APPROVED, got ${r.data.data.status}`)));

  const afterApproval = await call(admin, 'GET', `/payroll/salary/${candidate._id}`);
  const activeAfter = afterApproval.data.data.find((s) => s.isActive);
  record(activeAfter.basic === 60000, 'approval actually updates the live salary structure', `basic is ${activeAfter.basic}, expected 60000`);

  await expect('approving twice is refused', admin, 'PATCH', `/payroll/compensation-requests/${requestId}/approve`, null, status(400));

  const auditForApproval = await call(auditor, 'GET', '/audit?action=COMPENSATION_APPROVED&limit=5');
  record(auditForApproval.status === 200 && auditForApproval.data.data.length > 0, 'compensation approval is recorded in the audit log', `status ${auditForApproval.status}`);

  // Reject flow, on a fresh request so it does not collide with the approved one above.
  const created2 = await call(hr, 'POST', '/payroll/compensation-requests', {
    employeeId: candidate._id, proposedBasic: 40000, reason: 'Requesting a decrease — smoke test',
  });
  const requestId2 = created2.data?.data?._id;
  await expect('reject requires a reason', admin, 'PATCH', `/payroll/compensation-requests/${requestId2}/reject`, {}, status(400));
  await expect('CTO can reject a compensation request', cto, 'PATCH', `/payroll/compensation-requests/${requestId2}/reject`, { comments: 'Not justified at this time' }, okAnd((r) => (r.data.data.status === 'REJECTED' ? null : 'not rejected')));
  const afterReject = await call(admin, 'GET', `/payroll/salary/${candidate._id}`);
  record(afterReject.data.data.find((s) => s.isActive).basic === 60000, 'a rejected request does not change the salary', 'salary changed after rejection');

  console.log('\n--- Required document checklist ---');
  const checklist = await expect('document checklist is available for an employee', hr, 'GET', `/employees/${candidate._id}/documents/checklist`, null, okAnd((r) => (Array.isArray(r.data.data.items) && r.data.data.items.length > 0 ? null : 'no checklist items')));
  record(typeof checklist.data?.data?.summary?.totalRequired === 'number', 'checklist summary reports totalRequired/uploaded/missing', JSON.stringify(checklist.data?.data?.summary));

  const otherEmployee = staff.data.data.managers.find((m) => m._id !== candidate._id);
  await expect("EMPLOYEE cannot read another employee's document checklist", employee, 'GET', `/employees/${otherEmployee._id}/documents/checklist`, null, status(403));

  console.log('\n--- Leave consistency ---');
  await expect('EMPLOYEE cannot approve a leave request', employee, 'PATCH', '/leave/requests/000000000000000000000000/approve', null, (res) => (res.status === 403 ? null : `expected 403, got ${res.status}`));
  const empBalances = await expect('leave balances use a consistent remaining = total - used - pending formula', employee, 'GET', '/leave/balances/me', null, okAnd((r) => {
    const bad = r.data.data.find((b) => b.remainingDays !== Math.max(0, b.totalDays - b.usedDays - b.pendingDays));
    return bad ? `balance mismatch for ${bad.leaveType?.name}` : null;
  }));
  record(Array.isArray(empBalances.data?.data), 'employee can view their own leave balances', '');

  console.log('\n--- Dashboard role-awareness ---');
  const adminDash = await call(admin, 'GET', '/dashboard/stats');
  record(adminDash.data?.data?.payroll !== null && adminDash.data?.data?.payroll !== undefined, 'SUPER_ADMIN dashboard includes payroll data', '');
  const ctoDash = await call(cto, 'GET', '/dashboard/stats');
  record(ctoDash.data?.data?.payroll !== null && ctoDash.data?.data?.payroll !== undefined, 'CTO dashboard includes payroll data (same as SUPER_ADMIN)', '');
  const empDash = await call(employee, 'GET', '/dashboard/stats');
  record(empDash.data?.data?.payroll === null, "EMPLOYEE dashboard's org-wide payroll block is hidden", '');
  const managerDash = await call(manager, 'GET', '/dashboard/stats');
  record(managerDash.data?.data?.payroll === null, "MANAGER dashboard's org-wide payroll block is hidden", '');
  const auditorDash = await call(auditor, 'GET', '/dashboard/stats');
  record(Array.isArray(auditorDash.data?.data?.recentActivity) && auditorDash.data.data.recentActivity.length > 0, 'AUDITOR dashboard includes the recent-activity/audit feed', '');
  const hrDash = await call(hr, 'GET', '/dashboard/stats');
  record(typeof hrDash.data?.data?.pendingCompensationRequests === 'number', 'HR dashboard reports a pendingCompensationRequests count', '');

  console.log('\n--- Mandatory document enforcement ---');
  const stamp = Date.now().toString().slice(-6);
  const newEmp = await call(hr, 'POST', '/employees', {
    employeeCode: `DOC${stamp}`, firstName: 'Docflow', lastName: 'Tester',
    officialEmail: `docflow.${stamp}@launcherdesk.com`, designation: 'QA Analyst',
    department: 'Engineering', dateOfJoining: '2026-01-01', status: 'PROBATION',
  });
  const newEmpId = newEmp.data?.data?._id;
  record(newEmp.status === 201, 'setup: created a fresh employee for the document-enforcement flow', `status ${newEmp.status}`);

  const initialChecklist = await expect('new employee receives the required document checklist immediately', hr, 'GET', `/employees/${newEmpId}/documents/checklist`, null, okAnd((r) => (r.data.data.items.length > 0 ? null : 'no checklist items')));
  const requiredItems = initialChecklist.data.data.items.filter((i) => i.required);
  record(requiredItems.every((i) => i.status === 'MISSING'), 'missing required documents are clearly visible before any upload', JSON.stringify(requiredItems.map((i) => i.status)));
  record(newEmp.data.data.documentStatus === 'PENDING', 'a freshly created employee starts with documentStatus PENDING', `got ${newEmp.data.data.documentStatus}`);

  async function uploadDoc(session, employeeId, category, name) {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(`%PDF-1.4\n% ${category} smoke test\n`)], { type: 'application/pdf' }), `${category}.pdf`);
    form.append('employeeId', employeeId);
    form.append('name', name);
    form.append('category', category);
    return call(session, 'POST', '/documents/upload', form);
  }

  // Verify every required document except the last one, leaving optional ones untouched.
  const requiredCategories = requiredItems.map((i) => i.category);
  const optionalCategories = initialChecklist.data.data.items.filter((i) => !i.required).map((i) => i.category);
  const uploadedDocIds = {};
  for (const category of requiredCategories) {
    const up = await uploadDoc(hr, newEmpId, category, category);
    uploadedDocIds[category] = up.data?.data?._id;
  }
  record(Object.values(uploadedDocIds).every(Boolean), 'setup: uploaded one document per required category', '');

  const afterUpload = await call(hr, 'GET', `/employees/${newEmpId}/documents/checklist`);
  record(
    afterUpload.data.data.items.filter((i) => i.required).every((i) => i.status === 'UNDER_REVIEW'),
    'an uploaded-but-unverified required document does not count as verified',
    JSON.stringify(afterUpload.data.data.items.filter((i) => i.required).map((i) => i.status)),
  );
  record(afterUpload.data.data.summary.isComplete === false, 'documentation is not complete while required documents are only under review', '');

  // Reject one required document — must not count as complete even though "something" was uploaded.
  const firstCategory = requiredCategories[0];
  await call(hr, 'PATCH', `/documents/${uploadedDocIds[firstCategory]}/reject`, { reason: 'Illegible scan — smoke test' });
  const afterOneRejected = await call(hr, 'GET', `/employees/${newEmpId}/documents/checklist`);
  const rejectedItem = afterOneRejected.data.data.items.find((i) => i.category === firstCategory);
  record(rejectedItem.status === 'REJECTED', 'a rejected required document is reflected in the checklist', `got ${rejectedItem.status}`);
  record(afterOneRejected.data.data.summary.isComplete === false, 'a rejected required document does not count as complete', '');

  const empAfterReject = await call(hr, 'GET', `/employees/${newEmpId}`);
  record(empAfterReject.data.data.hasRejectedDocuments === true, 'the employee record reflects hasRejectedDocuments after a rejection', '');

  // Verify everything, including a fresh re-upload replacing the rejected one.
  const reup = await uploadDoc(hr, newEmpId, firstCategory, `${firstCategory} (re-upload)`);
  for (const category of requiredCategories) {
    const docId = category === firstCategory ? reup.data.data._id : uploadedDocIds[category];
    await call(hr, 'PATCH', `/documents/${docId}/verify`, null);
  }
  const complete = await call(hr, 'GET', `/employees/${newEmpId}/documents/checklist`);
  record(complete.data.data.items.filter((i) => i.required).every((i) => i.status === 'VERIFIED'), 'once every required document is verified, each item shows VERIFIED', JSON.stringify(complete.data.data.items.filter((i) => i.required).map((i) => i.status)));
  record(complete.data.data.summary.isComplete === true, 'all required documents verified → documentation is complete', '');
  record(optionalCategories.every((cat) => complete.data.data.items.find((i) => i.category === cat)?.status === 'MISSING'), 'optional documents remaining missing do not block completion', '');

  const empComplete = await call(hr, 'GET', `/employees/${newEmpId}`);
  record(empComplete.data.data.documentStatus === 'COMPLETE', 'employee.documentStatus flips to COMPLETE once verification finishes', `got ${empComplete.data.data.documentStatus}`);
  record(empComplete.data.data.hasRejectedDocuments === false, 'hasRejectedDocuments clears once the rejected document is replaced and verified', '');

  // Activation gate: create a second employee, leave documents missing, attempt to activate.
  const gateEmp = await call(hr, 'POST', '/employees', {
    employeeCode: `GATE${stamp}`, firstName: 'Gate', lastName: 'Tester',
    officialEmail: `gate.${stamp}@launcherdesk.com`, designation: 'QA Analyst',
    department: 'Engineering', dateOfJoining: '2026-01-01', status: 'PROBATION',
  });
  const gateEmpId = gateEmp.data?.data?._id;

  await expect('missing required documents → employee cannot be moved to ACTIVE (HR attempt)', hr, 'PATCH', `/employees/${gateEmpId}`, { status: 'ACTIVE' }, (res) => {
    if (res.status !== 400) return `expected 400, got ${res.status}`;
    if (!/required documents/i.test(res.data?.error?.message || '')) return `expected a documents-related message, got: ${res.data?.error?.message}`;
    return null;
  });
  await expect('a second, differently-shaped direct API attempt to bypass activation is also rejected', hr, 'PATCH', `/employees/${gateEmpId}`, { status: 'ACTIVE', documentStatus: 'COMPLETE', hasRejectedDocuments: false }, status(400));
  await expect('SUPER_ADMIN cannot bypass the activation gate either — it is not role-gated, it is data-gated', admin, 'PATCH', `/employees/${gateEmpId}`, { status: 'ACTIVE' }, status(400));

  const gateAfterBlock = await call(hr, 'GET', `/employees/${gateEmpId}`);
  record(gateAfterBlock.data.data.status === 'PROBATION', 'the employee status is genuinely unchanged after the blocked activation attempts', `got ${gateAfterBlock.data.data.status}`);

  // Resolve the documentation as SUPER_ADMIN, then CTO reject-and-refix one, then activation succeeds.
  const gateChecklist = await call(hr, 'GET', `/employees/${gateEmpId}/documents/checklist`);
  const gateRequired = gateChecklist.data.data.items.filter((i) => i.required).map((i) => i.category);
  const gateDocIds = {};
  for (const category of gateRequired) {
    const up = await uploadDoc(hr, gateEmpId, category, category);
    gateDocIds[category] = up.data.data._id;
  }
  for (const category of gateRequired.slice(1)) {
    await call(admin, 'PATCH', `/documents/${gateDocIds[category]}/verify`, null);
  }
  const ctoVerify = await call(cto, 'PATCH', `/documents/${gateDocIds[gateRequired[0]]}/verify`, null);
  record(ctoVerify.status === 200, 'CTO can verify a required document (resolve documentation) same as SUPER_ADMIN', `status ${ctoVerify.status}`);

  await expect('once all required documents are verified, activation succeeds', hr, 'PATCH', `/employees/${gateEmpId}`, { status: 'ACTIVE' }, okAnd((r) => (r.data.data.status === 'ACTIVE' ? null : `expected ACTIVE, got ${r.data.data.status}`)));

  const completionAudit = await call(auditor, 'GET', '/audit?action=DOCUMENT_REQUIREMENTS_COMPLETED&limit=10');
  record(completionAudit.status === 200 && completionAudit.data.data.length > 0, 'DOCUMENT_REQUIREMENTS_COMPLETED is recorded in the audit log', `status ${completionAudit.status}, ${completionAudit.data?.data?.length} entries`);
  const verifyAudit = await call(auditor, 'GET', '/audit?action=DOCUMENT_VERIFIED&limit=5');
  record(verifyAudit.status === 200 && verifyAudit.data.data.length > 0, 'DOCUMENT_VERIFIED is recorded in the audit log', '');
  const rejectAudit = await call(auditor, 'GET', '/audit?action=DOCUMENT_REJECTED&limit=5');
  record(rejectAudit.status === 200 && rejectAudit.data.data.length > 0, 'DOCUMENT_REJECTED is recorded in the audit log', '');

  // Employee-side: can upload their own documents, cannot touch another employee's.
  const empOwnUpload = await uploadDoc(employee, employee.employee._id, 'Address Proof', 'My address proof');
  record(empOwnUpload.status === 201, 'employee can upload their own permitted document', `status ${empOwnUpload.status}`);
  await expect("employee cannot upload to another employee's record", employee, 'POST', '/documents/upload', (() => {
    const form = new FormData();
    form.append('employeeId', newEmpId);
    form.append('name', 'Should be blocked');
    form.append('category', 'Address Proof');
    form.append('file', new Blob([Buffer.from('%PDF-1.4\n')], { type: 'application/pdf' }), 'x.pdf');
    return form;
  })(), status(403));
  await expect("employee cannot read another employee's document list", employee, 'GET', `/employees/${newEmpId}/documents`, null, status(403));

  const empDashChecklist = await expect('employee dashboard checklist call reports documentation progress for the signed-in user', employee, 'GET', `/employees/${employee.employee._id}/documents/checklist`, null, okAnd((r) => (typeof r.data.data.summary.totalRequired === 'number' ? null : 'no summary')));
  record(Boolean(empDashChecklist.data?.data?.summary), 'checklist summary is present for the employee self-service view', '');

  const hrListFilter = await expect('HR employee list can filter by documentStatus=COMPLETE', hr, 'GET', '/employees?documentStatus=COMPLETE&limit=50', null, okAnd((r) => (r.data.data.every((e) => e.documentStatus === 'COMPLETE') ? null : 'filter leaked a non-complete employee')));
  record(hrListFilter.data.data.some((e) => e._id === newEmpId), 'the fully-documented smoke-test employee appears in the COMPLETE filter', '');
  const hrListRejected = await call(hr, 'GET', '/employees?documentStatus=REJECTED&limit=50');
  record(hrListRejected.status === 200 && hrListRejected.data.data.every((e) => e.hasRejectedDocuments === true), 'HR employee list can filter by documentStatus=REJECTED', '');
  record(Object.prototype.hasOwnProperty.call(hrListFilter.data.data[0] || {}, 'documentStatus'), 'HR employee list rows include the documentStatus field', '');

  console.log('\n--- Security hardening ---');

  // The login/getMe responses are hand-built by the controller, but assert the
  // shape directly so a future refactor that widens the response gets caught.
  const meRes = await call(admin, 'GET', '/auth/me');
  record(meRes.status === 200 && !('password' in meRes.data.data.user), 'auth/me does not return the password field', `keys: ${Object.keys(meRes.data?.data?.user || {})}`);
  const loginProbe = await call(makeSession(), 'POST', '/auth/login', { email: 'admin@launcherdesk.com', password: ADMIN_PW });
  record(loginProbe.status === 200 && !('password' in loginProbe.data.data.user), 'login response does not return the password field', `keys: ${Object.keys(loginProbe.data?.data?.user || {})}`);

  // Security headers (helmet) must be present on a normal authenticated response.
  const rawRes = await fetch(`${API}/employees?limit=1`, { headers: { cookie: admin.cookie } });
  record(rawRes.headers.get('x-content-type-options') === 'nosniff', 'responses set X-Content-Type-Options: nosniff', `got ${rawRes.headers.get('x-content-type-options')}`);
  record(!rawRes.headers.get('x-powered-by'), 'X-Powered-By header is not leaked', `got ${rawRes.headers.get('x-powered-by')}`);

  // A tampered/forged auth cookie must be rejected, not silently accepted.
  const forgedRes = await fetch(`${API}/employees?limit=1`, { headers: { cookie: 'token=not-a-real-jwt' } });
  record(forgedRes.status === 401, 'a forged/tampered auth cookie is rejected', `status ${forgedRes.status}`);

  // Upload content must match its declared MIME type — a file claiming to be a
  // PNG but containing PDF bytes (or vice versa) must be rejected, not stored
  // and later served back with that same allowed-but-wrong Content-Type.
  const spoofed = await expect('a file whose content does not match its declared MIME type is rejected', hr, 'POST', '/documents/upload', (() => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('%PDF-1.4\nthis is actually a PDF')], { type: 'image/png' }), 'fake.png');
    form.append('employeeId', newEmpId);
    form.append('name', 'Spoofed file type');
    form.append('category', 'Other');
    return form;
  })(), status(400));
  record(spoofed.data?.error?.code === 'INVALID_FILE_TYPE', 'the spoofed-upload rejection reports INVALID_FILE_TYPE', `got ${spoofed.data?.error?.code}`);

  console.log(`\n${'='.repeat(56)}`);
  console.log(`PASSED ${passed}   FAILED ${failed}`);
  if (failures.length) { console.log('\nFailures:'); failures.forEach((f) => console.log(`  - ${f}`)); }
  console.log('='.repeat(56));
  process.exit(failed ? 1 : 0);
}

run().catch((err) => { console.error('Smoke test crashed:', err); process.exit(1); });
