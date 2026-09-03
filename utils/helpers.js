"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEPARTMENTS = void 0;
exports.isValidObjectId = isValidObjectId;
exports.assertObjectId = assertObjectId;
exports.parsePagination = parsePagination;
exports.escapeRegex = escapeRegex;
exports.searchRegex = searchRegex;
exports.startOfDay = startOfDay;
exports.endOfDay = endOfDay;
exports.dateRangeQuery = dateRangeQuery;
exports.resolveEmployeeScope = resolveEmployeeScope;
exports.isIdInScope = isIdInScope;
exports.assertIdInScope = assertIdInScope;
const mongoose_1 = require("mongoose");
const errorHandler_1 = require("../middleware/errorHandler");
const Employee_1 = require("../models/Employee");
const roles_1 = require("./roles");

/** Canonical department list — mirrored by client/src/constants.js. */
exports.DEPARTMENTS = [
    'Management', 'Engineering', 'Finance', 'Operations', 'HR',
    'Sales', 'Marketing', 'IT', 'Legal', 'Design',
];

function isValidObjectId(id) {
    return typeof id === 'string'
        && mongoose_1.Types.ObjectId.isValid(id)
        && String(new mongoose_1.Types.ObjectId(id)) === id;
}

/** Throws a 400 AppError when `id` is not a well-formed ObjectId. */
function assertObjectId(id, label = 'id') {
    if (!isValidObjectId(id)) {
        throw new errorHandler_1.AppError(`Invalid ${label}`, 400, 'INVALID_ID');
    }
    return id;
}

/** Clamped page/limit parsing so a client cannot request an unbounded page. */
function parsePagination(query, defaultLimit = 20, maxLimit = 200) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const rawLimit = parseInt(query.limit, 10) || defaultLimit;
    const limit = Math.min(Math.max(1, rawLimit), maxLimit);
    return { page, limit, skip: (page - 1) * limit };
}

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(value) {
    return String(value).replace(REGEX_SPECIALS, '\\$&');
}

function searchRegex(value) {
    return { $regex: escapeRegex(value), $options: 'i' };
}

function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function endOfDay(date) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
}

/** Builds a `{ $gte, $lte }` clause, or null when neither bound was supplied. */
function dateRangeQuery(startDate, endDate) {
    if (!startDate && !endDate) return null;
    const clause = {};
    if (startDate) clause.$gte = startOfDay(startDate);
    if (endDate) clause.$lte = endOfDay(endDate);
    return clause;
}

/**
 * Resolves which employees the caller may see.
 *  - EMPLOYEE                        → only themselves
 *  - a TEAM_SCOPED_ROLES role
 *    (MANAGER, PROJECT_HEAD)         → themselves plus direct reports
 *  - a DEPARTMENT_SCOPED_ROLES role
 *    (e.g. IT_HEAD)                  → every employee in their own department
 *  - everyone else                   → unrestricted (`scope: undefined`)
 * Returns `{ scope, employee, restricted }` where `scope` is a mongo clause for
 * the `employee` field. A restricted caller with no linked employee record gets
 * `scope: null`, which deliberately matches nothing rather than everything.
 * Team/department scoping is driven entirely by the caller's own linked
 * Employee record (their `manager` chain or `department`) — never a
 * client-supplied filter — so it cannot be bypassed by query parameters.
 */
async function resolveEmployeeScope(user) {
    const self = await Employee_1.Employee.findOne({ user: user?.userId })
        .select('_id fullName employeeCode department designation')
        .lean();
    if (user?.role === 'EMPLOYEE') {
        return { scope: self ? self._id : null, employee: self, restricted: true };
    }
    if (roles_1.isTeamScoped(user?.role)) {
        if (!self) return { scope: null, employee: null, restricted: true };
        const reports = await Employee_1.Employee.find({ manager: self._id }).select('_id').lean();
        return {
            scope: { $in: [self._id, ...reports.map((r) => r._id)] },
            employee: self,
            restricted: true,
        };
    }
    if (roles_1.isDepartmentScoped(user?.role)) {
        if (!self) return { scope: null, employee: null, restricted: true };
        const deptPeers = await Employee_1.Employee.find({ department: self.department }).select('_id').lean();
        return {
            scope: { $in: deptPeers.map((e) => e._id) },
            employee: self,
            restricted: true,
        };
    }
    return { scope: undefined, employee: self, restricted: false };
}

/** True when `id` falls inside a resolveEmployeeScope() `scope` value. */
function isIdInScope(scope, id) {
    if (scope === undefined) return true;
    if (scope === null || id === undefined || id === null) return false;
    if (scope.$in) return scope.$in.map(String).includes(String(id));
    return String(scope) === String(id);
}

/** Throws a 403 AppError unless `id` falls inside `scope`. */
function assertIdInScope(scope, id, message = 'Access denied') {
    if (!isIdInScope(scope, id)) {
        throw new errorHandler_1.AppError(message, 403, 'FORBIDDEN');
    }
}
