# DutyLaunch HRMS - MERN Stack

Full-stack HR Management System built with MongoDB, Express, React, and Node.js.

## Project Structure

```
dutylaunch-hrms/
├── client/                    # React Frontend (Vite + Tailwind)
│   ├── src/
│   │   ├── api/axios.js       # API client (all endpoints)
│   │   ├── context/           # Auth context
│   │   ├── components/        # Reusable UI components
│   │   │   ├── Sidebar.jsx
│   │   │   ├── Header.jsx
│   │   │   ├── Layout.jsx
│   │   │   ├── Modal.jsx
│   │   │   ├── EmptyState.jsx
│   │   │   └── Spinner.jsx
│   │   ├── pages/             # All page components
│   │   │   ├── Login.jsx
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Employees.jsx
│   │   │   ├── EmployeeDetail.jsx
│   │   │   ├── EmployeeForm.jsx
│   │   │   └── ... (12 more pages)
│   │   └── App.jsx            # Router setup
│   ├── package.json
│   └── vite.config.js
│
├── server/                    # Express Backend
│   ├── config/database.js
│   ├── controllers/           # 10 controllers
│   ├── middleware/             # Auth, errors, upload
│   ├── models/                # 9 Mongoose models
│   ├── routes/                # API routes
│   ├── services/              # Email, audit, PDF, storage
│   ├── seed/seed.js           # Database seeder
│   ├── app.js                 # Express setup
│   ├── server.js              # Entry point
│   └── package.json
│
└── README.md
```

## Quick Start

### 1. Backend
```bash
cd server
npm install
cp .env.example .env     # Edit with your MongoDB URI + JWT secret
node seed/seed.js         # Seed database
npm run dev               # Runs on port 5000
```

### 2. Frontend
```bash
cd client
npm install
npm run dev               # Runs on port 5173, proxies API to 5000
```

### 3. Open
http://localhost:5173

### Default Login
- Email: admin@launcherdesk.com
- Password: Admin@123456

## Tech Stack
- **Frontend:** React 18, Vite, Tailwind CSS, React Query, React Router, Axios, Lucide Icons
- **Backend:** Node.js, Express, MongoDB, Mongoose, JWT, Zod, Multer, PDFKit, Nodemailer
- **Auth:** Cookie-based JWT with role-based access control

## Features
- Employee Management (CRUD, Import, Archive)
- Attendance (Check-in/out)
- Leave Management (Apply, Approve, Reject)
- Payroll (Salary structures, Payslips, PDF generation)
- Document Management (Upload, Verify, Download)
- Identity Documents (Encrypted)
- Announcements & Policies
- Asset Management
- Onboarding / Offboarding
- Audit Logs (Immutable)
- Role-based Access: Super Admin, HR Admin, Finance, Manager, Employee, Auditor
