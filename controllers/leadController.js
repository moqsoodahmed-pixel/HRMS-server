"use strict";
const { Lead } = require("../models/Lead");
const { AppError } = require("../middleware/errorHandler");
const { isElevated } = require("../utils/roles");
const { parsePagination } = require("../utils/helpers");

/**
 * Roles that are allowed to upload leads (in addition to elevated roles).
 * PROJECT_HEAD is included here so they can upload CSV/Excel files.
 */
const UPLOAD_ROLES = ["PROJECT_HEAD"];

/** Returns true when the caller may upload leads. */
function canUpload(role) {
  return isElevated(role) || UPLOAD_ROLES.includes(role);
}

/**
 * Parses a CSV buffer into an array of row objects.
 * Handles both comma and semicolon delimiters, trims whitespace,
 * and strips BOM characters that Excel sometimes adds.
 */
function parseCSV(buffer) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, ""); // strip BOM
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new AppError("CSV file must have a header row and at least one data row", 400, "INVALID_FILE");

  // Auto-detect delimiter
  const delimiter = lines[0].includes(";") ? ";" : ",";

  const headers = lines[0].split(delimiter).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));

  return lines.slice(1).map((line) => {
    const values = line.split(delimiter).map((v) => v.trim().replace(/^"|"$/g, ""));
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] || ""; });
    return row;
  });
}

/**
 * Maps a parsed row to a Lead document shape.
 */
function rowToLead(row, uploadedBy, uploadBatch) {
  const get = (...keys) => {
    for (const k of keys) {
      const val = row[k] || row[k.replace(/_/g, "")] || row[k.replace(/_/g, " ")];
      if (val && val.trim()) return val.trim();
    }
    return "";
  };

  const name = get("name", "full_name", "fullname", "contact_name", "customer_name", "lead_name");
  if (!name) return null; // skip empty rows

  const statusRaw = get("status", "lead_status", "stage").toUpperCase();
  const VALID_STATUSES = ["NEW", "CONTACTED", "INTERESTED", "NOT_INTERESTED", "CONVERTED", "LOST"];
  const status = VALID_STATUSES.includes(statusRaw) ? statusRaw : "NEW";

  return {
    name,
    phone: get("phone", "mobile", "phone_number", "mobile_number", "contact", "contact_number"),
    email: get("email", "email_address", "mail"),
    company: get("company", "company_name", "organization", "organisation", "firm"),
    notes: get("notes", "note", "remarks", "comment", "comments"),
    status,
    uploadedBy,
    uploadBatch,
    assignedTo: null, // will be set during distribution
  };
}

/**
 * Distributes leads equally among sales team members.
 * base = Math.floor(total / count); first `remainder` members get one extra.
 * Returns leads array with assignedTo populated.
 */
async function distributeLeads(leads, uploadedBy) {
  const { Employee } = require("../models/Employee");

  // Find all active employees in the Sales department
  const salesTeam = await Employee.find({
    department: { $regex: /^sales$/i },
    status: { $in: ["ACTIVE", "active", "Active"] },
  })
    .select("_id fullName")
    .lean();

  if (salesTeam.length === 0) {
    // No sales team found — assign all to uploader's employee record, or leave null
    // We still import the leads; just leave assignedTo as null so admins can assign later
    return { leads, salesTeam: [], note: "No active Sales department employees found — leads imported unassigned." };
  }

  const total = leads.length;
  const count = salesTeam.length;
  const base = Math.floor(total / count);
  const remainder = total % count;

  let cursor = 0;
  const distribution = [];

  salesTeam.forEach((member, idx) => {
    const extra = idx < remainder ? 1 : 0;
    const assigned = base + extra;
    distribution.push({ member, assigned, startIndex: cursor, endIndex: cursor + assigned });
    cursor += assigned;
  });

  // Stamp assignedTo on each lead
  distribution.forEach(({ member, startIndex, endIndex }) => {
    for (let i = startIndex; i < endIndex; i++) {
      leads[i].assignedTo = member._id;
    }
  });

  const note =
    remainder === 0
      ? `${base} leads each across ${count} sales team member(s)`
      : `${base}–${base + 1} leads each across ${count} sales team member(s) (${remainder} member(s) get one extra)`;

  return {
    leads,
    salesTeam: distribution.map(({ member, assigned }) => ({ name: member.fullName, assigned })),
    note,
  };
}

/**
 * POST /api/leads/upload
 * FOUNDER_CEO, CTO, and PROJECT_HEAD may upload.
 * Parses every row, distributes equally to the sales team, and bulk-inserts.
 */
const uploadLeads = async (req, res, next) => {
  try {
    if (!canUpload(req.user?.role)) {
      throw new AppError("Only Founder/CEO, CTO, or Project Head can upload leads", 403, "FORBIDDEN");
    }

    if (!req.file) {
      throw new AppError("No file uploaded. Please attach a CSV or Excel file.", 400, "NO_FILE");
    }

    const { mimetype, buffer, originalname } = req.file;
    const isCSV = mimetype === "text/csv" || originalname.endsWith(".csv");
    const isExcel =
      mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimetype === "application/vnd.ms-excel" ||
      originalname.endsWith(".xlsx") ||
      originalname.endsWith(".xls");

    if (!isCSV && !isExcel) {
      throw new AppError("Only CSV (.csv) and Excel (.xlsx / .xls) files are supported", 400, "INVALID_FILE_TYPE");
    }

    let rows = [];

    if (isCSV) {
      rows = parseCSV(buffer);
    } else {
      let XLSX;
      try {
        XLSX = require("xlsx");
      } catch {
        throw new AppError(
          "Excel parsing requires the 'xlsx' package. Run: npm install xlsx in HRMS-server, then restart.",
          500,
          "MISSING_DEPENDENCY"
        );
      }
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const csvText = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
      rows = parseCSV(Buffer.from(csvText));
    }

    const uploadBatch = new Date().toISOString();
    let leads = rows
      .map((row) => rowToLead(row, req.user.userId, uploadBatch))
      .filter(Boolean);

    if (leads.length === 0) {
      throw new AppError(
        "No valid leads found in the file. Make sure your columns include at least a 'name' column.",
        400,
        "NO_VALID_ROWS"
      );
    }

    // Distribute equally across the sales team
    const { leads: distributedLeads, salesTeam, note } = await distributeLeads(leads, req.user.userId);

    const inserted = await Lead.insertMany(distributedLeads, { ordered: false });

    res.status(201).json({
      data: {
        imported: inserted.length,
        skipped: leads.length - inserted.length,
        uploadBatch,
        salesTeamCount: salesTeam.length,
        distribution: salesTeam,
        distributionNote: note,
        message: `Successfully imported ${inserted.length} lead${inserted.length !== 1 ? "s" : ""} and distributed equally among ${salesTeam.length} sales team member(s).`,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/leads
 * Sales team + Elevated roles. Returns paginated leads with optional filters.
 * Sales team members (EMPLOYEE role) only see leads assigned to them.
 * Query params: page, limit, status, search, uploadBatch
 */
const getLeads = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, 50);
    const { status, search, uploadBatch } = req.query;

    const query = {};

    // Sales-team employees only see their own assigned leads
    if (req.user?.role === "EMPLOYEE") {
      const { Employee } = require("../models/Employee");
      const emp = await Employee.findOne({ user: req.user.userId }).select("_id").lean();
      if (emp) query.assignedTo = emp._id;
    }

    if (status) query.status = status;
    if (uploadBatch) query.uploadBatch = uploadBatch;
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ name: re }, { email: re }, { phone: re }, { company: re }];
    }

    const [leads, total] = await Promise.all([
      Lead.find(query)
        .populate("uploadedBy", "email")
        .populate("assignedTo", "fullName employeeCode")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Lead.countDocuments(query),
    ]);

    res.json({
      data: leads,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/leads/:id/status
 * Sales team + Elevated. Updates a lead's status and optional notes.
 */
const updateLeadStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const VALID_STATUSES = ["NEW", "CONTACTED", "INTERESTED", "NOT_INTERESTED", "CONVERTED", "LOST"];
    if (!VALID_STATUSES.includes(status)) {
      throw new AppError(`Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`, 400, "INVALID_STATUS");
    }

    const lead = await Lead.findByIdAndUpdate(
      id,
      { status, ...(notes !== undefined ? { notes } : {}) },
      { new: true }
    );
    if (!lead) throw new AppError("Lead not found", 404, "NOT_FOUND");

    res.json({ data: lead });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/leads/batches
 * Returns distinct upload batches. Elevated + PROJECT_HEAD.
 */
const getUploadBatches = async (req, res, next) => {
  try {
    if (!canUpload(req.user?.role)) {
      throw new AppError("Forbidden", 403, "FORBIDDEN");
    }
    const batches = await Lead.distinct("uploadBatch");
    res.json({ data: batches.sort().reverse() });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/leads/batch/:batch
 * Elevated + PROJECT_HEAD only.
 */
const deleteBatch = async (req, res, next) => {
  try {
    if (!canUpload(req.user?.role)) {
      throw new AppError("Forbidden", 403, "FORBIDDEN");
    }
    const { batch } = req.params;
    const result = await Lead.deleteMany({ uploadBatch: decodeURIComponent(batch) });
    res.json({ data: { deleted: result.deletedCount } });
  } catch (err) {
    next(err);
  }
};

module.exports = { uploadLeads, getLeads, updateLeadStatus, getUploadBatches, deleteBatch };
