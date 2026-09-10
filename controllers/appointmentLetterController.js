"use strict";
const { AppointmentLetter } = require("../models/AppointmentLetter");
const { AppError } = require("../middleware/errorHandler");
const { isElevated } = require("../utils/roles");
const { parsePagination, assertObjectId } = require("../utils/helpers");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

function canManage(role) {
  return isElevated(role) || role === "HR_ADMIN";
}

const LETTERHEAD_DIR = path.join(__dirname, "../uploads/letterhead");
const GENERATOR_PY   = path.join(__dirname, "../utils/generate_appointment.py");
const OUTPUT_DIR     = path.join(__dirname, "../uploads/appointment-letters");

[LETTERHEAD_DIR, OUTPUT_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

/** Find a Python 3 executable across platforms. Returns { cmd, baseArgs }
 * split apart for execFileSync — e.g. Windows' "py -3" launcher is not
 * itself an executable name, "py" is, with "-3" as a leading arg. */
function findPython3() {
  const candidates = [
    ["python3"],
    ["/usr/bin/python3"],
    ["/usr/local/bin/python3"],
    ["/opt/homebrew/bin/python3"],     // macOS Apple Silicon Homebrew
    ["/usr/local/opt/python3/bin/python3"],
    ["/Library/Developer/CommandLineTools/usr/bin/python3"], // macOS Xcode tools
    ["py", "-3"],     // Windows py launcher
    ["python"],       // Windows python.org installer / most Windows environments
  ];
  for (const [cmd, ...baseArgs] of candidates) {
    try {
      execFileSync(cmd, [...baseArgs, "--version"], { stdio: "pipe" });
      return { cmd, baseArgs, shellCmd: [cmd, ...baseArgs].join(" ") };
    } catch (_) {}
  }
  return { cmd: "python3", baseArgs: [], shellCmd: "python3" }; // fallback
}

const PYTHON3 = findPython3();

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
      .populate("employee", "fullName firstName employeeCode designation department dateOfJoining workLocation")
      .populate("createdBy", "email").populate("generatedBy", "email").lean();
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

const generatePDF = async (req, res, next) => {
  try {
    if (!canManage(req.user?.role)) throw new AppError("Forbidden", 403, "FORBIDDEN");
    assertObjectId(req.params.id, "letter id");

    const letter = await AppointmentLetter.findById(req.params.id)
      .populate("employee", "fullName firstName employeeCode designation department dateOfJoining workLocation")
      .lean();
    if (!letter) throw new AppError("Not found", 404, "NOT_FOUND");

    // Check Python is available
    try {
      execFileSync(PYTHON3.cmd, [...PYTHON3.baseArgs, "--version"], { stdio: "pipe" });
    } catch (e) {
      throw new AppError(
        `Python 3 not found. Please install Python 3 and run: pip3 install reportlab pillow`,
        500, "PYTHON_NOT_FOUND"
      );
    }

    // Check reportlab is installed
    try {
      execFileSync(PYTHON3.cmd, [...PYTHON3.baseArgs, "-c", "import reportlab, PIL"], { stdio: "pipe" });
    } catch (e) {
      throw new AppError(
        `Required Python packages missing. Run: pip3 install reportlab pillow`,
        500, "MISSING_PACKAGES"
      );
    }

    // Check letterhead assets exist — if not, create them from embedded data
    ensureLetterheadAssets();

    const filename = `appointment_${req.params.id}_v${letter.version}_${Date.now()}.pdf`;
    const outPath  = path.join(OUTPUT_DIR, filename);

    const fields = {
      dateOfIssue:             letter.dateOfIssue   || new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }),
      employeeFullName:        letter.employeeFullName  || letter.employee?.fullName  || "",
      employeeFirstName:       letter.employeeFirstName || letter.employee?.firstName || "",
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

/**
 * Ensure letterhead PNG assets exist on disk.
 * They are embedded as base64 in the source — decode and write if missing.
 */
function ensureLetterheadAssets() {
  const headerPath = path.join(LETTERHEAD_DIR, "header.png");
  const footerPath = path.join(LETTERHEAD_DIR, "footer.png");

  // Always re-extract from letterheadImages.js so design updates are reflected
  // without needing to manually delete the files from uploads/letterhead/
  const assetsFile = path.join(__dirname, "../../HRMS-client/src/assets/letterheadImages.js");
  if (fs.existsSync(assetsFile)) {
    const content = fs.readFileSync(assetsFile, "utf8");

    const hdrMatch = content.match(/LETTERHEAD_HEADER\s*=\s*"data:image\/png;base64,([^"]+)"/);
    if (hdrMatch) {
      fs.writeFileSync(headerPath, Buffer.from(hdrMatch[1], "base64"));
      console.log("[appointment-letter] header.png synced from letterheadImages.js");
    } else if (!fs.existsSync(headerPath)) {
      console.warn("[appointment-letter] LETTERHEAD_HEADER not found in letterheadImages.js");
    }

    const ftrMatch = content.match(/LETTERHEAD_FOOTER\s*=\s*"data:image\/png;base64,([^"]+)"/);
    if (ftrMatch) {
      fs.writeFileSync(footerPath, Buffer.from(ftrMatch[1], "base64"));
      console.log("[appointment-letter] footer.png synced from letterheadImages.js");
    } else if (!fs.existsSync(footerPath)) {
      console.warn("[appointment-letter] LETTERHEAD_FOOTER not found in letterheadImages.js");
    }
  } else {
    // letterheadImages.js not found — keep existing files if present
    if (!fs.existsSync(headerPath) || !fs.existsSync(footerPath)) {
      console.warn("[appointment-letter] letterheadImages.js not found and letterhead images missing — PDF header/footer will be blank");
    }
  }
}

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

module.exports = { createLetter, listLetters, getLetter, updateLetter, generatePDF, downloadPDF };