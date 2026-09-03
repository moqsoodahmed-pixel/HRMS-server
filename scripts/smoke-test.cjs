/**
 * End-to-end smoke test against a running API.
 *
 *   node scripts/smoke-test.cjs [baseUrl]
 *
 * Logs in as each seeded role and exercises every module, including the
 * write paths (check-in, apply leave, upload, verify, assign, acknowledge…)
 * and the negative authorisation cases.
 */
const BASE = process.argv[2] || 'http://localhost:5001';
const API = `${BASE}/api`;

let passed = 0;
let failed = 0;
const failures = [];

function record(ok, label, detail) {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    failures.push(`${label} — ${detail}`);
    console.log(`  FAIL ${label} — ${detail}`);
  }
}

/** Minimal cookie jar so the session cookie survives between calls. */
function makeSession() {
  return { cookie: '' };
}

async function call(session, method, path, body, options = {}) {
  const headers = {};
  if (session.cookie) headers.cookie = session.cookie;
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, { method, headers, body: payload, redirect: 'manual' });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookie) {
    if (c.startsWith('token=')) session.cookie = c.split(';')[0];
  }
  const type = res.headers.get('content-type') || '';
  let data = null;
  if (type.includes('application/json')) data = await res.json();
  else if (options.binary) data = Buffer.from(await res.arrayBuffer());
  else data = await res.text();
  return { status: res.status, data, headers: res.headers };
}

async function expect(label, session, method, path, body, check) {
  try {
    const res = await call(session, method, path, body);
    const problem = check(res);
    record(!problem, label, problem || '');
    return res;
  } catch (err) {
    record(false, label, err.message);
    return { status: 0, data: null };
  }
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

  console.log('\n--- AUTH ---');
  const anon = makeSession();
  await expect('unauthenticated request is rejected', anon, 'GET', '/employees', null, status(401));
  await expect('bad credentials are rejected', anon, 'POST', '/auth/login', { email: 'admin@launcherdesk.com', password: 'wrong-password' }, status(401));

  const admin = await login('admin@launcherdesk.com', ADMIN_PW);
  record(admin.user.role === 'SUPER_ADMIN', 'login as SUPER_ADMIN', '');
  const hr = await login('hr@launcherdesk.com', ADMIN_PW);
  const finance = await login('finance@launcherdesk.com', ADMIN_PW);
  const auditor = await login('auditor@launcherdesk.com', ADMIN_PW);
  const employee = await login('jeevan@launcherdesk.com', EMP_PW);
  const manager = await login('srinivas@launcherdesk.com', EMP_PW);
  record(Boolean(employee.employee), 'employee login resolves an employee profile', '');
  await expect('/auth/me returns the session', admin, 'GET', '/auth/me', null, okAnd((r) => (r.data.data.user.email ? null : 'no user in payload')));

  console.log('\n--- DASHBOARD ---');
  await expect('dashboard stats', admin, 'GET', '/dashboard/stats', null, okAnd((r) => {
    const d = r.data.data;
    if (!d.stats || typeof d.stats.totalEmployees !== 'number') return 'stats missing';
    if (d.stats.totalEmployees === 0) return 'no employees counted';
    if (!d.payroll) return 'payroll block missing for admin';
    if (!Array.isArray(d.departmentDistribution)) return 'department distribution missing';
    return null;
  }));
  await expect('dashboard hides payroll from an employee', employee, 'GET', '/dashboard/stats', null, okAnd((r) => (r.data.data.payroll === null ? null : 'payroll leaked to EMPLOYEE')));

  console.log('\n--- EMPLOYEES ---');
  const empList = await expect('employee list', admin, 'GET', '/employees?limit=10', null, okAnd((r) => (r.data.data.length ? null : 'empty list')));
  const someEmployee = empList.data?.data?.[0];
  await expect('employee search', admin, 'GET', '/employees?search=Priya', null, okAnd((r) => (r.data.data.some((e) => e.fullName.includes('Priya')) ? null : 'search found nothing')));
  await expect('employee department filter', admin, 'GET', '/employees?department=Engineering', null, okAnd((r) => (r.data.data.every((e) => e.department === 'Engineering') ? null : 'filter leaked other departments')));
  await expect('employee filter options', admin, 'GET', '/employees/options', null, okAnd((r) => (r.data.data.departments.length >= 10 && r.data.data.managers.length ? null : 'options incomplete')));
  await expect('employee detail', admin, 'GET', `/employees/${someEmployee._id}`, null, ok);
  await expect('invalid ObjectId is rejected', admin, 'GET', '/employees/not-an-id', null, status(400));
  await expect('missing employee is 404', admin, 'GET', '/employees/507f1f77bcf86cd799439099', null, status(404));
  await expect('EMPLOYEE only sees themselves', employee, 'GET', '/employees', null, okAnd((r) => (r.data.data.length <= 1 ? null : `saw ${r.data.data.length} employees`)));
  await expect('EMPLOYEE cannot create employees', employee, 'POST', '/employees', { employeeCode: 'X1', firstName: 'A', officialEmail: 'a@b.com', designation: 'x', department: 'HR', dateOfJoining: '2026-01-01' }, status(403));

  const stamp = Date.now().toString().slice(-6);
  const created = await expect('create employee', admin, 'POST', '/employees', {
    employeeCode: `QA${stamp}`, firstName: 'Smoke', lastName: 'Test',
    officialEmail: `smoke.${stamp}@launcherdesk.com`, designation: 'QA Analyst',
    department: 'Engineering', dateOfJoining: '2026-08-01', dateOfBirth: '1995-01-01',
    probationEndDate: '', dateOfExit: '', noticePeriodDays: '',
  }, okAnd((r) => (r.data.data._id ? null : 'no id returned')));
  const newId = created.data?.data?._id;
  await expect('duplicate employee code is rejected', admin, 'POST', '/employees', {
    employeeCode: `QA${stamp}`, firstName: 'Dup', officialEmail: `dup.${stamp}@launcherdesk.com`,
    designation: 'x', department: 'HR', dateOfJoining: '2026-08-01',
  }, status(409));
  await expect('invalid email is rejected', admin, 'POST', '/employees', {
    employeeCode: `QB${stamp}`, firstName: 'Bad', officialEmail: 'not-an-email',
    designation: 'x', department: 'HR', dateOfJoining: '2026-08-01',
  }, status(422));
  await expect('update employee', admin, 'PATCH', `/employees/${newId}`, { designation: 'Senior QA Analyst', dateOfExit: '' }, okAnd((r) => (r.data.data.designation === 'Senior QA Analyst' ? null : 'designation not updated')));
  await expect('employee cannot be their own manager', admin, 'PATCH', `/employees/${newId}`, { manager: newId }, status(400));

  console.log('\n--- ATTENDANCE ---');
  await expect('attendance list', admin, 'GET', '/attendance?limit=5', null, okAnd((r) => (r.data.data.length ? null : 'no records')));
  await expect('attendance stats', admin, 'GET', '/attendance/stats', null, okAnd((r) => (typeof r.data.data.totalEmployees === 'number' ? null : 'stats missing')));
  await expect('attendance department filter', admin, 'GET', '/attendance?department=Engineering&limit=5', null, ok);
  await expect('attendance today (self)', employee, 'GET', '/attendance/me/today', null, okAnd((r) => (r.data.data.shift ? null : 'shift missing')));
  await expect('EMPLOYEE sees only own attendance', employee, 'GET', '/attendance?limit=50', null, okAnd((r) => {
    const others = r.data.data.filter((a) => String(a.employee?._id) !== String(employee.employee._id));
    return others.length ? `saw ${others.length} other employees' records` : null;
  }));

  const checkin = await call(employee, 'POST', '/attendance/checkin');
  record([200, 400].includes(checkin.status), 'check-in responds', `status ${checkin.status}`);
  const secondCheckin = await call(employee, 'POST', '/attendance/checkin');
  record(secondCheckin.status === 400, 'double check-in is refused', `status ${secondCheckin.status}`);
  const checkout = await call(employee, 'POST', '/attendance/checkout');
  record([200, 400].includes(checkout.status), 'check-out responds', `status ${checkout.status}`);

  const attRow = (await call(admin, 'GET', '/attendance?limit=1')).data.data[0];
  await expect('admin corrects attendance', admin, 'PATCH', `/attendance/${attRow._id}`, { status: 'WORK_FROM_HOME', notes: 'Corrected by smoke test', editReason: 'Smoke test correction' }, okAnd((r) => (r.data.data.status === 'WORK_FROM_HOME' ? null : 'status not applied')));
  await expect('attendance edit requires a reason', admin, 'PATCH', `/attendance/${attRow._id}`, { status: 'PRESENT' }, status(422));
  await expect('EMPLOYEE cannot edit attendance', employee, 'PATCH', `/attendance/${attRow._id}`, { status: 'PRESENT', editReason: 'nope' }, status(403));

  console.log('\n--- LEAVE ---');
  const types = await expect('leave types', admin, 'GET', '/leave/types', null, okAnd((r) => (r.data.data.length ? null : 'no leave types')));
  const leaveType = types.data.data.find((t) => t.code === 'CL');
  await expect('leave requests list', admin, 'GET', '/leave/requests?limit=5', null, okAnd((r) => (r.data.data.length ? null : 'no requests')));
  await expect('leave stats', admin, 'GET', '/leave/stats', null, okAnd((r) => (typeof r.data.data.pending === 'number' ? null : 'stats missing')));
  await expect('own leave balances', employee, 'GET', '/leave/balances/me', null, okAnd((r) => (r.data.data.length ? null : 'no balances')));
  await expect('holidays', admin, 'GET', '/leave/holidays', null, okAnd((r) => (r.data.data.length ? null : 'no holidays')));

  const far = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10);
  const far2 = new Date(Date.now() + 201 * 86400000).toISOString().slice(0, 10);
  const applied = await expect('apply for leave', employee, 'POST', '/leave/requests', { leaveType: leaveType._id, startDate: far, endDate: far2, reason: 'Smoke test leave request' }, okAnd((r) => (r.data.data._id ? null : 'no id')));
  const leaveId = applied.data?.data?._id;
  await expect('overlapping leave is refused', employee, 'POST', '/leave/requests', { leaveType: leaveType._id, startDate: far, endDate: far2, reason: 'Overlap attempt' }, status(409));
  await expect('end before start is refused', employee, 'POST', '/leave/requests', { leaveType: leaveType._id, startDate: far2, endDate: far, reason: 'Backwards range' }, status(400));
  await expect('another employee cannot cancel it', manager, 'PATCH', `/leave/requests/${leaveId}/cancel`, null, status(403));
  await expect('owner cancels their own request', employee, 'PATCH', `/leave/requests/${leaveId}/cancel`, null, ok);
  await expect('cancelling twice is refused', employee, 'PATCH', `/leave/requests/${leaveId}/cancel`, null, status(400));

  const pending = (await call(admin, 'GET', '/leave/requests?status=PENDING&limit=1')).data.data[0];
  if (pending) {
    await expect('reject without a reason is refused', hr, 'PATCH', `/leave/requests/${pending._id}/reject`, {}, status(400));
    await expect('HR approves leave', hr, 'PATCH', `/leave/requests/${pending._id}/approve`, { note: 'Approved by smoke test' }, ok);
    await expect('approving twice is refused', hr, 'PATCH', `/leave/requests/${pending._id}/approve`, {}, status(400));
  } else {
    record(true, 'no pending leave to approve (skipped)', '');
  }
  // Derive the holiday date from the run's own timestamp so repeated runs never
  // collide. A 27-day pool (the previous approach) collides roughly half the
  // time across just six runs against a persistent, never-reset database —
  // spread across a ~10-year pool instead so repeat runs stay independent.
  const holidayDate = new Date(Date.UTC(2030, 0, 1));
  holidayDate.setUTCDate(holidayDate.getUTCDate() + (Number(stamp) % 3650));
  const holidayDateStr = holidayDate.toISOString().slice(0, 10);
  await expect('HR creates a holiday', hr, 'POST', '/leave/holidays', { name: `Smoke Holiday ${stamp}`, date: holidayDateStr, type: 'COMPANY' }, ok);
  await expect('EMPLOYEE cannot create a holiday', employee, 'POST', '/leave/holidays', { name: 'Nope', date: '2026-12-31' }, status(403));

  console.log('\n--- PAYROLL ---');
  await expect('payroll summary', finance, 'GET', '/payroll/summary', null, okAnd((r) => (typeof r.data.data.netPayroll === 'number' ? null : 'summary missing')));
  const salaries = await expect('salary structures', finance, 'GET', '/payroll/salary?limit=5', null, okAnd((r) => (r.data.data.length ? null : 'no structures')));
  await expect('payslips list', finance, 'GET', '/payroll/payslips?limit=5', null, okAnd((r) => (r.data.data.length ? null : 'no payslips')));
  await expect('EMPLOYEE sees only own payslips', employee, 'GET', '/payroll/payslips?limit=50', null, okAnd((r) => {
    const others = r.data.data.filter((p) => String(p.employee?._id) !== String(employee.employee._id));
    return others.length ? `saw ${others.length} other payslips` : null;
  }));
  await expect('MANAGER cannot browse all payslips', manager, 'GET', '/payroll/payslips?limit=50', null, okAnd((r) => {
    const others = r.data.data.filter((p) => String(p.employee?._id) !== String(manager.employee._id));
    return others.length ? `saw ${others.length} other payslips` : null;
  }));
  await expect('EMPLOYEE cannot list salary structures', employee, 'GET', '/payroll/salary', null, status(403));
  await expect('HR cannot create a salary structure', hr, 'POST', `/payroll/salary/${newId}`, { effectiveFrom: '2026-08-01', basic: 50000 }, status(403));
  await expect('FINANCE creates a salary structure', finance, 'POST', `/payroll/salary/${newId}`, {
    effectiveFrom: '2026-08-01', basic: 50000, hra: 20000, da: 5000, specialAllowance: 7500,
    otherAllowances: 2500, pf: 1800, esi: 0, tds: 4000, otherDeductions: 200,
  }, okAnd((r) => (r.data.data.netSalary === 79000 ? null : `net was ${r.data.data.netSalary}`)));
  await expect('deductions above gross are refused', finance, 'POST', `/payroll/salary/${newId}`, { effectiveFrom: '2026-08-01', basic: 1000, tds: 99999 }, status(400));

  const gen = await expect('generate a payslip', finance, 'POST', '/payroll/payslips/generate', { employeeId: newId, month: 7, year: 2026 }, okAnd((r) => (r.data.data._id ? null : 'no payslip')));
  const payslipId = gen.data?.data?._id;
  await expect('duplicate payslip is refused', finance, 'POST', '/payroll/payslips/generate', { employeeId: newId, month: 7, year: 2026 }, status(409));
  const pdf = await call(finance, 'GET', `/payroll/payslips/${payslipId}/download`, null, { binary: true });
  record(pdf.status === 200 && Buffer.isBuffer(pdf.data) && pdf.data.slice(0, 4).toString() === '%PDF', 'download payslip PDF', `status ${pdf.status}, ${pdf.data?.length} bytes`);
  await expect('mark payslip paid', finance, 'PATCH', `/payroll/payslips/${payslipId}/status`, { status: 'PAID' }, okAnd((r) => (r.data.data.status === 'PAID' ? null : 'status not applied')));
  await expect("EMPLOYEE cannot download another's payslip", employee, 'GET', `/payroll/payslips/${payslipId}/download`, null, status(403));

  console.log('\n--- DOCUMENTS ---');
  const docs = await expect('document register', hr, 'GET', '/documents?limit=5', null, okAnd((r) => (r.data.data.length ? null : 'no documents')));
  await expect('document stats', hr, 'GET', '/documents/stats', null, okAnd((r) => (typeof r.data.data.pending === 'number' ? null : 'stats missing')));
  await expect('document status filter', hr, 'GET', '/documents?status=VERIFIED&limit=5', null, okAnd((r) => (r.data.data.every((d) => d.status === 'VERIFIED') ? null : 'filter leaked')));

  const form = new FormData();
  form.append('file', new Blob([Buffer.from('%PDF-1.4\n% smoke test document\n')], { type: 'application/pdf' }), 'smoke.pdf');
  form.append('employeeId', newId);
  form.append('name', 'Smoke Test Document');
  form.append('category', 'Other');
  const uploaded = await call(hr, 'POST', '/documents/upload', form);
  record(uploaded.status === 201, 'upload a document', `status ${uploaded.status} ${JSON.stringify(uploaded.data)?.slice(0, 120)}`);
  const docId = uploaded.data?.data?._id;
  if (docId) {
    const dl = await call(hr, 'GET', `/documents/${docId}/download?dl=1`, null, { binary: true });
    record(dl.status === 200 && dl.data.length > 0, 'download the uploaded document', `status ${dl.status}`);
    await expect('verify document', hr, 'PATCH', `/documents/${docId}/verify`, null, okAnd((r) => (r.data.data.status === 'VERIFIED' ? null : 'not verified')));
    await expect('reject needs a reason', hr, 'PATCH', `/documents/${docId}/reject`, {}, status(400));
    await expect('reject document', hr, 'PATCH', `/documents/${docId}/reject`, { reason: 'Illegible scan' }, okAnd((r) => (r.data.data.status === 'REJECTED' ? null : 'not rejected')));
    await expect('archive document', hr, 'PATCH', `/documents/${docId}/archive`, null, okAnd((r) => (r.data.data.status === 'ARCHIVED' ? null : 'not archived')));
  }
  const otherDoc = docs.data?.data?.find((d) => String(d.employee?._id) !== String(employee.employee._id));
  if (otherDoc) {
    await expect("EMPLOYEE cannot download another's document", employee, 'GET', `/documents/${otherDoc._id}/download`, null, status(403));
  }
  // Employees may upload their OWN documents (see the mandatory-document-
  // enforcement update), but never for another employee's record.
  await expect("EMPLOYEE cannot upload a document for another employee", employee, 'POST', '/documents/upload', (() => {
    const f = new FormData();
    f.append('file', new Blob([Buffer.from('%PDF-1.4\n')], { type: 'application/pdf' }), 'x.pdf');
    f.append('employeeId', newId);
    f.append('name', 'Should be blocked');
    f.append('category', 'Other');
    return f;
  })(), status(403));

  console.log('\n--- IDENTITY ---');
  await expect('save identity document', hr, 'POST', `/employees/${newId}/identity`, { documentType: 'PAN', number: 'ABCDE1234F' }, okAnd((r) => {
    if (r.data.data.encryptedNumber) return 'encrypted value leaked to the client';
    if (!r.data.data.maskedNumber) return 'no masked value';
    return null;
  }));
  await expect('reveal identity number (audited)', hr, 'POST', `/employees/${newId}/identity/PAN/reveal`, null, okAnd((r) => (r.data.data.number === 'ABCDE1234F' ? null : `got ${r.data.data.number}`)));
  await expect('EMPLOYEE cannot reveal identity numbers', employee, 'POST', `/employees/${newId}/identity/PAN/reveal`, null, status(403));

  console.log('\n--- POLICIES ---');
  const policies = await expect('policy list', admin, 'GET', '/policies', null, okAnd((r) => (r.data.data.length ? null : 'no policies')));
  await expect('EMPLOYEE only sees published policies', employee, 'GET', '/policies', null, okAnd((r) => (r.data.data.every((p) => p.status === 'PUBLISHED') ? null : 'draft policy leaked')));
  const createdPolicy = await expect('create policy', hr, 'POST', '/policies', { title: `Smoke Policy ${stamp}`, category: 'HR', content: 'Body text for the smoke test policy.', version: '1.0', isAcknowledgementRequired: true }, okAnd((r) => (r.data.data.status === 'DRAFT' ? null : 'expected DRAFT')));
  const policyId = createdPolicy.data?.data?._id;
  await expect('draft cannot be acknowledged', employee, 'POST', `/policies/${policyId}/acknowledge`, null, status(400));
  await expect('update policy', hr, 'PATCH', `/policies/${policyId}`, { description: 'Updated by the smoke test' }, ok);
  await expect('publish policy', hr, 'PATCH', `/policies/${policyId}/publish`, null, okAnd((r) => (r.data.data.status === 'PUBLISHED' ? null : 'not published')));
  await expect('publishing twice is refused', hr, 'PATCH', `/policies/${policyId}/publish`, null, status(400));
  await expect('acknowledge policy', employee, 'POST', `/policies/${policyId}/acknowledge`, null, ok);
  await expect('policy detail shows acknowledgement', employee, 'GET', `/policies/${policyId}`, null, okAnd((r) => (r.data.data.isAcknowledged ? null : 'acknowledgement not reflected')));
  await expect('EMPLOYEE cannot create policies', employee, 'POST', '/policies', { title: 'Nope', category: 'HR' }, status(403));

  console.log('\n--- ANNOUNCEMENTS ---');
  const anns = await expect('announcement list', employee, 'GET', '/announcements', null, okAnd((r) => (r.data.data.length ? null : 'no announcements')));
  const annId = anns.data?.data?.[0]?._id;
  await expect('mark announcement read', employee, 'POST', `/announcements/${annId}/read`, null, ok);
  await expect('read flag is reflected', employee, 'GET', '/announcements', null, okAnd((r) => (r.data.data.find((a) => a._id === annId)?.isRead ? null : 'still unread')));
  const newAnn = await expect('create announcement', hr, 'POST', '/announcements', { title: `Smoke Announcement ${stamp}`, description: 'Created by the smoke test run.', priority: 'HIGH', targetAudience: 'ALL' }, ok);
  await expect('update announcement', hr, 'PATCH', `/announcements/${newAnn.data.data._id}`, { priority: 'LOW' }, okAnd((r) => (r.data.data.priority === 'LOW' ? null : 'priority not applied')));
  await expect('short title is rejected', hr, 'POST', '/announcements', { title: 'x', description: 'y' }, status(422));
  await expect('EMPLOYEE cannot create announcements', employee, 'POST', '/announcements', { title: 'Nope test', description: 'Nope' }, status(403));

  console.log('\n--- ASSETS ---');
  await expect('asset list', hr, 'GET', '/assets?limit=5', null, okAnd((r) => (r.data.data.length ? null : 'no assets')));
  await expect('asset stats', hr, 'GET', '/assets/stats', null, okAnd((r) => (r.data.data.total > 0 ? null : 'no totals')));
  await expect('asset search', hr, 'GET', '/assets?search=MacBook', null, okAnd((r) => (r.data.data.length ? null : 'search found nothing')));
  const newAsset = await expect('create asset', hr, 'POST', '/assets', { assetCode: `SMOKE-${stamp}`, name: 'Smoke Test Laptop', type: 'Laptop', brand: 'Acme', serialNumber: `SN${stamp}`, purchaseValue: 50000, condition: 'NEW', location: 'Bengaluru HQ' }, ok);
  const assetId = newAsset.data?.data?._id;
  await expect('duplicate asset tag is refused', hr, 'POST', '/assets', { assetCode: `SMOKE-${stamp}`, name: 'Dup', type: 'Laptop' }, status(409));
  await expect('assign asset', hr, 'POST', `/assets/${assetId}/assign`, { employeeId: newId, conditionAtAssignment: 'NEW', notes: 'Smoke test assignment' }, okAnd((r) => (r.data.data.status === 'ASSIGNED' ? null : 'not assigned')));
  await expect('double assignment is refused', hr, 'POST', `/assets/${assetId}/assign`, { employeeId: newId }, status(400));
  await expect('asset history', hr, 'GET', `/assets/${assetId}/history`, null, okAnd((r) => (r.data.data.length ? null : 'no history')));
  await expect('return asset', hr, 'POST', `/assets/${assetId}/return`, { conditionAtReturn: 'GOOD', notes: 'Smoke test return' }, okAnd((r) => (r.data.data.status === 'AVAILABLE' ? null : 'not returned')));
  await expect('returning twice is refused', hr, 'POST', `/assets/${assetId}/return`, { conditionAtReturn: 'GOOD' }, status(400));
  await expect('EMPLOYEE cannot create assets', employee, 'POST', '/assets', { assetCode: 'X', name: 'X', type: 'X' }, status(403));

  console.log('\n--- ONBOARDING / OFFBOARDING ---');
  const onOverview = await expect('onboarding overview', hr, 'GET', '/onboarding', null, okAnd((r) => (r.data.data.length ? null : 'no rows')));
  const onTarget = onOverview.data.data.find((r) => r.progress.total > 0);
  await expect('onboarding tasks for an employee', hr, 'GET', `/onboarding/${onTarget.employee._id}`, null, okAnd((r) => (r.data.data.length && r.data.meta.progress ? null : 'no tasks/progress')));
  const applied2 = await expect('apply onboarding template', hr, 'POST', `/onboarding/${newId}/template`, null, okAnd((r) => (r.data.data.created > 0 ? null : 'nothing created')));
  await expect('re-applying the template is refused', hr, 'POST', `/onboarding/${newId}/template`, null, status(409));
  const newTasks = await call(hr, 'GET', `/onboarding/${newId}`);
  const taskId = newTasks.data.data[0]._id;
  await expect('complete an onboarding task', hr, 'PATCH', `/onboarding/task/${taskId}`, { status: 'COMPLETED' }, okAnd((r) => (r.data.data.status === 'COMPLETED' && r.data.data.completedAt ? null : 'not completed')));
  await expect('create an onboarding task', hr, 'POST', '/onboarding', { employee: newId, taskName: 'Smoke extra task', category: 'HR', dueDate: '2026-09-30' }, ok);
  await expect('EMPLOYEE cannot edit an unrelated task', employee, 'PATCH', `/onboarding/task/${taskId}`, { status: 'TODO' }, status(403));

  const offOverview = await expect('offboarding overview', hr, 'GET', '/offboarding', null, okAnd((r) => (r.data.data.length ? null : 'no leavers')));
  const leaver = offOverview.data.data[0].employee._id;
  await expect('offboarding tasks', hr, 'GET', `/offboarding/${leaver}`, null, okAnd((r) => (r.data.data.length ? null : 'no tasks')));
  await expect('offboarding clearance', hr, 'GET', `/offboarding/${leaver}/clearance`, null, okAnd((r) => (r.data.data.clearances ? null : 'no clearance block')));
  await expect('initiate offboarding', hr, 'POST', `/offboarding/${newId}/initiate`, { dateOfExit: '2026-11-30', exitReason: 'Smoke test exit', noticePeriodDays: 30 }, okAnd((r) => (r.data.data.tasksCreated > 0 ? null : 'no tasks created')));
  await expect('EMPLOYEE cannot initiate offboarding', employee, 'POST', `/offboarding/${newId}/initiate`, { dateOfExit: '2026-11-30', exitReason: 'x' }, status(403));

  console.log('\n--- REPORTS ---');
  await expect('employee report', admin, 'GET', '/reports/employees', null, okAnd((r) => (r.data.data.summary.total > 0 && r.data.data.byDepartment.length ? null : 'empty report')));
  await expect('attendance report', admin, 'GET', '/reports/attendance', null, okAnd((r) => (r.data.data.summary && r.data.data.byDay ? null : 'incomplete')));
  await expect('leave report', admin, 'GET', '/reports/leave', null, okAnd((r) => (r.data.data.summary ? null : 'incomplete')));
  await expect('payroll report', finance, 'GET', '/reports/payroll?month=7&year=2026', null, okAnd((r) => (r.data.data.summary ? null : 'incomplete')));
  await expect('asset report', admin, 'GET', '/reports/assets', null, okAnd((r) => (r.data.data.summary.total > 0 ? null : 'empty')));
  await expect('lifecycle report', admin, 'GET', '/reports/lifecycle', null, okAnd((r) => (r.data.data.onboarding && r.data.data.offboarding ? null : 'incomplete')));
  await expect('report department filter', admin, 'GET', '/reports/employees?department=Engineering', null, okAnd((r) => (r.data.data.employees.every((e) => e.department === 'Engineering') ? null : 'filter leaked')));
  await expect('EMPLOYEE cannot read reports', employee, 'GET', '/reports/employees', null, status(403));
  await expect('MANAGER cannot read the payroll report', manager, 'GET', '/reports/payroll', null, status(403));

  console.log('\n--- AUDIT ---');
  await expect('audit list', auditor, 'GET', '/audit?limit=10', null, okAnd((r) => (r.data.data.length && r.data.meta.total > 0 ? null : 'empty')));
  await expect('audit pagination', auditor, 'GET', '/audit?limit=5&page=2', null, okAnd((r) => (r.data.meta.page === 2 ? null : 'page not honoured')));
  await expect('audit module filter', auditor, 'GET', '/audit?module=EMPLOYEES&limit=5', null, okAnd((r) => (r.data.data.every((l) => l.module === 'EMPLOYEES') ? null : 'filter leaked')));
  await expect('audit date filter', auditor, 'GET', `/audit?startDate=${new Date().toISOString().slice(0, 10)}&limit=5`, null, ok);
  const auditRow = (await call(auditor, 'GET', '/audit?limit=1')).data.data[0];
  await expect('audit detail', auditor, 'GET', `/audit/${auditRow._id}`, null, ok);
  await expect('audit filter options', auditor, 'GET', '/audit/filters', null, okAnd((r) => (r.data.data.modules.length ? null : 'no modules')));
  await expect('HR cannot read the audit log', hr, 'GET', '/audit', null, status(403));
  await expect('EMPLOYEE cannot read the audit log', employee, 'GET', '/audit', null, status(403));
  await expect('audit log has no delete route', auditor, 'DELETE', `/audit/${auditRow._id}`, null, status(404));

  console.log('\n--- NOTIFICATIONS ---');
  await expect('notification list', employee, 'GET', '/notifications', null, okAnd((r) => (typeof r.data.meta.unreadCount === 'number' ? null : 'no unread count')));
  const notif = (await call(employee, 'GET', '/notifications?limit=1')).data.data[0];
  if (notif) {
    await expect('mark notification read', employee, 'PATCH', `/notifications/${notif._id}/read`, null, ok);
    await expect("cannot mark another user's notification read", admin, 'PATCH', `/notifications/${notif._id}/read`, null, status(404));
  }
  await expect('mark all read', employee, 'PATCH', '/notifications/read-all', null, ok);
  await expect('unread count is zero afterwards', employee, 'GET', '/notifications', null, okAnd((r) => (r.data.meta.unreadCount === 0 ? null : `still ${r.data.meta.unreadCount}`)));

  console.log('\n--- MISC ---');
  await expect('unknown API route returns JSON 404', admin, 'GET', '/does-not-exist', null, (res) => {
    if (res.status !== 404) return `expected 404, got ${res.status}`;
    if (!res.data?.error) return 'response was not a JSON error';
    return null;
  });
  await expect('archive employee', admin, 'POST', `/employees/${newId}/archive`, null, ok);
  await expect('archiving twice is refused', admin, 'POST', `/employees/${newId}/archive`, null, status(400));
  await expect('logout', employee, 'POST', '/auth/logout', null, ok);

  console.log(`\n${'='.repeat(56)}`);
  console.log(`PASSED ${passed}   FAILED ${failed}`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log('='.repeat(56));
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
