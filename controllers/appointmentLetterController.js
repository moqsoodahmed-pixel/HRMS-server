"use strict";
const { AppointmentLetter } = require("../models/AppointmentLetter");
const { AppError }          = require("../middleware/errorHandler");
const { isElevated }        = require("../utils/roles");
const { parsePagination, assertObjectId } = require("../utils/helpers");
const { sendForSigning, cancelEnvelope, getEnvelopeStatus } = require("../services/documensoService");
const path   = require("path");
const fs     = require("fs");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

function canManage(role) {
  return isElevated(role) || role === "HR_ADMIN" || role === "PROJECT_HEAD";
}

const LETTERHEAD_DIR = path.join(__dirname, "../uploads/letterhead");
const GENERATOR_PY   = path.join(__dirname, "../utils/generate_appointment.py");
const OUTPUT_DIR     = path.join(__dirname, "../uploads/appointment-letters");

[LETTERHEAD_DIR, OUTPUT_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

function findPython3() {
  const candidates = [
    ["python3"],
    ["/usr/bin/python3"],
    ["/usr/local/bin/python3"],
    ["/opt/homebrew/bin/python3"],
    ["/usr/local/opt/python3/bin/python3"],
    ["/Library/Developer/CommandLineTools/usr/bin/python3"],
    ["py", "-3"],
    ["python"],
  ];
  for (const [cmd, ...baseArgs] of candidates) {
    try {
      execFileSync(cmd, [...baseArgs, "--version"], { stdio: "pipe" });
      return { cmd, baseArgs, shellCmd: [cmd, ...baseArgs].join(" ") };
    } catch (_) {}
  }
  return { cmd: "python3", baseArgs: [], shellCmd: "python3" };
}

const PYTHON3 = findPython3();

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

const createLetter = async (req, res, next) => {
  try {
    if (!canManage(req.user?.role)) throw new AppError("Only HR/Management can create appointment letters", 403, "FORBIDDEN");
    const { employeeId, ...fields } = req.body;
    let version = 1;
    if (employeeId) {
      assertObjectId(employeeId, "employee id");
      const existing = await AppointmentLetter.find({ employee: employeeId }).sort({ version: -1 }).limit(1).lean();
      if (existing.length > 0) version = existing[0].version + 1;
    }
    const letter = await AppointmentLetter.create({
      employee: employeeId || undefined, version, status: "DRAFT",
      createdBy: req.user.userId, ...fields,
    });
    res.status(201).json({ data: letter });
  } catch (err) { next(err); }
};

const listLetters = async (req, res, next) => {
  try {
    if (!canManage(req.user?.role)) throw new AppError("Forbidden", 403, "FORBIDDEN");
    const { page, limit, skip } = parsePagination(req.query, 20);
    const query = {};
    if (req.query.employeeId) { assertObjectId(req.query.employeeId, "employee id"); query.employee = req.query.employeeId; }
    if (req.query.status) query.status = req.query.status;
    const [letters, total] = await Promise.all([
      AppointmentLetter.find(query)
        .populate("employee", "fullName employeeCode designation department")
        .populate("createdBy", "email").populate("generatedBy", "email")
        .populate("sentForSigningBy", "email")
        .sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AppointmentLetter.countDocuments(query),
    ]);
    res.json({ data: letters, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
};

const getLetter = async (req, res, next) => {
  try {
    if (!canManage(req.user?.role)) throw new AppError("Forbidden", 403, "FORBIDDEN");
    assertObjectId(req.params.id, "letter id");
    const letter = await AppointmentLetter.findById(req.params.id)
      .populate("employee", "fullName firstName employeeCode designation department dateOfJoining workLocation email")
      .populate("createdBy", "email").populate("generatedBy", "email")
      .populate("sentForSigningBy", "email")
      .lean();
    if (!letter) throw new AppError("Not found", 404, "NOT_FOUND");
    res.json({ data: letter });
  } catch (err) { next(err); }
};

const updateLetter = async (req, res, next) => {
  try {
    if (!canManage(req.user?.role)) throw new AppError("Forbidden", 403, "FORBIDDEN");
    assertObjectId(req.params.id, "letter id");
    const { employeeId, ...fields } = req.body;
    const letter = await AppointmentLetter.findById(req.params.id);
    if (!letter) throw new AppError("Not found", 404, "NOT_FOUND");
    if (letter.status === "ISSUED") throw new AppError("Cannot edit an issued letter.", 400, "IMMUTABLE");
    Object.assign(letter, fields);
    if (employeeId) { assertObjectId(employeeId, "employee id"); letter.employee = employeeId; }
    await letter.save();
    res.json({ data: letter });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PDF Generation
// ─────────────────────────────────────────────────────────────────────────────

const generatePDF = async (req, res, next) => {
  try {
    if (!canManage(req.user?.role)) throw new AppError("Forbidden", 403, "FORBIDDEN");
    assertObjectId(req.params.id, "letter id");

    const letter = await AppointmentLetter.findById(req.params.id)
      .populate("employee", "fullName firstName employeeCode designation department dateOfJoining workLocation")
      .lean();
    if (!letter) throw new AppError("Not found", 404, "NOT_FOUND");

    try {
      execFileSync(PYTHON3.cmd, [...PYTHON3.baseArgs, "--version"], { stdio: "pipe" });
    } catch (e) {
      throw new AppError(
        `Python 3 not found. Please install Python 3 and run: pip3 install reportlab pillow`,
        500, "PYTHON_NOT_FOUND"
      );
    }

    try {
      execFileSync(PYTHON3.cmd, [...PYTHON3.baseArgs, "-c", "import reportlab, PIL"], { stdio: "pipe" });
    } catch (e) {
      console.log("[appointment-letter] reportlab/pillow not found — installing...");
      try {
        execFileSync(
          PYTHON3.cmd,
          [...PYTHON3.baseArgs, "-m", "pip", "install", "--break-system-packages", "--quiet", "reportlab", "pillow"],
          { stdio: "pipe" }
        );
        console.log("[appointment-letter] reportlab + pillow installed successfully.");
      } catch (e2) {
        try {
          execFileSync(
            PYTHON3.cmd,
            [...PYTHON3.baseArgs, "-m", "pip", "install", "--quiet", "reportlab", "pillow"],
            { stdio: "pipe" }
          );
          console.log("[appointment-letter] reportlab + pillow installed (fallback) successfully.");
        } catch (e3) {
          throw new AppError(
            `Required Python packages missing and auto-install failed. Please run: pip3 install reportlab pillow`,
            500, "MISSING_PACKAGES"
          );
        }
      }
    }

    ensureLetterheadAssets();

    const filename = `appointment_${req.params.id}_v${letter.version}_${Date.now()}.pdf`;
    const outPath  = path.join(OUTPUT_DIR, filename);

    const fields = {
      dateOfIssue:             letter.dateOfIssue   || new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }),
      employeeFullName:        letter.employeeFullName  || letter.employee?.fullName  || "",
      employeeFirstName:       letter.employeeFirstName || letter.employee?.firstName || "",
      employeeCode:            letter.employeeCode      || letter.employee?.employeeCode || "",
      designation:             letter.designation    || letter.employee?.designation  || "",
      joiningDate:             letter.joiningDate    || "",
      compensation:            letter.compensation   || "",
      compensationWords:       letter.compensationWords || "",
      incentivePercent:        letter.incentivePercent  || "15",
      reportingManager:        letter.reportingManager  || "management/person",
      workLocation:            letter.workLocation   || letter.employee?.workLocation || "",
      registeredCompanyName:   letter.registeredCompanyName  || "DutyLaunch Solutions Private Limited",
      authorizedSignatoryName: letter.authorizedSignatoryName || "Moqsood Ahmed",
      authorizedSignatoryDesignation: letter.authorizedSignatoryDesignation || "Founder and CEO",
      offerLetterDate:         letter.offerLetterDate     || "",
      offerLetterJoiningDate:  letter.offerLetterJoiningDate || "",
      includeIncentive:        letter.includeIncentive !== false,
      duties:                  letter.duties          || [],
      outputPath:              outPath,
    };

    const tmpJson = path.join(OUTPUT_DIR, `tmp_${Date.now()}.json`);
    fs.writeFileSync(tmpJson, JSON.stringify(fields));

    let pythonError = "";
    try {
      execFileSync(PYTHON3.cmd, [...PYTHON3.baseArgs, GENERATOR_PY, tmpJson], {
        timeout: 60000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      pythonError = (e.stderr?.toString() || e.stdout?.toString() || e.message || "Unknown error").slice(0, 500);
      console.error("[appointment-letter] Python error:", pythonError);
    } finally {
      try { fs.unlinkSync(tmpJson); } catch (_) {}
    }

    if (!fs.existsSync(outPath)) {
      throw new AppError(
        `PDF generation failed. ${pythonError ? "Python error: " + pythonError : "Output file not created."}`,
        500, "GENERATION_FAILED"
      );
    }

    await AppointmentLetter.findByIdAndUpdate(req.params.id, {
      status: "GENERATED", generatedAt: new Date(),
      generatedBy: req.user.userId,
      pdfPath: `/uploads/appointment-letters/${filename}`,
    });

    try {
      const { AuditLog } = require("../models/NotificationAudit");
      await AuditLog.create({
        userId: req.user.userId, userEmail: req.user.email,
        action: "APPOINTMENT_LETTER_GENERATED", module: "appointment-letters",
        recordId: String(req.params.id), recordLabel: fields.employeeFullName, ipAddress: req.ip,
      });
    } catch (_) {}

    res.json({ data: { message: "PDF generated successfully.", pdfReady: true } });
  } catch (err) { next(err); }
};

function ensureLetterheadAssets() {
  const headerPath = path.join(LETTERHEAD_DIR, "header.png");
  const footerPath = path.join(LETTERHEAD_DIR, "footer.png");

  try {
    const serverAssets = path.join(__dirname, "../utils/letterheadAssets.js");
    if (fs.existsSync(serverAssets)) {
      const { LETTERHEAD_HEADER_B64, LETTERHEAD_FOOTER_B64 } = require(serverAssets);
      if (LETTERHEAD_HEADER_B64) {
        fs.writeFileSync(headerPath, Buffer.from(LETTERHEAD_HEADER_B64, "base64"));
        console.log("[appointment-letter] header.png written from letterheadAssets.js");
      }
      if (LETTERHEAD_FOOTER_B64) {
        fs.writeFileSync(footerPath, Buffer.from(LETTERHEAD_FOOTER_B64, "base64"));
        console.log("[appointment-letter] footer.png written from letterheadAssets.js");
      }
      return;
    }

    const clientAssets = path.join(__dirname, "../../HRMS-client/src/assets/letterheadImages.js");
    if (fs.existsSync(clientAssets)) {
      const content = fs.readFileSync(clientAssets, "utf8");
      const hdrMatch = content.match(/LETTERHEAD_HEADER\s*=\s*"data:image\/png;base64,([^"]+)"/);
      if (hdrMatch) {
        fs.writeFileSync(headerPath, Buffer.from(hdrMatch[1], "base64"));
        console.log("[appointment-letter] header.png synced from letterheadImages.js");
      }
      const ftrMatch = content.match(/LETTERHEAD_FOOTER\s*=\s*"data:image\/png;base64,([^"]+)"/);
      if (ftrMatch) {
        fs.writeFileSync(footerPath, Buffer.from(ftrMatch[1], "base64"));
        console.log("[appointment-letter] footer.png synced from letterheadImages.js");
      }
      return;
    }

    console.warn("[appointment-letter] No letterhead asset source found — header/footer will be blank.");
  } catch (err) {
    console.error("[appointment-letter] Error writing letterhead assets:", err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Download
// ─────────────────────────────────────────────────────────────────────────────

const downloadPDF = async (req, res, next) => {
  try {
    if (!canManage(req.user?.role)) throw new AppError("Forbidden", 403, "FORBIDDEN");
    assertObjectId(req.params.id, "letter id");
    const letter = await AppointmentLetter.findById(req.params.id).lean();
    if (!letter) throw new AppError("Not found", 404, "NOT_FOUND");
    if (!letter.pdfPath) throw new AppError("PDF not generated yet.", 404, "NOT_GENERATED");
    const filepath = path.join(__dirname, "..", letter.pdfPath);
    if (!fs.existsSync(filepath)) throw new AppError("PDF file missing. Please regenerate.", 404, "FILE_MISSING");
    const safeName = (letter.employeeFullName || "employee").replace(/[^a-zA-Z0-9]/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Appointment_Letter_${safeName}_v${letter.version}.pdf"`);
    fs.createReadStream(filepath).pipe(res);
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// Documenso: Send for e-signing
// ─────────────────────────────────────────────────────────────────────────────

const sendLetterForSigning = async (req, res, next) => {
  try {
    if (!canManage(req.user?.role)) throw new AppError("Forbidden", 403, "FORBIDDEN");
    assertObjectId(req.params.id, "letter id");

    const letter = await AppointmentLetter.findById(req.params.id)
      .populate("employee", "fullName email")
      .lean();

    if (!letter) throw new AppError("Not found", 404, "NOT_FOUND");

    if (letter.status !== "GENERATED") {
      throw new AppError(
        `PDF must be generated before sending for signing. Current status: ${letter.status}`,
        400, "INVALID_STATUS"
      );
    }

    const pdfAbsPath = path.join(__dirname, "..", letter.pdfPath);
    if (!fs.existsSync(pdfAbsPath)) {
      throw new AppError("PDF file is missing from disk. Please regenerate the PDF first.", 404, "FILE_MISSING");
    }

    const employeeEmail = req.body.employeeEmail || letter.employee?.email;
    if (!employeeEmail) {
      throw new AppError(
        "Employee email is required. Pass it as employeeEmail in the request body, or ensure the employee record has an email.",
        400, "MISSING_EMAIL"
      );
    }

    const employeeFullName = letter.employeeFullName || letter.employee?.fullName || "Employee";

    const { envelopeId, signingUrl } = await sendForSigning({
      pdfPath: pdfAbsPath,
      employeeFullName,
      employeeEmail,
      letterId: String(letter._id),
      signaturePage: req.body.signaturePage || 1,
      sigX:          req.body.sigX          || 10,
      sigY:          req.body.sigY          || 82,
    });

    await AppointmentLetter.findByIdAndUpdate(req.params.id, {
      status:              "SENT_FOR_SIGNING",
      documensoEnvelopeId: envelopeId,
      documensoSigningUrl: signingUrl,
      documensoStatus:     "PENDING",
      sentForSigningAt:    new Date(),
      sentForSigningBy:    req.user.userId,
    });

    try {
      const { AuditLog } = require("../models/NotificationAudit");
      await AuditLog.create({
        userId:      req.user.userId,
        userEmail:   req.user.email,
        action:      "APPOINTMENT_LETTER_SENT_FOR_SIGNING",
        module:      "appointment-letters",
        recordId:    String(req.params.id),
        recordLabel: employeeFullName,
        ipAddress:   req.ip,
      });
    } catch (_) {}

    res.json({
      data: {
        message:    "Appointment letter sent to employee for e-signing via Documenso.",
        envelopeId,
        signingUrl,
      },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// Documenso: Cancel a pending signing request
// ─────────────────────────────────────────────────────────────────────────────

const cancelSigning = async (req, res, next) => {
  try {
    if (!canManage(req.user?.role)) throw new AppError("Forbidden", 403, "FORBIDDEN");
    assertObjectId(req.params.id, "letter id");

    const letter = await AppointmentLetter.findById(req.params.id).lean();
    if (!letter) throw new AppError("Not found", 404, "NOT_FOUND");

    if (letter.status !== "SENT_FOR_SIGNING") {
      throw new AppError(
        `Can only cancel a letter that is currently SENT_FOR_SIGNING. Current status: ${letter.status}`,
        400, "INVALID_STATUS"
      );
    }

    if (!letter.documensoEnvelopeId) {
      throw new AppError("No Documenso envelope ID on record for this letter.", 400, "NO_ENVELOPE");
    }

    const reason = req.body.reason || "Cancelled by HR";
    await cancelEnvelope(letter.documensoEnvelopeId, reason);

    await AppointmentLetter.findByIdAndUpdate(req.params.id, {
      status:          "GENERATED",
      documensoStatus: "CANCELLED",
    });

    try {
      const { AuditLog } = require("../models/NotificationAudit");
      await AuditLog.create({
        userId:      req.user.userId,
        userEmail:   req.user.email,
        action:      "APPOINTMENT_LETTER_SIGNING_CANCELLED",
        module:      "appointment-letters",
        recordId:    String(req.params.id),
        recordLabel: letter.employeeFullName,
        ipAddress:   req.ip,
      });
    } catch (_) {}

    res.json({ data: { message: "Signing request cancelled. Letter reverted to GENERATED status." } });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// Documenso: Manual status sync (workaround for Free plan — no webhooks)
// HR clicks "Refresh Status" in the frontend to pull the latest signing status
// from Documenso and update the letter in the DB.
// Route: GET /api/appointment-letters/:id/sync-status
// ─────────────────────────────────────────────────────────────────────────────

const syncSigningStatus = async (req, res, next) => {
  try {
    if (!canManage(req.user?.role)) throw new AppError("Forbidden", 403, "FORBIDDEN");
    assertObjectId(req.params.id, "letter id");

    const letter = await AppointmentLetter.findById(req.params.id).lean();
    if (!letter) throw new AppError("Not found", 404, "NOT_FOUND");

    if (!letter.documensoEnvelopeId) {
      throw new AppError(
        "This letter has not been sent for signing yet — no Documenso envelope to check.",
        400, "NO_ENVELOPE"
      );
    }

    // Pull the live status from Documenso API
    const documensoStatus = await getEnvelopeStatus(letter.documensoEnvelopeId);

    const update = { documensoStatus };

    if (documensoStatus === "COMPLETED") {
      update.status    = "SIGNED";
      update.signedAt  = letter.signedAt || new Date();
    } else if (documensoStatus === "REJECTED") {
      // Keep status as SENT_FOR_SIGNING so HR sees it needs attention
      update.documensoStatus = "REJECTED";
    } else if (documensoStatus === "CANCELLED") {
      update.status          = "GENERATED";
      update.documensoStatus = "CANCELLED";
    }
    // PENDING → no status change needed

    await AppointmentLetter.findByIdAndUpdate(req.params.id, update);

    const updatedLetter = await AppointmentLetter.findById(req.params.id).lean();

    res.json({
      data: {
        message:        `Status synced from Documenso: ${documensoStatus}`,
        documensoStatus,
        status:         updatedLetter.status,
        signedAt:       updatedLetter.signedAt || null,
      },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// Documenso: Webhook receiver
// Called by Documenso when the employee signs, rejects, or the doc is cancelled.
// NOTE: Documenso sends the secret as a plain string in X-Documenso-Secret header
// (NOT as an HMAC signature). We do a plain constant-time comparison here.
// ─────────────────────────────────────────────────────────────────────────────

const documensoWebhook = async (req, res, next) => {
  try {
    // ── Verify Documenso webhook secret (plain string, not HMAC) ─────────────
    const webhookSecret = process.env.DOCUMENSO_WEBHOOK_SECRET;
    if (webhookSecret) {
      const received = req.headers["x-documenso-secret"] || "";
      if (!received) {
        return res.status(401).json({ error: "Missing x-documenso-secret header." });
      }
      // Use constant-time comparison to prevent timing attacks
      try {
        if (!crypto.timingSafeEqual(
          Buffer.from(received),
          Buffer.from(webhookSecret)
        )) {
          return res.status(401).json({ error: "Invalid webhook secret." });
        }
      } catch (_) {
        // timingSafeEqual throws if buffers are different lengths — means mismatch
        return res.status(401).json({ error: "Invalid webhook secret." });
      }
    }

    const { event, payload } = req.body;

    // Documenso v2 webhook payload uses "payload.id" not "data.id"
    const envelopeId = payload?.id ?? req.body?.data?.id;

    if (!envelopeId) {
      return res.json({ received: true });
    }

    if (event === "DOCUMENT_COMPLETED" || event === "document.completed") {
      await AppointmentLetter.findOneAndUpdate(
        { documensoEnvelopeId: String(envelopeId) },
        {
          status:          "SIGNED",
          documensoStatus: "COMPLETED",
          signedAt:        new Date(),
        }
      );
    } else if (event === "DOCUMENT_REJECTED" || event === "document.rejected") {
      await AppointmentLetter.findOneAndUpdate(
        { documensoEnvelopeId: String(envelopeId) },
        { documensoStatus: "REJECTED" }
      );
    } else if (event === "DOCUMENT_CANCELLED" || event === "document.cancelled") {
      await AppointmentLetter.findOneAndUpdate(
        { documensoEnvelopeId: String(envelopeId) },
        {
          status:          "GENERATED",
          documensoStatus: "CANCELLED",
        }
      );
    }

    // Always return 200 — Documenso retries on non-2xx
    res.json({ received: true });
  } catch (err) { next(err); }
};

module.exports = {
  createLetter,
  listLetters,
  getLetter,
  updateLetter,
  generatePDF,
  downloadPDF,
  sendLetterForSigning,
  cancelSigning,
  syncSigningStatus,
  documensoWebhook,
};