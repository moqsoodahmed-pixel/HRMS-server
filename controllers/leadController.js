"use strict";
// ─── DEPLOYMENT VERSION MARKER ───────────────────────────────────────────
// Prints once, when this file is first require()'d (i.e. on server start).
// If your server logs DO NOT show this line right after a restart, the
// running process is loading a leadController.js from somewhere other
// than the file you just replaced — check for a second copy of the repo,
// a dist/build folder, a Docker image that needs rebuilding (not just
// restarting), or multiple server instances behind a load balancer where
// only one got the new file. grep for "LEAD_CONTROLLER_VERSION" in this
// file to confirm it's the same one your server is actually running.
const LEAD_CONTROLLER_VERSION = "entity-dedup-v2-2026-09-22";
console.log(`[leadController] loaded ${LEAD_CONTROLLER_VERSION}`);

const { Lead } = require("../models/Lead");
const { AppError } = require("../middleware/errorHandler");
const { isElevated } = require("../utils/roles");
const { parsePagination, assertObjectId, startOfDay, endOfDay } = require("../utils/helpers");

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

/**
 * Digits-only, last-10 form of a phone number — strips spaces, dashes,
 * a leading country code (+91, 0091, a leading 0, ...) so "+91 98765
 * 43210", "0-9876543210" and "9876543210" all normalize to the same key
 * for duplicate detection. Numbers shorter than 10 digits (clearly not a
 * real mobile number) are kept as-is rather than mangled further.
 */
function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Lowercased, trimmed email — the same contact typed in different casing
 *  ("Ramesh@X.com" vs "ramesh@x.com") should still count as a duplicate. */
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/** Trims and collapses internal whitespace so "Karnataka", " Karnataka ",
 *  and "Karnataka  " all compare and display identically. */
function normalizeState(state) {
  return String(state || "").trim().replace(/\s+/g, " ");
}

/**
 * Best-effort human name derived from an email's local part, used only when
 * a raw file has no name/director-name column at all but does have a
 * contact email — e.g. "ramesh.kumar23@gmail.com" → "Ramesh Kumar". Strips
 * dots/underscores/hyphens/digits (common separators and dedup suffixes)
 * and title-cases what's left. Returns "" (never a guess) when nothing
 * usable remains, so an unrecognizable address still just falls through.
 */
function nameFromEmail(email) {
  const local = String(email || "").split("@")[0] || "";
  const cleaned = local.replace(/[._+\-0-9]+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Quote-aware CSV tokenizer. A naive line.split(delimiter) breaks as soon as
 * any field contains a quoted delimiter or a quoted newline (e.g. an MCA
 * "nicLabel" like "COMPUTER PROGRAMMING, CONSULTANCY AND RELATED ACTIVITIES"
 * or a multi-line "registeredAddress") — every column after that field then
 * shifts, silently scrambling name/company/email/phone/state. This walks the
 * raw text character-by-character so quoted delimiters and newlines never
 * split a row, and a doubled quote ("") inside a quoted field is unescaped
 * to a single quote per the CSV spec.
 */
function tokenizeCSV(text, delimiter) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // ignore — paired \n (if present) ends the row below
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseCSV(buffer) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const delimiter = firstLine.includes(";") ? ";" : ",";

  const allRows = tokenizeCSV(text, delimiter).filter((r) => r.some((v) => v.trim() !== ""));
  if (allRows.length < 2) throw new AppError("CSV file must have a header row and at least one data row", 400, "INVALID_FILE");

  const headers = allRows[0].map(normalizeHeader);

  return allRows.slice(1).map((values) => {
    const row = {};
    headers.forEach((h, i) => { row[h] = (values[i] || "").trim(); });
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

  // Email — prefer the director/contact person's own email when the file
  // splits company email vs. director email (MCA/LLP format). Falls back
  // to the generic "email" column otherwise — unchanged for files that
  // only ever had one email column. Computed before `name` below because
  // the name fallback needs it.
  const email = get("director_email", "directoremail") || get("email", "email_address", "mail");

  // Name — prefer an explicit director/contact-person name when the file
  // provides one (e.g. MCA/LLP exports have a separate "directorName"
  // column while "name" holds the company/entity name). Falls back to the
  // generic name columns for files that only ever had a person's name
  // under "name" (e.g. the plain Combined Leads format) — unchanged for
  // those files. As a last resort, a raw export with no name column at all
  // (only a director/contact email) still gets a usable, human-readable
  // name derived from that email's local part rather than being dropped.
  const directorName = get("director_name", "directorname");
  const rawNameColumn = get("name", "full_name", "fullname", "contact_name", "customer_name", "lead_name", "entity_name", "entityname");
  const name = directorName || rawNameColumn || nameFromEmail(email);
  if (!name) return null;

  const statusRaw = get("status", "lead_status", "stage").toUpperCase();
  const status = VALID_STATUSES.includes(statusRaw) ? statusRaw : "NEW";

  // Clean phone — remove backticks, spaces, leading zeros issues
  const rawPhone = get("phone", "mobile", "phone_number", "mobile_number", "contact", "contact_number",
    "director_mobile", "directormobile", "contact_mobile");
  const phone = rawPhone.replace(/`/g, "").replace(/^\+?0+(?=\d{10})/, "").trim();

  // Notes — when new leads are given/imported, note should be empty because user will update it manually
  const notes = "";

  // State — captured as-is from the source file (e.g. "Karnataka") so it can
  // be used to restrict which leads get imported/assigned, and later to
  // filter exports. Does not affect distribution/assignment logic itself.
  const state = normalizeState(get("state", "lead_state", "province", "state_jurisdiction"));

  // Company — when we pulled the director's name into `name` above, the
  // raw "name" column (the entity/company name) belongs here instead of
  // being discarded. Falls back to the generic company columns, then to
  // `name` itself — unchanged for files with no separate director column.
  const company = get("company", "company_name", "organization", "organisation", "firm")
    || (directorName ? rawNameColumn : "")
    || name;

  // Source entity/registration id — an MCA/LLP export repeats the SAME row
  // (same entityId/CIN/LLPIN, same company) once per director, so this is
  // what actually identifies "one company" rather than "one contact
  // person". Used only for in-file dedup below (see dedupeWithinFile) —
  // never persisted on the Lead document, it just travels alongside the
  // lead object until dedup runs.
  const sourceEntityId = get("entity_id", "entityid", "cin", "llpin", "registration_number", "registrationnumber");

  return {
    name,
    phone: phone || "",
    email,
    normalizedPhone: normalizePhone(phone),
    normalizedEmail: normalizeEmail(email),
    company,
    state,
    notes,
    status,
    uploadedBy,
    uploadBatch,
    uploadBatchTimestamp,
    assignedTo: null,
    statusHistory: [{ newStatus: status, changedBy: uploadedBy, changedAt: new Date() }],
    sourceEntityId,
  };
}

/**
 * Drops duplicate rows within a single freshly parsed file, keeping the
 * first occurrence of each company/contact. A raw MCA/LLP export lists
 * every director of a company as a SEPARATE row — the same company
 * (same entityId/CIN/LLPIN) repeats once per director, each with their own
 * phone/email, so a plain phone/email check alone would let all of those
 * director rows through as if they were different leads. To collapse those
 * back down to one lead per company, a row is treated as a duplicate of an
 * earlier one when ANY of the following already appeared:
 *   1. the same source entity id (entityId/CIN/LLPIN) — the strongest
 *      signal, present on MCA/LLP-style exports;
 *   2. the same company name + state, for files with no entity id at all
 *      but a repeated company name (e.g. a hand-maintained sheet);
 *   3. the same normalized phone number;
 *   4. the same normalized email.
 * Any one match is enough — this keeps the very first contact row seen
 * for that company (or that phone/email) and discards the rest.
 */
function dedupeWithinFile(leads) {
  const seenEntityIds = new Set();
  const seenCompanyState = new Set();
  const seenPhones = new Set();
  const seenEmails = new Set();
  const unique = [];
  let duplicates = 0;
  for (const lead of leads) {
    const entityKey = lead.sourceEntityId ? lead.sourceEntityId.trim().toLowerCase() : "";
    const companyKey = lead.company
      ? `${lead.company.trim().toLowerCase()}|${normalizeState(lead.state).toLowerCase()}`
      : "";

    const isDup =
      (entityKey && seenEntityIds.has(entityKey)) ||
      // Only fall back to the company+state key when there's no entity id
      // to go on — a file that DOES have entity ids shouldn't be tripped
      // up by two genuinely different companies sharing a display name.
      (!entityKey && companyKey && seenCompanyState.has(companyKey)) ||
      (lead.normalizedPhone && seenPhones.has(lead.normalizedPhone)) ||
      (lead.normalizedEmail && seenEmails.has(lead.normalizedEmail));

    if (isDup) { duplicates++; continue; }

    if (entityKey) seenEntityIds.add(entityKey);
    if (companyKey) seenCompanyState.add(companyKey);
    if (lead.normalizedPhone) seenPhones.add(lead.normalizedPhone);
    if (lead.normalizedEmail) seenEmails.add(lead.normalizedEmail);
    unique.push(lead);
  }
  return { unique, duplicates };
}

/**
 * Excludes rows that match a lead already sitting in the database (from an
 * earlier upload) — same normalized phone OR same normalized email — so
 * re-uploading the same raw file, or a different file that overlaps with a
 * previous one, never creates a second copy of the same contact.
 */
async function excludeExistingLeads(leads) {
  const phones = [...new Set(leads.map((l) => l.normalizedPhone).filter(Boolean))];
  const emails = [...new Set(leads.map((l) => l.normalizedEmail).filter(Boolean))];
  if (phones.length === 0 && emails.length === 0) return { unique: leads, duplicates: 0 };

  const orClauses = [];
  if (phones.length) orClauses.push({ normalizedPhone: { $in: phones } });
  if (emails.length) orClauses.push({ normalizedEmail: { $in: emails } });

  const existing = await Lead.find({ $or: orClauses }).select("normalizedPhone normalizedEmail").lean();
  const existingPhones = new Set(existing.map((l) => l.normalizedPhone).filter(Boolean));
  const existingEmails = new Set(existing.map((l) => l.normalizedEmail).filter(Boolean));

  let duplicates = 0;
  const unique = leads.filter((l) => {
    const isDup =
      (l.normalizedPhone && existingPhones.has(l.normalizedPhone)) ||
      (l.normalizedEmail && existingEmails.has(l.normalizedEmail));
    if (isDup) duplicates++;
    return !isDup;
  });
  return { unique, duplicates };
}

/**
 * Groups leads by their (normalized) state and counts each group — this is
 * what lets the admin pick a state from what's actually in the file, rather
 * than the upload being locked to one hardcoded state. Rows with no state
 * value at all are grouped under "Unspecified" rather than dropped, so
 * nothing silently disappears from the picker.
 */
function groupByState(leads) {
  const groups = new Map();
  for (const lead of leads) {
    const display = lead.state || "Unspecified";
    const key = display.toLowerCase();
    if (!groups.has(key)) groups.set(key, { state: display, count: 0 });
    groups.get(key).count += 1;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** Case-insensitive, whitespace-normalized match of a lead's state against the admin's chosen state. */
function isMatchingState(leadState, selectedState) {
  return normalizeState(leadState).toLowerCase() === normalizeState(selectedState).toLowerCase();
}

/** 
 * Round-robin batch distribution: 50 leads per employee per round (configurable).
 * Continues until all leads assigned.
 */
async function distributeLeads(leads, uploadedBy, batchSize = 50, employeeIds = null) {
  const { Employee } = require("../models/Employee");

  // Matches AuthContext.jsx canAccess()'s own "who can see Sales Leads"
  // check on the client (department containing "sales" or "business
  // development") — Business Development is a real, selectable department
  // now (see constants.js DEPARTMENTS) and its employees need to actually
  // receive round-robin leads, not just be able to view an empty list.
  //
  // When `employeeIds` is given (CEO/Admin manually picked who this batch
  // should go to — solo, duo, or any hand-picked subset — instead of
  // letting it auto-split across the whole team), the round-robin is
  // scoped to ONLY those employees. They still must be active Sales/BD
  // employees — this can't be used to hand leads to someone outside the
  // sales team.
  const baseQuery = {
    department: { $regex: /^(sales|business development)$/i },
    status: { $in: ["ACTIVE", "active", "Active"] },
  };
  if (Array.isArray(employeeIds) && employeeIds.length > 0) {
    baseQuery._id = { $in: employeeIds };
  }
  const salesTeam = await Employee.find(baseQuery).select("_id fullName").lean();

  if (Array.isArray(employeeIds) && employeeIds.length > 0 && salesTeam.length === 0) {
    throw new AppError(
      "None of the chosen employees are active Sales/Business Development employees — pick from the list shown after Preview.",
      400,
      "INVALID_ASSIGNEES"
    );
  }

  if (salesTeam.length === 0) {
    return { leads, salesTeam: [], note: "No active Sales/Business Development department employees found — leads imported unassigned." };
  }

  const count = salesTeam.length;
  const total = leads.length;
  const now = new Date();

  // Simple one-by-one round-robin: lead 0 → member 0, lead 1 → member 1, lead 2 → member 0, etc.
  // This guarantees equal (or near-equal) distribution regardless of batch size.
  // e.g. 41 leads, 2 members → 21 to member 0, 20 to member 1
  for (let i = 0; i < total; i++) {
    const memberIdx = i % count;
    leads[i].assignedTo = salesTeam[memberIdx]._id;
    leads[i].assignedAt = now;
    leads[i].assignmentRound = Math.floor(i / count) + 1;
    leads[i].assignmentBatchSize = batchSize;
  }

  const distribution = salesTeam.map((member) => ({
    name: member.fullName,
    _id: member._id,
    assigned: leads.filter(l => String(l.assignedTo) === String(member._id)).length,
  }));

  const perPerson = Math.floor(total / count);
  const extra = total % count;
  const note = `Distributed ${total} leads across ${count} sales member(s) — ${perPerson} each${extra > 0 ? `, +1 for ${extra} member(s)` : ""}.`;

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
 * Parses the file, cleans it (drops duplicate rows and anything that
 * already exists in the database), and returns stats plus the list of
 * states actually present — without importing anything yet. The admin
 * picks one of the returned `states` and re-submits that choice to
 * POST /api/leads/upload to actually import it (see uploadLeads below).
 */
const previewLeads = async (req, res, next) => {
  try {
    if (!canUpload(req.user?.role)) throw new AppError("Only Founder/CEO, CTO, or Project Head can upload leads", 403, "FORBIDDEN");
    if (!req.file) throw new AppError("No file uploaded.", 400, "NO_FILE");

    const rows = await parseFile(req.file);
    const uploadedBy = req.user.userId;
    const uploadBatch = "PREVIEW";

    const parsedLeads = rows.map((row) => rowToLead(row, uploadedBy, uploadBatch, "")).filter(Boolean);
    const totalRows = rows.length;
    const parsedRows = parsedLeads.length;
    const invalidRows = totalRows - parsedRows;

    // Clean the raw file the same way the actual import will: collapse
    // duplicate rows (same phone or email), then drop anything that's
    // already in the database from an earlier upload — so the counts and
    // per-state breakdown shown here match exactly what will be imported.
    const { unique: dedupedLeads, duplicates: duplicateRows } = dedupeWithinFile(parsedLeads);
    const { unique: freshLeads, duplicates: alreadyImportedRows } = await excludeExistingLeads(dedupedLeads);

    const validRows = freshLeads.length;
    const states = groupByState(freshLeads);

    res.json({
      data: {
        totalRows,
        validRows,
        invalidRows,
        duplicateRows,
        alreadyImportedRows,
        // [{ state, count }, ...], most common first — the client renders
        // these as the state picker; nothing is imported until the admin
        // chooses one and calls upload with it.
        states,
        sample: freshLeads.slice(0, 5).map(l => ({ name: l.name, email: l.email, phone: l.phone, company: l.company, state: l.state })),
        // Proof-of-deployment marker — open your browser's Network tab after
        // clicking Preview and check this field in the response. If it's
        // missing entirely, or doesn't say "entity-dedup-v2-2026-09-22", the
        // server answering this request is NOT running the file you just
        // replaced (old build cached, wrong server, container not rebuilt,
        // a second/stale instance behind a load balancer, etc).
        controllerVersion: LEAD_CONTROLLER_VERSION,
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
 * Requires a `state` form field (chosen from the list POST /api/leads/preview
 * returned for this same file) — only rows matching that state are ever
 * imported/distributed. Also re-runs the same duplicate removal preview
 * did, since a new file could have been chosen between preview and upload.
 */
const uploadLeads = async (req, res, next) => {
  try {
    if (!canUpload(req.user?.role)) throw new AppError("Only Founder/CEO, CTO, or Project Head can upload leads", 403, "FORBIDDEN");
    if (!req.file) throw new AppError("No file uploaded.", 400, "NO_FILE");

    const selectedState = normalizeState(req.body?.state);
    if (!selectedState) {
      throw new AppError(
        "Please choose a state to import before uploading — preview the file first, then pick one of the states found in it.",
        400,
        "STATE_REQUIRED"
      );
    }

    // Optional manual override: CEO/Admin picked exactly who this batch
    // should go to (solo/duo/multi), instead of letting it auto-split
    // across the whole active Sales/Business Development team. Sent as a
    // JSON-stringified array in the multipart body (FormData can't carry
    // a real array field), e.g. employeeIds='["64f...","64a..."]'.
    let employeeIds = null;
    if (req.body?.employeeIds) {
      try {
        const parsed = JSON.parse(req.body.employeeIds);
        if (Array.isArray(parsed) && parsed.length > 0) {
          parsed.forEach((id) => assertObjectId(id, "employee id"));
          employeeIds = parsed;
        }
      } catch (_) {
        throw new AppError("employeeIds must be a JSON array of employee ids", 400, "VALIDATION_ERROR");
      }
    }

    const rows = await parseFile(req.file);
    const uploadBatchTimestamp = new Date().toISOString();
    const uploadBatch = await generateBatchId();

    // Get configured batch size
    const { OrgSettings } = require("../models/OrgSettings");
    const settings = await OrgSettings.findOne({ singletonKey: "default" }).lean();
    const batchSize = settings?.leads?.batchSize || 50;

    const parsedLeads = rows
      .map((row) => rowToLead(row, req.user.userId, uploadBatch, uploadBatchTimestamp))
      .filter(Boolean);

    const totalRows = rows.length;
    const parsedRows = parsedLeads.length;
    const invalidRows = totalRows - parsedRows;

    // ── Duplicate removal ────────────────────────────────────────────────
    // A raw export commonly repeats the same director/contact across
    // several rows — collapse those to one row per phone/email before
    // anything is inserted or handed to a sales rep, and also drop
    // anything that matches a lead already in the database from an
    // earlier upload, so re-uploading the same (or an overlapping) file
    // never creates a second copy of the same contact.
    const { unique: dedupedLeads, duplicates: duplicateRows } = dedupeWithinFile(parsedLeads);
    const { unique: freshLeads, duplicates: alreadyImportedRows } = await excludeExistingLeads(dedupedLeads);

    // ── State selection ──────────────────────────────────────────────────
    // The file may contain leads from every state (a raw MCA/GST export).
    // Only rows matching the state the admin picked are ever imported or
    // handed to distributeLeads, so no other state's data reaches an
    // assigned sales employee. Enforced here — server-side, on every
    // upload — not left to whoever prepares the file, and it cannot be
    // bypassed via the request other than by picking a different state.
    const otherStateLeads = freshLeads.filter((l) => !isMatchingState(l.state, selectedState));
    let leads = freshLeads.filter((l) => isMatchingState(l.state, selectedState));
    const otherStateRows = otherStateLeads.length;

    if (leads.length === 0) {
      throw new AppError(
        `No "${selectedState}" leads found in the file after removing duplicates. ${otherStateRows} row(s) from other states were excluded.`,
        400,
        "NO_VALID_ROWS"
      );
    }

    // Stamp batch metadata (reflects the full file, so the batch record
    // still shows how many rows were in the source file vs. how many of
    // those were actually clean + the chosen state and got imported).
    leads = leads.map(l => ({
      ...l,
      totalInBatch: totalRows,
      validInBatch: parsedRows,
      skippedInBatch: invalidRows + duplicateRows + alreadyImportedRows + otherStateRows,
    }));

    const { leads: distributedLeads, salesTeam, note } = await distributeLeads(leads, req.user.userId, batchSize, employeeIds);

    // sourceEntityId only exists to power the company-level dedup above —
    // it isn't a Lead field, so drop it explicitly rather than relying on
    // Mongoose silently stripping unknown paths.
    const insertReady = distributedLeads.map(({ sourceEntityId, ...lead }) => lead);
    const inserted = await Lead.insertMany(insertReady, { ordered: false });

    // Audit log
    try {
      const { AuditLog } = require("../models/NotificationAudit");
      await AuditLog.create({
        userId: req.user.userId,
        userEmail: req.user.email,
        action: "LEAD_UPLOAD",
        module: "leads",
        recordLabel: uploadBatch,
        newValue: {
          imported: inserted.length,
          state: selectedState,
          duplicatesInFile: duplicateRows,
          alreadyImported: alreadyImportedRows,
          otherStateExcluded: otherStateRows,
          salesTeamCount: salesTeam.length,
          batchSize,
          manuallyAssigned: Boolean(employeeIds),
        },
        ipAddress: req.ip,
      });
    } catch (_) { }

    res.status(201).json({
      data: {
        imported: inserted.length,
        skipped: invalidRows,
        duplicatesRemoved: duplicateRows,
        alreadyImportedExcluded: alreadyImportedRows,
        otherStateExcluded: otherStateRows,
        selectedState,
        totalRows,
        uploadBatch,
        uploadBatchTimestamp,
        salesTeamCount: salesTeam.length,
        distribution: salesTeam,
        distributionNote: note,
        batchSize,
        manuallyAssigned: Boolean(employeeIds),
        message: `Successfully imported ${inserted.length} "${selectedState}" lead${inserted.length !== 1 ? "s" : ""} and `
          + (employeeIds
            ? `assigned to ${salesTeam.length} chosen sales team member(s).`
            : `distributed across ${salesTeam.length} sales team member(s).`)
          + (duplicateRows > 0 ? ` ${duplicateRows} duplicate row(s) in the file were skipped.` : "")
          + (alreadyImportedRows > 0 ? ` ${alreadyImportedRows} row(s) matched leads already in the system and were skipped.` : "")
          + (otherStateRows > 0 ? ` ${otherStateRows} row(s) from other states were excluded.` : ""),
        controllerVersion: LEAD_CONTROLLER_VERSION,
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
    const { status, search, uploadBatch, assignedTo, leadDate } = req.query;

    const query = {};

    if (req.user?.role === "EMPLOYEE") {
      const { Employee } = require("../models/Employee");
      const emp = await Employee.findOne({ user: req.user.userId }).select("_id").lean();
      if (emp) query.assignedTo = emp._id;
      else return res.json({ data: [], meta: { total: 0, page, limit, totalPages: 0 } });
    } else if (req.user?.role === "MANAGER") {
      // Sales Team Lead (a MANAGER, per the chosen design): scoped to the
      // leads assigned to their own team — the reps whose Reports-To/Manager
      // is this person (Employee.manager). Previously a MANAGER saw EVERY
      // company lead, which is both wrong for a team lead and not "what the
      // sales team sees". A manager with no reports (or a non-sales manager)
      // simply sees an empty list. An explicit ?assignedTo filter is honoured
      // only when it points at one of their own team members.
      const { Employee } = require("../models/Employee");
      const self = await Employee.findOne({ user: req.user.userId }).select("_id").lean();
      const reports = self
        ? await Employee.find({ manager: self._id, isArchived: false }).select("_id").lean()
        : [];
      const teamIds = reports.map((r) => r._id);
      if (assignedTo && teamIds.some((t) => String(t) === String(assignedTo))) {
        query.assignedTo = assignedTo;
      } else {
        query.assignedTo = { $in: teamIds };
      }
    } else if (assignedTo) {
      query.assignedTo = assignedTo;
    }

    if (leadDate === "TODAY") {
      const now = new Date();
      query.assignedAt = { $gte: startOfDay(now), $lte: endOfDay(now) };
    } else if (leadDate === "PREVIOUS") {
      const now = new Date();
      query.assignedAt = { $lt: startOfDay(now) };
    } else if (leadDate && leadDate !== "ALL") {
      // Support specific date string e.g. YYYY-MM-DD
      const d = new Date(leadDate);
      if (!isNaN(d.getTime())) {
        query.assignedAt = { $gte: startOfDay(d), $lte: endOfDay(d) };
      }
    } else if (req.query.date) {
      const d = new Date(req.query.date);
      if (!isNaN(d.getTime())) {
        query.assignedAt = { $gte: startOfDay(d), $lte: endOfDay(d) };
      }
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
    const { status, notes, callStatus, serviceInterest, callNotes } = req.body;

    const VALID_CALL_STATUSES = ["", "Busy", "Connected", "Switched Off", "not answered", "picked but disconnected", "out of service", "call later"];
    const VALID_SERVICE_INTERESTS = ["", "Startup India", "GST", "MSME", "Trademark", "Labour Certificate", "Website Development", "Others"];

    if (!VALID_STATUSES.includes(status)) throw new AppError(`Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`, 400, "INVALID_STATUS");
    if (callStatus !== undefined && !VALID_CALL_STATUSES.includes(callStatus)) throw new AppError("Invalid call status", 400, "INVALID_CALL_STATUS");
    if (serviceInterest !== undefined && !VALID_SERVICE_INTERESTS.includes(serviceInterest)) throw new AppError("Invalid service interest", 400, "INVALID_SERVICE_INTEREST");

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
    if (callStatus !== undefined) lead.callStatus = callStatus;
    if (serviceInterest !== undefined) lead.serviceInterest = serviceInterest;
    if (callNotes !== undefined) lead.callNotes = callNotes;
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
    } catch (_) { }

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
    } catch (_) { }

    res.json({ data: lead });
  } catch (err) { next(err); }
};

/**
 * POST /api/leads/bulk-assign
 * Management only. Lets CEO/Admin manually HAND-PICK which sales employee
 * a specific set of leads goes to, instead of the automatic round-robin
 * split that uploadLeads()/distributeLeads() and rebalanceLeads() do. This
 * is the "I want to choose, not auto-split" path: pass the exact lead IDs
 * you want moved (selected in the UI, or every lead in a given upload
 * batch/filter) plus the one employee they should all go to.
 *
 * Body: { leadIds: string[], employeeId: string, reason?: string }
 * - leadIds: 1-500 Lead _ids in one call (capped to keep the bulkWrite and
 *   audit log request-sized; call again for more).
 * - employeeId: must be an ACTIVE Sales or Business Development employee —
 *   same eligibility rule as the auto-split, so a manual assignment can't
 *   quietly hand leads to someone outside the sales team.
 */
const bulkAssignLeads = async (req, res, next) => {
  try {
    if (!canManage(req.user?.role)) throw new AppError("Only management can assign leads", 403, "FORBIDDEN");

    const { leadIds, employeeId, reason } = req.body;
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      throw new AppError("leadIds must be a non-empty array", 400, "VALIDATION_ERROR");
    }
    if (leadIds.length > 500) {
      throw new AppError("Cannot assign more than 500 leads in a single request", 400, "VALIDATION_ERROR");
    }
    leadIds.forEach((id) => assertObjectId(id, "lead id"));
    assertObjectId(employeeId, "employee id");

    const { Employee } = require("../models/Employee");
    const emp = await Employee.findOne({
      _id: employeeId,
      department: { $regex: /^(sales|business development)$/i },
      status: { $in: ["ACTIVE", "active", "Active"] },
    }).select("_id fullName employeeCode").lean();
    if (!emp) {
      throw new AppError("Employee not found, or is not an active Sales/Business Development employee", 404, "NOT_FOUND");
    }

    const leads = await Lead.find({ _id: { $in: leadIds } }).select("_id assignedTo").lean();
    if (leads.length === 0) throw new AppError("No matching leads found", 404, "NOT_FOUND");

    const now = new Date();
    const changedByUserId = req.user.userId;

    const bulkOps = leads.map((lead) => ({
      updateOne: {
        filter: { _id: lead._id },
        update: {
          $set: { assignedTo: emp._id, assignedAt: now },
          $push: {
            reassignmentHistory: {
              fromEmployee: lead.assignedTo || null,
              toEmployee: emp._id,
              changedBy: changedByUserId,
              changedAt: now,
              reason: reason || "Manual bulk assignment",
            },
          },
        },
      },
    }));
    await Lead.bulkWrite(bulkOps);

    try {
      const { AuditLog } = require("../models/NotificationAudit");
      await AuditLog.create({
        userId: req.user.userId,
        userEmail: req.user.email,
        action: "LEADS_BULK_ASSIGNED",
        module: "leads",
        newValue: { leadCount: leads.length, assignedTo: emp._id, assignedToName: emp.fullName, reason },
        ipAddress: req.ip,
      });
    } catch (_) { }

    res.json({
      data: {
        assignedCount: leads.length,
        assignedTo: { _id: emp._id, fullName: emp.fullName, employeeCode: emp.employeeCode },
        message: `Assigned ${leads.length} lead(s) to ${emp.fullName}.`,
      },
    });
  } catch (err) { next(err); }
};

/**
 * POST /api/leads/rebalance
 * Management only. Re-splits EVERY lead evenly across the CURRENTLY active
 * Sales/Business Development team, round-robin by createdAt order — the
 * same distribution logic distributeLeads() runs at import time, just run
 * again on demand.
 *
 * Why this exists: leads are only ever handed out at the moment a file is
 * imported, split across whoever is an active Sales/Business Development
 * employee AT THAT MOMENT (see distributeLeads() above). Someone hired
 * afterward is never retroactively included — they stay at zero leads
 * until either a new file is imported or an admin runs this. This is the
 * fix for "the new sales hire shows 'No leads found' even with every
 * filter cleared, but the account itself isn't broken": nothing was
 * broken, no batch had been imported since they joined, so there was
 * nothing to assign them.
 */
const rebalanceLeads = async (req, res, next) => {
  try {
    if (!canManage(req.user?.role)) throw new AppError("Only management can rebalance leads", 403, "FORBIDDEN");

    const { Employee } = require("../models/Employee");
    // Same department match as distributeLeads() — keeps "who counts as
    // the sales team" in exactly one place in spirit, just duplicated here
    // since this runs independently of an import.
    const salesTeam = await Employee.find({
      department: { $regex: /^(sales|business development)$/i },
      status: { $in: ["ACTIVE", "active", "Active"] },
    }).select("_id fullName").sort({ employeeCode: 1 }).lean();

    if (salesTeam.length === 0) {
      throw new AppError("No active Sales/Business Development employees to rebalance across", 400, "NO_SALES_TEAM");
    }

    const leads = await Lead.find({}).select("_id name assignedTo").sort({ createdAt: 1 });
    const count = salesTeam.length;
    const now = new Date();
    const changedByUserId = req.user.userId;

    const bulkOps = leads.map((lead, i) => {
      const toEmployee = salesTeam[i % count]._id;
      return {
        updateOne: {
          filter: { _id: lead._id },
          update: {
            $set: {
              assignedTo: toEmployee,
              assignedAt: now,
              assignmentRound: Math.floor(i / count) + 1,
            },
            $push: {
              reassignmentHistory: {
                fromEmployee: lead.assignedTo || null,
                toEmployee,
                changedBy: changedByUserId,
                changedAt: now,
                reason: "Team rebalance",
              },
            },
          },
        },
      };
    });

    if (bulkOps.length > 0) await Lead.bulkWrite(bulkOps);

    const distribution = salesTeam.map((member, idx) => ({
      name: member.fullName,
      _id: member._id,
      assigned: leads.filter((_, i) => i % count === idx).length,
    }));

    try {
      const { AuditLog } = require("../models/NotificationAudit");
      await AuditLog.create({
        userId: req.user.userId,
        userEmail: req.user.email,
        action: "LEADS_REBALANCED",
        module: "leads",
        newValue: { totalLeads: leads.length, teamSize: count, distribution },
        ipAddress: req.ip,
      });
    } catch (_) { }

    res.json({
      data: {
        totalLeads: leads.length,
        teamSize: count,
        distribution,
        message: `Rebalanced ${leads.length} lead(s) across ${count} active team member(s).`,
      },
    });
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
        { $unwind: { path: "$employee", preserveNullAndEmptyArrays: true } },
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
      { $unwind: { path: "$uploader", preserveNullAndEmptyArrays: true } },
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

/**
 * GET /api/leads/team-overview
 *
 * The Sales Team Lead's roster: every rep who reports to the caller
 * (Employee.manager === caller's Employee) with a per-rep breakdown of the
 * leads assigned to them by status, plus a converted/contacted rollup. This
 * is what powers the "My Sales Team" section on the Sales Team Lead's
 * dashboard — "what team he is leading and what they've done". Team
 * membership is the same Reports-To link used everywhere else, so a
 * non-sales manager just gets their own reports (usually with zero leads).
 */
const getSalesTeamOverview = async (req, res, next) => {
  try {
    const { Employee } = require("../models/Employee");
    const self = await Employee.findOne({ user: req.user.userId })
      .select("_id fullName employeeCode department designation")
      .lean();
    if (!self) {
      return res.json({ data: { teamLead: null, members: [], totals: { members: 0, assigned: 0, contacted: 0, converted: 0 } } });
    }

    const reports = await Employee.find({ manager: self._id, isArchived: false })
      .select("_id fullName employeeCode department designation status")
      .sort({ fullName: 1 })
      .lean();
    const reportIds = reports.map((r) => r._id);

    // One aggregate for the whole team: counts of leads per (rep, status).
    const grouped = reportIds.length
      ? await Lead.aggregate([
        { $match: { assignedTo: { $in: reportIds } } },
        { $group: { _id: { assignedTo: "$assignedTo", status: "$status" }, count: { $sum: 1 } } },
      ])
      : [];

    // rep id -> { NEW: n, CONTACTED: n, ... }
    const byRep = new Map();
    for (const g of grouped) {
      const key = String(g._id.assignedTo);
      if (!byRep.has(key)) byRep.set(key, {});
      byRep.get(key)[g._id.status] = g.count;
    }

    // "Contacted" = every lead the rep has actually moved past the initial
    // NEW state (CONTACTED/INTERESTED/NOT_INTERESTED/CONVERTED/LOST); a
    // rep-level "worked" signal rather than only the literal CONTACTED status.
    const CONTACTED_STATUSES = ["CONTACTED", "INTERESTED", "NOT_INTERESTED", "CONVERTED", "LOST"];
    const members = reports.map((r) => {
      const s = byRep.get(String(r._id)) || {};
      const assigned = Object.values(s).reduce((a, b) => a + b, 0);
      const contacted = CONTACTED_STATUSES.reduce((a, k) => a + (s[k] || 0), 0);
      const converted = s.CONVERTED || 0;
      return {
        employee: r,
        leads: {
          assigned,
          new: s.NEW || 0,
          contacted,
          interested: s.INTERESTED || 0,
          converted,
          lost: s.LOST || 0,
        },
      };
    });

    const totals = members.reduce(
      (acc, m) => ({
        members: acc.members + 1,
        assigned: acc.assigned + m.leads.assigned,
        contacted: acc.contacted + m.leads.contacted,
        converted: acc.converted + m.leads.converted,
      }),
      { members: 0, assigned: 0, contacted: 0, converted: 0 },
    );

    res.json({ data: { teamLead: self, members, totals } });
  } catch (err) { next(err); }
};

module.exports = { uploadLeads, previewLeads, getLeads, getLead, updateLeadStatus, reassignLead, bulkAssignLeads, rebalanceLeads, getLeadStats, getUploadBatches, deleteBatch, revealLead, getSalesTeamOverview };