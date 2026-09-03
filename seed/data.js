"use strict";
/**
 * Static seed data for the DutyLaunch HRMS demo database.
 * Kept separate from seed.js so the dataset is easy to read and extend.
 */
Object.defineProperty(exports, "__esModule", { value: true });

/** The nine original DutyLaunch records — preserved exactly as they were. */
const foundingEmployees = [
    { employeeCode: 'DL001', firstName: 'Moqsood Ahmed', lastName: 'Abdul', officialEmail: 'moqsood@launcherdesk.com', designation: 'Founder & CEO', department: 'Management', status: 'ACTIVE', dateOfJoining: '2025-12-01', employmentType: 'FULL_TIME', role: 'FOUNDER_CEO', dateOfBirth: '1985-03-14', gender: 'Male', workLocation: 'Bengaluru HQ' },
    { employeeCode: 'DL002', firstName: 'Santhosh', lastName: 'Kolar Ramesh', officialEmail: 'santhosh@launcherdesk.com', designation: 'COO', department: 'Management', status: 'INACTIVE', dateOfJoining: '2025-12-01', dateOfExit: '2026-01-11', exitReason: 'Resigned', employmentType: 'FULL_TIME', role: 'EMPLOYEE', dateOfBirth: '1987-07-02', gender: 'Male', workLocation: 'Bengaluru HQ' },
    { employeeCode: 'DL003', firstName: 'Junaid', lastName: 'Khan', officialEmail: 'junaid@launcherdesk.com', designation: 'Director', department: 'Management', status: 'INACTIVE', dateOfJoining: '2025-12-01', dateOfExit: '2026-01-11', exitReason: 'Resigned', employmentType: 'FULL_TIME', role: 'EMPLOYEE', dateOfBirth: '1986-11-23', gender: 'Male', workLocation: 'Bengaluru HQ' },
    { employeeCode: 'DL004', firstName: 'Umme', lastName: 'Saani', officialEmail: 'umme@launcherdesk.com', designation: 'Developer', department: 'Engineering', status: 'INACTIVE', dateOfJoining: '2025-12-01', dateOfExit: '2026-01-11', exitReason: 'Resigned', employmentType: 'FULL_TIME', role: 'EMPLOYEE', dateOfBirth: '1996-05-09', gender: 'Female', workLocation: 'Bengaluru HQ' },
    { employeeCode: 'DL005', firstName: 'Ameena', lastName: 'Nikhath', officialEmail: 'ameena@launcherdesk.com', designation: 'Director', department: 'Management', status: 'ACTIVE', dateOfJoining: '2026-01-11', employmentType: 'FULL_TIME', role: 'DIRECTOR', dateOfBirth: '1990-09-05', gender: 'Female', workLocation: 'Bengaluru HQ' },
    { employeeCode: 'DL006', firstName: 'Aakash', lastName: 'Pani', officialEmail: 'aakash@launcherdesk.com', designation: 'Junior Accounts Executive', department: 'Finance', status: 'INACTIVE', dateOfJoining: '2026-07-26', employmentType: 'FULL_TIME', role: 'FINANCE', dateOfBirth: '1999-02-18', gender: 'Male', workLocation: 'Bengaluru HQ' },
    // Bhojraj holds the CTO role, which carries FOUNDER_CEO-equivalent effective
    // permissions (see server/utils/roles.js ELEVATED_ROLES) while keeping his
    // own identifiable title — never disguised as FOUNDER_CEO.
    { employeeCode: 'DL007', firstName: 'Bhojraj', lastName: 'R', officialEmail: 'bhojraj@launcherdesk.com', designation: 'Director & CTO', department: 'Management', status: 'ACTIVE', dateOfJoining: '2026-09-01', employmentType: 'FULL_TIME', role: 'CTO', dateOfBirth: '1993-08-30', gender: 'Male', workLocation: 'Bengaluru HQ' },
    // Srinivas leads a project team — his role/department drive team-scoped
    // access everywhere (see utils/roles.js TEAM_SCOPED_ROLES: self + direct
    // reports via Employee.manager), never his name.
    { employeeCode: 'DL008', firstName: 'Srinivas', lastName: 'Kumar', officialEmail: 'srinivas@launcherdesk.com', designation: 'Project Head', department: 'Engineering', status: 'ACTIVE', dateOfJoining: '2026-08-16', employmentType: 'FULL_TIME', role: 'PROJECT_HEAD', dateOfBirth: '1991-04-12', gender: 'Male', workLocation: 'Bengaluru HQ' },
    { employeeCode: 'DL009', firstName: 'Jeevan', lastName: 'Reddy', officialEmail: 'jeevan@launcherdesk.com', designation: 'Full Stack Trainee', department: 'Engineering', status: 'ACTIVE', dateOfJoining: '2026-08-20', employmentType: 'INTERN', role: 'EMPLOYEE', dateOfBirth: '2002-06-21', gender: 'Male', workLocation: 'Bengaluru HQ' },
];

/**
 * Demo staff filling out every department so tables, filters and reports have
 * something meaningful to show. `managerCode` refers to another employeeCode.
 */
const demoEmployees = [
    // Engineering
    { employeeCode: 'DL010', firstName: 'Priya', lastName: 'Nair', designation: 'Senior Software Engineer', department: 'Engineering', managerCode: 'DL008', dateOfJoining: '2026-02-02', dateOfBirth: '1994-09-03', gender: 'Female', basic: 78000 },
    { employeeCode: 'DL011', firstName: 'Arjun', lastName: 'Mehta', designation: 'Software Engineer', department: 'Engineering', managerCode: 'DL008', dateOfJoining: '2026-03-09', dateOfBirth: '1997-01-27', gender: 'Male', basic: 62000 },
    { employeeCode: 'DL012', firstName: 'Fatima', lastName: 'Sheikh', designation: 'QA Engineer', department: 'Engineering', managerCode: 'DL008', dateOfJoining: '2026-04-06', dateOfBirth: '1998-12-11', gender: 'Female', basic: 54000 },
    { employeeCode: 'DL013', firstName: 'Rohit', lastName: 'Deshpande', designation: 'DevOps Engineer', department: 'Engineering', managerCode: 'DL007', dateOfJoining: '2026-05-11', dateOfBirth: '1995-06-19', gender: 'Male', basic: 71000 },
    { employeeCode: 'DL014', firstName: 'Sneha', lastName: 'Iyer', designation: 'Frontend Engineer', department: 'Engineering', managerCode: 'DL008', status: 'PROBATION', dateOfJoining: '2026-07-06', dateOfBirth: '1999-08-25', gender: 'Female', basic: 52000 },
    // Design
    { employeeCode: 'DL015', firstName: 'Kabir', lastName: 'Sethi', designation: 'Design Lead', department: 'Design', managerCode: 'DL005', dateOfJoining: '2026-02-16', dateOfBirth: '1992-10-08', gender: 'Male', basic: 68000 },
    { employeeCode: 'DL016', firstName: 'Ananya', lastName: 'Ghosh', designation: 'Product Designer', department: 'Design', managerCode: 'DL015', dateOfJoining: '2026-04-20', dateOfBirth: '1996-03-30', gender: 'Female', basic: 55000 },
    { employeeCode: 'DL017', firstName: 'Vikram', lastName: 'Rao', designation: 'UX Researcher', department: 'Design', managerCode: 'DL015', dateOfJoining: '2026-06-01', dateOfBirth: '1994-11-17', gender: 'Male', basic: 51000 },
    // Finance
    { employeeCode: 'DL018', firstName: 'Meera', lastName: 'Krishnan', designation: 'Finance Manager', department: 'Finance', managerCode: 'DL001', dateOfJoining: '2026-01-19', dateOfBirth: '1988-05-06', gender: 'Female', role: 'FINANCE', basic: 85000 },
    { employeeCode: 'DL019', firstName: 'Harish', lastName: 'Patel', designation: 'Accounts Executive', department: 'Finance', managerCode: 'DL018', dateOfJoining: '2026-03-23', dateOfBirth: '1997-07-14', gender: 'Male', basic: 42000 },
    { employeeCode: 'DL020', firstName: 'Neha', lastName: 'Bansal', designation: 'Payroll Specialist', department: 'Finance', managerCode: 'DL018', dateOfJoining: '2026-05-04', dateOfBirth: '1995-02-09', gender: 'Female', basic: 48000 },
    // HR
    { employeeCode: 'DL021', firstName: 'Divya', lastName: 'Menon', designation: 'HR Business Partner', department: 'HR', managerCode: 'DL005', dateOfJoining: '2026-02-09', dateOfBirth: '1993-04-22', gender: 'Female', role: 'HR_ADMIN', basic: 64000 },
    { employeeCode: 'DL022', firstName: 'Imran', lastName: 'Qureshi', designation: 'Talent Acquisition Specialist', department: 'HR', managerCode: 'DL021', dateOfJoining: '2026-04-13', dateOfBirth: '1996-09-28', gender: 'Male', basic: 46000 },
    { employeeCode: 'DL023', firstName: 'Lakshmi', lastName: 'Subramanian', designation: 'HR Executive', department: 'HR', managerCode: 'DL021', status: 'PROBATION', dateOfJoining: '2026-07-20', dateOfBirth: '2000-01-15', gender: 'Female', basic: 34000 },
    // Sales
    { employeeCode: 'DL024', firstName: 'Rahul', lastName: 'Verma', designation: 'Sales Director', department: 'Sales', managerCode: 'DL001', dateOfJoining: '2026-01-26', dateOfBirth: '1986-12-04', gender: 'Male', basic: 92000 },
    { employeeCode: 'DL025', firstName: 'Pooja', lastName: 'Shah', designation: 'Account Executive', department: 'Sales', managerCode: 'DL024', dateOfJoining: '2026-03-16', dateOfBirth: '1994-06-11', gender: 'Female', basic: 50000 },
    { employeeCode: 'DL026', firstName: 'Suresh', lastName: 'Babu', designation: 'Business Development Manager', department: 'Sales', managerCode: 'DL024', dateOfJoining: '2026-05-18', dateOfBirth: '1990-08-07', gender: 'Male', basic: 58000 },
    { employeeCode: 'DL027', firstName: 'Aisha', lastName: 'Rahman', designation: 'Inside Sales Representative', department: 'Sales', managerCode: 'DL024', dateOfJoining: '2026-06-22', dateOfBirth: '1998-10-30', gender: 'Female', basic: 38000 },
    // Marketing
    { employeeCode: 'DL028', firstName: 'Nikhil', lastName: 'Joshi', designation: 'Marketing Manager', department: 'Marketing', managerCode: 'DL024', dateOfJoining: '2026-02-23', dateOfBirth: '1992-02-26', gender: 'Male', basic: 66000 },
    { employeeCode: 'DL029', firstName: 'Tanvi', lastName: 'Kulkarni', designation: 'Content Strategist', department: 'Marketing', managerCode: 'DL028', dateOfJoining: '2026-04-27', dateOfBirth: '1997-05-19', gender: 'Female', basic: 44000 },
    { employeeCode: 'DL030', firstName: 'Gaurav', lastName: 'Malhotra', designation: 'Performance Marketing Analyst', department: 'Marketing', managerCode: 'DL028', dateOfJoining: '2026-06-15', dateOfBirth: '1996-11-02', gender: 'Male', basic: 47000 },
    // IT — reports to Srinivas (Head of IT), not Bhojraj.
    { employeeCode: 'DL031', firstName: 'Ravi', lastName: 'Chandran', designation: 'IT Administrator', department: 'IT', managerCode: 'DL008', dateOfJoining: '2026-03-02', dateOfBirth: '1991-09-13', gender: 'Male', basic: 56000 },
    { employeeCode: 'DL032', firstName: 'Shruti', lastName: 'Kapoor', designation: 'IT Support Engineer', department: 'IT', managerCode: 'DL031', dateOfJoining: '2026-05-25', dateOfBirth: '1998-03-21', gender: 'Female', basic: 39000 },
    // Operations
    { employeeCode: 'DL033', firstName: 'Manoj', lastName: 'Pillai', designation: 'Operations Manager', department: 'Operations', managerCode: 'DL001', dateOfJoining: '2026-02-02', dateOfBirth: '1989-07-08', gender: 'Male', basic: 72000 },
    { employeeCode: 'DL034', firstName: 'Kavya', lastName: 'Reddy', designation: 'Operations Analyst', department: 'Operations', managerCode: 'DL033', dateOfJoining: '2026-04-06', dateOfBirth: '1996-12-16', gender: 'Female', basic: 45000 },
    { employeeCode: 'DL035', firstName: 'Deepak', lastName: 'Sharma', designation: 'Facilities Coordinator', department: 'Operations', managerCode: 'DL033', dateOfJoining: '2026-06-08', dateOfBirth: '1993-01-09', gender: 'Male', basic: 36000 },
    // Legal
    { employeeCode: 'DL036', firstName: 'Sanjana', lastName: 'Bhat', designation: 'Legal Counsel', department: 'Legal', managerCode: 'DL001', dateOfJoining: '2026-03-30', dateOfBirth: '1990-04-03', gender: 'Female', basic: 88000 },
    { employeeCode: 'DL037', firstName: 'Aditya', lastName: 'Saxena', designation: 'Compliance Officer', department: 'Legal', managerCode: 'DL036', dateOfJoining: '2026-05-11', dateOfBirth: '1994-08-14', gender: 'Male', role: 'AUDITOR', basic: 61000 },
    // Management
    { employeeCode: 'DL038', firstName: 'Ritu', lastName: 'Agarwal', designation: 'Chief of Staff', department: 'Management', managerCode: 'DL001', dateOfJoining: '2026-01-12', dateOfBirth: '1988-10-27', gender: 'Female', basic: 95000 },
    // People on the way out — gives Offboarding real records to work with.
    { employeeCode: 'DL039', firstName: 'Varun', lastName: 'Chopra', designation: 'Software Engineer', department: 'Engineering', managerCode: 'DL008', status: 'NOTICE_PERIOD', dateOfJoining: '2026-02-16', dateOfExit: '2026-09-15', exitReason: 'Resigned — higher studies', noticePeriodDays: 30, dateOfBirth: '1995-05-23', gender: 'Male', basic: 60000 },
    { employeeCode: 'DL040', firstName: 'Ishita', lastName: 'Roy', designation: 'Account Executive', department: 'Sales', managerCode: 'DL024', status: 'NOTICE_PERIOD', dateOfJoining: '2026-03-02', dateOfExit: '2026-09-30', exitReason: 'Resigned — relocation', noticePeriodDays: 60, dateOfBirth: '1997-02-07', gender: 'Female', basic: 49000 },
];

const leaveTypes = [
    { name: 'Casual Leave', code: 'CL', maxDaysPerYear: 12, isPaid: true, isCarryForward: false, description: 'Short-notice personal leave.' },
    { name: 'Sick Leave', code: 'SL', maxDaysPerYear: 12, isPaid: true, isCarryForward: false, description: 'Illness and medical appointments.' },
    { name: 'Earned Leave', code: 'EL', maxDaysPerYear: 15, isPaid: true, isCarryForward: true, maxCarryForwardDays: 30, description: 'Accrued annual leave.' },
    { name: 'Maternity Leave', code: 'ML', maxDaysPerYear: 182, isPaid: true, isCarryForward: false, description: 'Statutory maternity leave.' },
    { name: 'Paternity Leave', code: 'PL', maxDaysPerYear: 15, isPaid: true, isCarryForward: false, description: 'Statutory paternity leave.' },
    { name: 'Unpaid Leave', code: 'UL', maxDaysPerYear: 30, isPaid: false, isCarryForward: false, description: 'Leave without pay.' },
    { name: 'Compensatory Off', code: 'CO', maxDaysPerYear: 12, isPaid: true, isCarryForward: false, description: 'Time off in lieu of extra hours worked.' },
];

/** Month/day pairs — the seeder stamps them with the current year. */
const holidays = [
    { name: 'New Year’s Day', month: 1, day: 1, type: 'NATIONAL' },
    { name: 'Republic Day', month: 1, day: 26, type: 'NATIONAL' },
    { name: 'Holi', month: 3, day: 4, type: 'NATIONAL' },
    { name: 'Ugadi', month: 3, day: 19, type: 'OPTIONAL' },
    { name: 'Good Friday', month: 4, day: 3, type: 'OPTIONAL' },
    { name: 'Labour Day', month: 5, day: 1, type: 'NATIONAL' },
    { name: 'Independence Day', month: 8, day: 15, type: 'NATIONAL' },
    { name: 'Ganesh Chaturthi', month: 9, day: 14, type: 'OPTIONAL' },
    { name: 'Gandhi Jayanti', month: 10, day: 2, type: 'NATIONAL' },
    { name: 'Dussehra', month: 10, day: 20, type: 'NATIONAL' },
    { name: 'Diwali', month: 11, day: 8, type: 'NATIONAL' },
    { name: 'Company Foundation Day', month: 12, day: 1, type: 'COMPANY' },
    { name: 'Christmas Day', month: 12, day: 25, type: 'NATIONAL' },
];

const policies = [
    {
        title: 'Code of Conduct', category: 'Conduct', version: '2.1', status: 'PUBLISHED', isAcknowledgementRequired: true,
        description: 'Expected standards of behaviour for everyone at DutyLaunch.',
        content: 'Every employee is expected to act with integrity, treat colleagues and clients with respect, and avoid conflicts of interest.\n\n1. Professional conduct — behave respectfully in all internal and external communication.\n2. Conflicts of interest — declare any outside interest that could affect your judgement.\n3. Confidentiality — company, client and colleague information stays inside the company.\n4. Anti-harassment — harassment or discrimination of any kind results in disciplinary action.\n5. Reporting — raise concerns with your manager or HR; reports are handled confidentially.',
    },
    {
        title: 'Leave and Attendance Policy', category: 'HR', version: '1.4', status: 'PUBLISHED', isAcknowledgementRequired: true,
        description: 'How leave is accrued, applied for and approved.',
        content: 'Standard working hours are 09:30 to 18:30, Monday to Friday.\n\nLeave entitlement per calendar year: 12 casual, 12 sick and 15 earned days. Earned leave may be carried forward up to 30 days.\n\nApply through the HRMS at least three working days in advance except for sick leave. Your reporting manager approves or rejects the request, and the balance updates automatically.\n\nMore than three consecutive sick days requires a medical certificate.',
    },
    {
        title: 'Information Security Policy', category: 'IT', version: '3.0', status: 'PUBLISHED', isAcknowledgementRequired: true,
        description: 'Protecting company and client data on every device.',
        content: 'Use strong, unique passwords and the company password manager. Multi-factor authentication is mandatory on all business accounts.\n\nCompany data must stay on approved systems. Do not copy client data to personal storage or unapproved cloud services.\n\nDevices must have full-disk encryption and automatic screen lock enabled. Report any lost device or suspected breach to IT within one hour.',
    },
    {
        title: 'Remote and Hybrid Work Policy', category: 'HR', version: '1.2', status: 'PUBLISHED', isAcknowledgementRequired: false,
        description: 'Working arrangements outside the office.',
        content: 'Eligible roles may work remotely up to two days a week, agreed with the reporting manager.\n\nRemote days must be marked in the HRMS as Work From Home. You are expected to be reachable during core hours (11:00 to 17:00) and to attend on-site for planning and review meetings.',
    },
    {
        title: 'Expense and Reimbursement Policy', category: 'Finance', version: '1.1', status: 'PUBLISHED', isAcknowledgementRequired: false,
        description: 'What the company reimburses and how to claim it.',
        content: 'Business travel, client meals and approved training are reimbursable. Submit claims with receipts within 30 days of the expense.\n\nClaims above ₹10,000 need prior written approval from the department head. Reimbursements are paid with the following month’s salary.',
    },
    {
        title: 'Anti-Harassment and POSH Policy', category: 'Compliance', version: '2.0', status: 'PUBLISHED', isAcknowledgementRequired: true,
        description: 'Prevention of sexual harassment at the workplace.',
        content: 'DutyLaunch has zero tolerance for harassment of any kind. An Internal Committee is constituted under the POSH Act, 2013.\n\nComplaints may be raised in confidence with any Internal Committee member and are acknowledged within 48 hours. Retaliation against a complainant is itself a disciplinary offence.',
    },
    {
        title: 'Asset Usage Policy', category: 'IT', version: '1.0', status: 'PUBLISHED', isAcknowledgementRequired: false,
        description: 'Care and return of company equipment.',
        content: 'Company assets are issued for business use and recorded against your name in the HRMS asset register.\n\nYou are responsible for the condition of assigned equipment. Damage beyond fair wear and tear may be recovered. All assets must be returned before your last working day as part of offboarding.',
    },
    {
        title: 'Performance Review Framework', category: 'HR', version: '0.9', status: 'DRAFT', isAcknowledgementRequired: false,
        description: 'Draft framework for half-yearly performance conversations.',
        content: 'Reviews run twice a year, in April and October, covering goal achievement, capability growth and values.\n\nThis draft is under consultation with department heads and is not yet in effect.',
    },
    {
        title: 'Travel Policy (2025 edition)', category: 'Finance', version: '1.0', status: 'ARCHIVED', isAcknowledgementRequired: false,
        description: 'Superseded by the Expense and Reimbursement Policy.',
        content: 'This edition has been archived and replaced by the Expense and Reimbursement Policy v1.1.',
    },
];

const announcements = [
    { title: 'Quarterly all-hands on Friday', description: 'Our Q3 all-hands is this Friday at 16:00 in the main hall and on the usual video link. Leadership will cover the quarter’s results, the product roadmap and the hiring plan. Please send questions to your department head in advance.', priority: 'HIGH', targetAudience: 'ALL', daysAgo: 1 },
    { title: 'Payroll cut-off moved to the 22nd', description: 'From this month the payroll cut-off moves from the 25th to the 22nd. Submit expense claims and attendance corrections before then, otherwise they roll into the following cycle.', priority: 'URGENT', targetAudience: 'ALL', daysAgo: 3 },
    { title: 'New health insurance provider', description: 'Our group health cover moves to a new provider from next month. Coverage rises to ₹5,00,000 per family and now includes outpatient dental. Cards will be issued to your official email.', priority: 'HIGH', targetAudience: 'ALL', daysAgo: 6 },
    { title: 'Engineering: migration freeze next week', description: 'A production change freeze applies from Monday to Thursday while we migrate the primary database. Only incident fixes will be deployed. Plan releases accordingly.', priority: 'HIGH', targetAudience: 'DEPARTMENT', targetDepartments: ['Engineering', 'IT'], daysAgo: 2 },
    { title: 'Office closed for Ganesh Chaturthi', description: 'The office will be closed on 14 September for Ganesh Chaturthi. Support rota members will be contacted separately by their managers.', priority: 'MEDIUM', targetAudience: 'ALL', daysAgo: 8 },
    { title: 'Learning budget now live', description: 'Every employee has an annual learning budget of ₹25,000 for courses, certifications and conferences. Raise a request with your manager and finance will process it within a week.', priority: 'MEDIUM', targetAudience: 'ALL', daysAgo: 12 },
    { title: 'Sales: new CRM rollout', description: 'The new CRM goes live at the start of next month. Training sessions run twice this week — please attend one of them, and move active deals over before go-live.', priority: 'MEDIUM', targetAudience: 'DEPARTMENT', targetDepartments: ['Sales', 'Marketing'], daysAgo: 5 },
    { title: 'Update your emergency contacts', description: 'Please review the emergency contact and nominee details on your HRMS profile. If anything has changed, send the update to HR so the records stay accurate.', priority: 'LOW', targetAudience: 'ALL', daysAgo: 20 },
];

const assetCatalogue = [
    { name: 'MacBook Pro 14"', type: 'Laptop', brand: 'Apple', model: 'M3 Pro', value: 199000 },
    { name: 'MacBook Air 13"', type: 'Laptop', brand: 'Apple', model: 'M3', value: 114900 },
    { name: 'ThinkPad X1 Carbon', type: 'Laptop', brand: 'Lenovo', model: 'Gen 12', value: 165000 },
    { name: 'Latitude 5450', type: 'Laptop', brand: 'Dell', model: '5450', value: 92000 },
    { name: 'UltraSharp 27" Monitor', type: 'Monitor', brand: 'Dell', model: 'U2723QE', value: 58000 },
    { name: 'ProArt 24" Monitor', type: 'Monitor', brand: 'Asus', model: 'PA248QV', value: 24000 },
    { name: 'MX Master 3S Mouse', type: 'Peripheral', brand: 'Logitech', model: 'MX Master 3S', value: 9500 },
    { name: 'MX Keys Keyboard', type: 'Peripheral', brand: 'Logitech', model: 'MX Keys S', value: 11000 },
    { name: 'WH-1000XM5 Headset', type: 'Peripheral', brand: 'Sony', model: 'WH-1000XM5', value: 29990 },
    { name: 'iPhone 15', type: 'Mobile', brand: 'Apple', model: 'iPhone 15', value: 79900 },
    { name: 'Galaxy S24', type: 'Mobile', brand: 'Samsung', model: 'S24', value: 74999 },
    { name: 'iPad Air', type: 'Tablet', brand: 'Apple', model: 'Air M2', value: 59900 },
    { name: 'Ergonomic Chair', type: 'Furniture', brand: 'Featherlite', model: 'Optima', value: 18500 },
    { name: 'Standing Desk', type: 'Furniture', brand: 'Godrej', model: 'Elevate', value: 32000 },
    { name: 'Conference Speakerphone', type: 'Peripheral', brand: 'Jabra', model: 'Speak 750', value: 27000 },
];

// Categories mirror server/utils/documentRequirements.js exactly, so seeded
// documents can actually satisfy (or deliberately fail to satisfy) the
// mandatory-document checklist rather than just being decorative filler.
const documentCatalogue = [
    { name: 'Aadhaar Card', category: 'Aadhaar Card' },
    { name: 'PAN Card', category: 'PAN Card' },
    { name: 'Offer Letter', category: 'Offer Letter' },
    { name: 'Employment Contract', category: 'Contract' },
    { name: 'Bank Account Details', category: 'Bank Account Details' },
    { name: 'Degree Certificate', category: 'Educational Certificates' },
    { name: 'Previous Experience Letter', category: 'Experience Certificate' },
    { name: 'Address Proof', category: 'Address Proof' },
    { name: 'Passport-size Photograph', category: 'Passport-size Photo' },
    { name: 'Cancelled Cheque', category: 'Cancelled Cheque' },
];

const leaveReasons = [
    'Family function out of town.',
    'Down with a viral fever, resting on doctor’s advice.',
    'Personal work at the bank and registrar office.',
    'Short holiday planned with family.',
    'Medical check-up and follow-up consultation.',
    'Attending a cousin’s wedding.',
    'Moving house this week.',
    'Recovering from a dental procedure.',
    'Child’s school event.',
    'Extended weekend break.',
];

module.exports = {
    foundingEmployees,
    demoEmployees,
    leaveTypes,
    holidays,
    policies,
    announcements,
    assetCatalogue,
    documentCatalogue,
    leaveReasons,
};
