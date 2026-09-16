"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const employeeController_1 = require("../controllers/employeeController");
const employeeEditRequestController_1 = require("../controllers/employeeEditRequestController");
const { authenticate, authorize, requireOnboardingApproved } = require("../middleware/auth");
const upload_1 = require("../middleware/upload");
const { HR_ROLES, HR_MANAGER_ROLES, ELEVATED_ROLES } = require("../utils/roles");

const router = (0, express_1.Router)();
const HR = HR_ROLES;
const HR_MANAGER = HR_MANAGER_ROLES;

// Declare DELETE_ROLES before any route that references it.
// Change password — HR_ADMIN, PROJECT_HEAD, and elevated roles.
// Permanent delete — restricted to elevated roles (FOUNDER_CEO / CTO) and HR_ADMIN only.
const DELETE_ROLES = [...ELEVATED_ROLES, 'HR_ADMIN', 'PROJECT_HEAD'];

router.use(authenticate);

router.get('/', employeeController_1.getEmployees);
// Static paths must be declared before `/:id` so they are not read as an id.
router.get('/options', employeeController_1.getFilterOptions);
// Employee self-service "request a profile change" — minimal new flow (see
// employeeEditRequestController.js). Not HR-gated: any employee may request a
// change to their OWN record; the controller resolves ownership from the
// authenticated session, never from the request body.
router.post('/edit-requests/me', requireOnboardingApproved(), employeeEditRequestController_1.createEditRequest);
router.get('/edit-requests', authorize(...HR_MANAGER), employeeEditRequestController_1.listEditRequests);
router.get('/edit-requests/:id', authorize(...HR_MANAGER), employeeEditRequestController_1.getEditRequest);
router.patch('/edit-requests/:id/approve', authorize(...HR), employeeEditRequestController_1.approveEditRequest);
router.patch('/edit-requests/:id/reject', authorize(...HR), employeeEditRequestController_1.rejectEditRequest);
router.post('/', authorize(...HR), employeeController_1.createEmployee);
router.post('/import', authorize(...HR), employeeController_1.importEmployees);
router.get('/:id', employeeController_1.getEmployee);
router.patch('/:id', authorize(...HR), employeeController_1.updateEmployee);
router.post('/:id/archive', authorize(...HR), employeeController_1.archiveEmployee);
// PATCH is accepted too — older clients call archive that way.
router.patch('/:id/archive', authorize(...HR), employeeController_1.archiveEmployee);
router.patch('/:id/password', authorize(...DELETE_ROLES), employeeController_1.changeEmployeePassword);
router.delete('/:id', authorize(...DELETE_ROLES), employeeController_1.deleteEmployee);
router.post('/:id/photo', authorize(...HR, 'EMPLOYEE'), upload_1.uploadImage.single('photo'), employeeController_1.uploadPhoto);

exports.default = router;