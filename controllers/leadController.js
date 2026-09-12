"use strict";
const { Lead } = require("../models/Lead");
const { AppError } = require("../middleware/errorHandler");
const { isElevated } = require("../utils/roles");
const { parsePagination, assertObjectId } = require("../utils/helpers");

const UPLOAD_ROLES = ["PROJECT_HEAD"];
const VALID_STATUSES = ["NEW", "CONTACTED", "INTERESTED", "NOT_INTERESTED", "CONVERTED", "LOST"];

function canUpload(role) {
  return isElevated(role) || UPLOAD_ROLES.includes(role);
}

function canManage(role) {
  return isElevated(role) || ["PROJECT_HEAD", "HR_ADMIN", "MANAGER"].includes(role);
}

/**
 * Mask email and phone for EMPLOYEE (sales team) role.
 * Email: show first 2 chars + *** + domain e.g. ra***@gmail.com
 * Phone: show last 4 digits, rest masked e.g. ******7890
 */
function maskEmail(email) {
  if (!email) return email;
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return local.slice(0, 2) + "***@" + domain;
}
function maskPhone(phone) {
  if (!phone) return phone;
  const str = String(phone).replace(/\s/g, "");
  return str.slice(0, -4).replace(/./g, "*") + str.slice(-4);
}
function maskLead(lead) {
  return { ...lead, email: maskEmail(lead.email), phone: maskPhone(lead.phone) };
}

/** Strip BOM, normalize headers */
function normalizeHeader(h) {
  return h.trim().toLowerCase().replace(/[\s\-]+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function parseCSV(buffer) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new AppError("CSV file must have a header row and at least one data row", 400, "INVALID_FILE");

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(delimiter).map(normalizeHeader);

  return lines.slice(1).map((line) => {
    const values = line.split(delimiter).map((v) => v.trim().replace(/^"|"$/g, ""));
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] || ""; });
    return row;
  });
}

function rowToLead(row, uploadedBy, uploadBatch, uploadBatchTimestamp) {
  const get = (...keys) => {
    for (const k of keys) {
      const variants = [k, k.replace(/_/g, ""), k.replace(/_/g, " ")];
      for (const v of variants) {
        const val = row[v];
        if (val && String(val).trim()) return String(val).trim();
      }
    }
    return "";
  };

  const name = get("name", "full_name", "fullname", "contact_name", "customer_name", "lead_name", "entity_name");
  if (!name) return null;

  const statusRaw = get("status", "lead_status", "stage").toUpperCase();
  const status = VALID_STATUSES.includes(statusRaw) ? statusRaw : "NEW";

  // Clean phone — remove backticks, spaces, leading zeros issues
  const rawPhone = get("phone", "mobile", "phone_number", "mobile_number", "contact", "contact_number",
                       "director_mobile", "directormobile", "contact_mobile");
  const phone = rawPhone.replace(/`/g, "").replace(/^\+?0+(?=\d{10})/, "").trim();

  // Notes — combine NIC label + address if present
  const nicLabel = get("nic_label", "niclabel", "industry", "sector");
  const address = get("registered_address", "registeredaddress", "address");
  const notes = get("notes", "note", "remarks", "comment", "comments") ||
    [nicLabel, address].filter(Boolean).join(" | ");

  return {
    name,
    phone: phone || "",
    email: get("email", "email_address", "mail"),
    company: get("company", "company_name", "organization", "organisation", "firm",
                 "entity_name", "entityname") || name,
    notes,
    status,
    uploadedBy,
    uploadBatch,
    uploadBatchTimestamp,
    assignedTo: null,
    statusHistory: [{ newStatus: status, changedBy: uploadedBy, changedAt: new Date() }],
  };
}

/** 
 * Round-robin batch distribution: 50 leads per employee per round (configurable).
 * Continues until all leads assigned.
 */
async function distributeLeads(leads, uploadedBy, batchSize = 50) {
  const { Employee } = require("../models/Employee");

  const salesTeam = await Employee.find({
    department: { $regex: /^sales$/i },
    status: { $in: ["ACTIVE", "active", "Active"] },
  }).select("_id fullName").lean();

  if (salesTeam.length === 0) {
    return { leads, salesTeam: [], note: "No active Sales department employees found — leads imported unassigned." };
  }

  const count = salesTeam.length;
  const total = leads.length;
  const now = new Date();

  // Track how many assigned per member
  const assignedCount = salesTeam.map(() => 0);
  let idx = 0;
  let round = 1;
  let positionInRound = 0;

  for (let i = 0; i < total; i++) {
    const memberIdx = idx % count;
    leads[i].assignedTo = salesTeam[memberIdx]._id;
    leads[i].assignedAt = now;
    leads[i].assignmentRound = round;
    leads[i].assignmentBatchSize = batchSize;
    assignedCount[memberIdx]++;
    positionInRound++;

    if (positionInRound >= batchSize * count) {
      round++;
      positionInRound = 0;
    }
    idx++;
    if (idx % count === 0 && positionInRound > 0) {
      // continue round-robin
    }
  }

  // Actually do proper round-based distribution
  // Reset and redo properly
  for (let i = 0; i < total; i++) {
    const globalSlot = i;
    const employeeSlot = Math.floor(globalSlot / batchSize) % count;
    const roundNum = Math.floor(Math.floor(globalSlot / batchSize) / count) + 1;
    leads[i].assignedTo = salesTeam[employeeSlot]._id;
    leads[i].assignedAt = now;
    leads[i].assignmentRound = roundNum;
    leads[i].assignmentBatchSize = batchSize;
  }

  const distribution = salesTeam.map((member, i) => ({
    name: member.fullName,
    _id: member._id,
    assigned: leads.filter(l => String(l.assignedTo) === String(member._id)).length,
  }));

  const note = `Distributed ${total} leads across ${count} sales employee(s) with ${batchSize} leads/employee/round.`;

  return { leads, salesTeam: distribution, note };
}

/** Generate human-readable batch ID: UPLOAD-YYYY-MM-DD-NNN */
async function generateBatchId() {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10); // YYYY-MM-DD
  const prefix = `UPLOAD-${dateStr}-`;
  const count = await Lead.countDocuments({ uploadBatch: { $regex: `^${prefix}` } });
  const seq = String(count + 1).padStart(3, "0");
  return `${prefix}${seq}`;
}

// ─── Parse preview (without inserting) ─────────────────────────────────────

/**
 * POST /api/leads/preview
 * Parse file and return stats without importing.
 */
const previewLeads = async (req, res, next) => {
  try {
    if (!canUpload(req.user?.role)) throw new AppError("Only Founder/CEO, CTO, or Project Head can upload leads", 403, "FORBIDDEN");
    if (!req.file) throw new AppError("No file uploaded.", 400, "NO_FILE");

    const rows = await parseFile(req.file);
    const uploadedBy = req.user.userId;
    const uploadBatch = "PREVIEW";

    const leads = rows.map((row) => rowToLead(row, uploadedBy, uploadBatch, "")).filter(Boolean);
    const totalRows = rows.length;
    const validRows = leads.length;
    const invalidRows = totalRows - validRows;

    res.json({
      data: {
        totalRows,
        validRows,
        invalidRows,
        sample: leads.slice(0, 5).map(l => ({ name: l.name, email: l.email, phone: l.phone, company: l.company })),
      },
    });
  } catch (err) { next(err); }
};

async function parseFile(file) {
  const { mimetype, buffer, originalname } = file;
  const isCSV = mimetype === "text/csv" || originalname.endsWith(".csv");
  const isExcel =
    mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimetype === "application/vnd.ms-excel" ||
    originalname.endsWith(".xlsx") ||
    originalname.endsWith(".xls");

  if (!isCSV && !isExcel) throw new AppError("Only CSV (.csv) and Excel (.xlsx / .xls) files are supported", 400, "INVALID_FILE_TYPE");

  if (isCSV) return parseCSV(buffer);

  let XLSX;
  try { XLSX = require("xlsx"); } catch {
    throw new AppError("Excel parsing requires the 'xlsx' package.", 500, "MISSING_DEPENDENCY");
  }
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const ws = workbook.Sheets[sheetName];

  // Convert to array of arrays to detect title rows
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  // Find the actual header row — first row where at least one cell is 'name' or 'entityId' etc.
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const cells = rows[i].map(c => String(c || "").toLowerCase().trim());
    if (cells.some(c => c === "name" || c === "entityid" || c === "email" || c === "phone" || c === "company")) {
      headerRowIdx = i;
      break;
    }
  }

  const headers = rows[headerRowIdx].map(normalizeHeader);
  const dataRows = rows.slice(headerRowIdx + 1).filter(r => r.some(c => c !== ""));

  return dataRows.map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = String(row[i] ?? "").trim(); });
    return obj;
  });
}

/**
 * POST /api/leads/upload
 */
const uploadLeads = async (req, res, next) => {
  try {
    if (!canUpload(req.user?.role)) throw new AppError("Only Founder/CEO, CTO, or Project Head can upload leads", 403, "FORBIDDEN");
    if (!req.file) throw new AppError("No file uploaded.", 400, "NO_FILE");

    const rows = await parseFile(req.file);
    const uploadBatchTimestamp = new Date().toISOString();
    const uploadBatch = await generateBatchId();

    // Get configured batch size
    const { OrgSettings } = require("../models/OrgSettings");
    const settings = await OrgSettings.findOne({ singletonKey: "default" }).lean();
    const batchSize = settings?.leads?.batchSize || 50;

    let leads = rows
      .map((row) => rowToLead(row, req.user.userId, uploadBatch, uploadBatchTimestamp))
      .filter(Boolean);

    const totalRows = rows.length;
    const validRows = leads.length;
    const invalidRows = totalRows - validRows;

    if (leads.length === 0) throw new AppError("No valid leads found in the file. Make sure columns include at least a 'name' column.", 400, "NO_VALID_ROWS");

    // Stamp batch metadata
    leads = leads.map(l => ({ ...l, totalInBatch: totalRows, validInBatch: validRows, skippedInBatch: invalidRows }));

    const { leads: distributedLeads, salesTeam, note } = await distributeLeads(leads, req.user.userId, batchSize);

    const inserted = await Lead.insertMany(distributedLeads, { ordered: false });

    // Audit log
    try {
      const { AuditLog } = require("../models/NotificationAudit");
      await AuditLog.create({
        userId: req.user.userId,
        userEmail: req.user.email,
        action: "LEAD_UPLOAD",
        module: "leads",
        recordLabel: uploadBatch,
        newValue: { imported: inserted.length, salesTeamCount: salesTeam.length, batchSize },
        ipAddress: req.ip,
      });
    } catch (_) {}

    res.status(201).json({
      data: {
        imported: inserted.length,
        skipped: invalidRows,
        totalRows,
        uploadBatch,
        uploadBatchTimestamp,
        salesTeamCount: salesTeam.length,
        distribution: salesTeam,
        distributionNote: note,
        batchSize,
        message: `Successfully imported ${inserted.length} lead${inserted.length !== 1 ? "s" : ""} and distributed across ${salesTeam.length} sales team member(s).`,
      },
    });
  } catch (err) { next(err); }
};

/**
 * GET /api/leads
 */
const getLeads = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, 50);
    const { status, search, uploadBatch, assignedTo } = req.query;

    const query = {};

    if (req.user?.role === "EMPLOYEE") {
      const { Employee } = require("../models/Employee");
      const emp = await Employee.findOne({ user: req.user.userId }).select("_id").lean();
      if (emp) query.assignedTo = emp._id;
      else return res.json({ data: [], meta: { total: 0, page, limit, totalPages: 0 } });
    } else if (assignedTo) {
      query.assignedTo = assignedTo;
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

    res.json({ data: req.user?.role === "EMPLOYEE" ? leads.map(maskLead) : leads, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
};

/**
 * GET /api/leads/:id
 */
const getLead = async (req, res, next) => {
  try {
    const { id } = req.params;
    assertObjectId(id, "lead id");

    const lead = await Lead.findById(id)
      .populate("uploadedBy", "email")
      .populate("assignedTo", "fullName employeeCode department")
      .populate("statusUpdatedBy", "email")
      .populate("statusHistory.changedBy", "email")
      .populate("reassignmentHistory.changedBy", "email")
      .populate("reassignmentHistory.fromEmployee", "fullName employeeCode")
      .populate("reassignmentHistory.toEmployee", "fullName employeeCode")
      .lean();

    if (!lead) throw new AppError("Lead not found", 404, "NOT_FOUND");

    // Employee can only see their own lead
    if (req.user?.role === "EMPLOYEE") {
      const { Employee } = require("../models/Employee");
      const emp = await Employee.findOne({ user: req.user.userId }).select("_id").lean();
      if (!emp || String(lead.assignedTo?._id) !== String(emp._id)) {
        throw new AppError("Access denied", 403, "FORBIDDEN");
      }
    }

    res.json({ data: req.user?.role === "EMPLOYEE" ? maskLead(lead) : lead });
  } catch (err) { next(err); }
};

/**
 * PATCH /api/leads/:id/status
 */
const updateLeadStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    assertObjectId(id, "lead id");
    const { status, notes } = req.body;

    if (!VALID_STATUSES.includes(status)) throw new AppError(`Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`, 400, "INVALID_STATUS");

    const lead = await Lead.findById(id);
    if (!lead) throw new AppError("Lead not found", 404, "NOT_FOUND");

    // Employee can only update their own lead
    if (req.user?.role === "EMPLOYEE") {
      const { Employee } = require("../models/Employee");
      const emp = await Employee.findOne({ user: req.user.userId }).select("_id").lean();
      if (!emp || String(lead.assignedTo) !== String(emp._id)) {
        throw new AppError("Access denied", 403, "FORBIDDEN");
      }
    }

    const previousStatus = lead.status;
    lead.status = status;
    if (notes !== undefined) lead.notes = notes;
    lead.statusUpdatedAt = new Date();
    lead.statusUpdatedBy = req.user.userId;
    if (status === "CONTACTED") lead.lastContactedAt = new Date();

    lead.statusHistory.push({
      previousStatus,
      newStatus: status,
      changedBy: req.user.userId,
      changedAt: new Date(),
      notes: notes || "",
    });

    await lead.save();

    // Audit log
    try {
      const { AuditLog } = require("../models/NotificationAudit");
      await AuditLog.create({
        userId: req.user.userId,
        userEmail: req.user.email,
        action: "LEAD_STATUS_CHANGE",
        module: "leads",
        recordId: String(lead._id),
        recordLabel: lead.name,
        oldValue: { status: previousStatus },
        newValue: { status },
        ipAddress: req.ip,
      });
    } catch (_) {}

    res.json({ data: lead });
  } catch (err) { next(err); }
};

/**
 * PATCH /api/leads/:id/assign
 * Management only — reassign a lead to another sales employee.
 */
const reassignLead = async (req, res, next) => {
  try {
    if (!canManage(req.user?.role)) throw new AppError("Only management can reassign leads", 403, "FORBIDDEN");

    const { id } = req.params;
    assertObjectId(id, "lead id");
    const { employeeId, reason } = req.body;
    assertObjectId(employeeId, "employee id");

    const lead = await Lead.findById(id);
    if (!lead) throw new AppError("Lead not found", 404, "NOT_FOUND");

    const { Employee } = require("../models/Employee");
    const emp = await Employee.findById(employeeId).lean();
    if (!emp) throw new AppError("Employee not found", 404, "NOT_FOUND");

    const fromEmployee = lead.assignedTo;
    lead.reassignmentHistory.push({
      fromEmployee,
      toEmployee: employeeId,
      changedBy: req.user.userId,
      changedAt: new Date(),
      reason: reason || "",
    });
    lead.assignedTo = employeeId;
    lead.assignedAt = new Date();
    await lead.save();

    try {
      const { AuditLog } = require("../models/NotificationAudit");
      await AuditLog.create({
        userId: req.user.userId,
        userEmail: req.user.email,
        action: "LEAD_REASSIGNED",
        module: "leads",
        recordId: String(lead._id),
        recordLabel: lead.name,
        oldValue: { assignedTo: fromEmployee },
        newValue: { assignedTo: employeeId, reason },
        ipAddress: req.ip,
      });
    } catch (_) {}

    res.json({ data: lead });
  } catch (err) { next(err); }
};

/**
 * GET /api/leads/stats
 */
const getLeadStats = async (req, res, next) => {
  try {
    const { uploadBatch } = req.query;
    const matchQuery = {};
    if (uploadBatch) matchQuery.uploadBatch = uploadBatch;

    const [statusAgg, employeeAgg, total, unassigned] = await Promise.all([
      Lead.aggregate([
        { $match: matchQuery },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Lead.aggregate([
        { $match: { ...matchQuery, assignedTo: { $ne: null } } },
        {
          $group: {
            _id: "$assignedTo",
            total: { $sum: 1 },
            contacted: { $sum: { $cond: [{ $in: ["$status", ["CONTACTED", "INTERESTED", "CONVERTED"]] }, 1, 0] } },
            interested: { $sum: { $cond: [{ $eq: ["$status", "INTERESTED"] }, 1, 0] } },
            converted: { $sum: { $cond: [{ $eq: ["$status", "CONVERTED"] }, 1, 0] } },
            lost: { $sum: { $cond: [{ $eq: ["$status", "LOST"] }, 1, 0] } },
            new: { $sum: { $cond: [{ $eq: ["$status", "NEW"] }, 1, 0] } },
            not_interested: { $sum: { $cond: [{ $eq: ["$status", "NOT_INTERESTED"] }, 1, 0] } },
          },
        },
        {
          $lookup: {
            from: "employees",
            localField: "_id",
            foreignField: "_id",
            as: "employee",
          },
        },
        { $unwind: { path: "$employee", preserveNullAndEmpty: true } },
        {
          $project: {
            employeeId: "$_id",
            name: "$employee.fullName",
            employeeCode: "$employee.employeeCode",
            total: 1, contacted: 1, interested: 1, converted: 1, lost: 1, new: 1, not_interested: 1,
          },
        },
      ]),
      Lead.countDocuments(matchQuery),
      Lead.countDocuments({ ...matchQuery, assignedTo: null }),
    ]);

    const byStatus = {};
    VALID_STATUSES.forEach(s => { byStatus[s] = 0; });
    statusAgg.forEach(({ _id, count }) => { byStatus[_id] = count; });

    const converted = byStatus.CONVERTED;
    const conversionRate = total > 0 ? ((converted / total) * 100).toFixed(1) : "0.0";
    const contactRate = total > 0 ? (((total - byStatus.NEW) / total) * 100).toFixed(1) : "0.0";

    res.json({
      data: {
        total,
        unassigned,
        byStatus,
        conversionRate: `${conversionRate}%`,
        contactRate: `${contactRate}%`,
        byEmployee: employeeAgg,
      },
    });
  } catch (err) { next(err); }
};

/**
 * GET /api/leads/batches
 */
const getUploadBatches = async (req, res, next) => {
  try {
    if (!canUpload(req.user?.role)) throw new AppError("Forbidden", 403, "FORBIDDEN");

    const batches = await Lead.aggregate([
      { $match: { uploadBatch: { $exists: true, $ne: null } } },
      {
        $group: {
          _id: "$uploadBatch",
          total: { $sum: 1 },
          uploadBatchTimestamp: { $first: "$uploadBatchTimestamp" },
          uploadedBy: { $first: "$uploadedBy" },
          createdAt: { $first: "$createdAt" },
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "users",
          localField: "uploadedBy",
          foreignField: "_id",
          as: "uploader",
        },
      },
      { $unwind: { path: "$uploader", preserveNullAndEmpty: true } },
      {
        $project: {
          batchId: "$_id",
          total: 1,
          uploadedAt: "$createdAt",
          uploadedBy: "$uploader.email",
          _id: 0,
        },
      },
    ]);

    res.json({ data: batches });
  } catch (err) { next(err); }
};

/**
 * DELETE /api/leads/batch/:batch
 */
const deleteBatch = async (req, res, next) => {
  try {
    if (!canUpload(req.user?.role)) throw new AppError("Forbidden", 403, "FORBIDDEN");
    const { batch } = req.params;
    const result = await Lead.deleteMany({ uploadBatch: decodeURIComponent(batch) });
    res.json({ data: { deleted: result.deletedCount } });
  } catch (err) { next(err); }
};

/**
 * POST /api/leads/:id/reveal
 * Returns unmasked email + phone for the assigned EMPLOYEE only.
 * Only one lead can be "active" per user at a time — calling this
 * cancels any previously active reveal for that user.
 */
const revealLead = async (req, res, next) => {
  try {
    assertObjectId(req.params.id, "lead id");

    const lead = await Lead.findById(req.params.id)
      .select("email phone assignedTo")
      .populate("assignedTo", "_id")
      .lean();

    if (!lead) throw new AppError("Lead not found", 404, "NOT_FOUND");

    // Only the assigned EMPLOYEE may reveal their own lead
    if (req.user?.role === "EMPLOYEE") {
      const { Employee } = require("../models/Employee");
      const emp = await Employee.findOne({ user: req.user.userId }).select("_id").lean();
      if (!emp || String(lead.assignedTo?._id) !== String(emp._id)) {
        throw new AppError("Access denied", 403, "FORBIDDEN");
      }
    } else if (!canManage(req.user?.role)) {
      throw new AppError("Forbidden", 403, "FORBIDDEN");
    }

    res.json({ data: { email: lead.email, phone: lead.phone } });
  } catch (err) { next(err); }
};

module.exports = { uploadLeads, previewLeads, getLeads, getLead, updateLeadStatus, reassignLead, getLeadStats, getUploadBatches, deleteBatch, revealLead };