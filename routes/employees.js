"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const employeeController_1 = require("../controllers/employeeController");
const { authenticate, authorize } = require("../middleware/auth");
const upload_1 = require("../middleware/upload");
const { HR_ROLES } = require("../utils/roles");

const router = (0, express_1.Router)();
const HR = HR_ROLES;

router.use(authenticate);

router.get('/', employeeController_1.getEmployees);
// Static paths must be declared before `/:id` so they are not read as an id.
router.get('/options', employeeController_1.getFilterOptions);
router.post('/', authorize(...HR), employeeController_1.createEmployee);
router.post('/import', authorize(...HR), employeeController_1.importEmployees);
router.get('/:id', employeeController_1.getEmployee);
router.patch('/:id', authorize(...HR), employeeController_1.updateEmployee);
router.post('/:id/archive', authorize(...HR), employeeController_1.archiveEmployee);
// PATCH is accepted too — older clients call archive that way.
router.patch('/:id/archive', authorize(...HR), employeeController_1.archiveEmployee);
router.post('/:id/photo', authorize(...HR, 'EMPLOYEE'), upload_1.uploadImage.single('photo'), employeeController_1.uploadPhoto);

exports.default = router;
