"use strict";
const fs   = require("fs");
const path = require("path");

const BASE_URL = process.env.DOCUMENSO_BASE_URL || "https://app.documenso.com";
const API_KEY  = () => process.env.DOCUMENSO_API_KEY || "";

/**
 * Upload the generated appointment PDF to Documenso, place a SIGNATURE field
 * and a DATE field on the page, then immediately distribute (sends the email).
 *
 * @param {object} opts
 * @param {string} opts.pdfPath          - Absolute path to the generated PDF on disk
 * @param {string} opts.employeeFullName - Recipient display name
 * @param {string} opts.employeeEmail    - Recipient email address
 * @param {string} opts.letterId         - MongoDB _id of the AppointmentLetter (used as externalId)
 * @param {number} [opts.signaturePage]  - Page number (1-indexed) where the sig field goes. Default: 1
 * @param {number} [opts.sigX]           - Signature field left edge, % of page width.  Default: 10
 * @param {number} [opts.sigY]           - Signature field top edge,  % of page height. Default: 82
 *
 * @returns {{ envelopeId: string, signingUrl: string|null }}
 */
async function sendForSigning({
  pdfPath,
  employeeFullName,
  employeeEmail,
  letterId,
  signaturePage = 1,
  sigX = 10,
  sigY = 82,
}) {
  const apiKey = API_KEY();
  if (!apiKey) throw new Error("DOCUMENSO_API_KEY is not configured in environment variables.");
  if (!fs.existsSync(pdfPath)) throw new Error(`PDF not found at path: ${pdfPath}`);

  const pdfBuffer = fs.readFileSync(pdfPath);
  const pdfName   = path.basename(pdfPath);
  const boundary  = `----DocumensoHRMS${Date.now()}`;

  const payload = {
    type:       "DOCUMENT",
    title:      `Appointment Letter – ${employeeFullName}`,
    externalId: `hrms-appointment-${letterId}`,
    recipients: [
      {
        email:  employeeEmail,
        name:   employeeFullName,
        role:   "SIGNER",
        fields: [
          {
            identifier: 0,
            type:       "SIGNATURE",
            page:       signaturePage,
            positionX:  sigX,
            positionY:  sigY,
            width:      30,
            height:     5,
          },
          {
            identifier: 0,
            type:       "DATE",
            page:       signaturePage,
            positionX:  sigX + 40,
            positionY:  sigY,
            width:      20,
            height:     4,
          },
        ],
      },
    ],
    meta: {
      subject: `Action Required – Please Sign Your Appointment Letter`,
      message: `Dear ${employeeFullName},\n\nPlease review and sign your appointment letter at your earliest convenience.\n\nRegards,\nHR Team`,
    },
  };

  // Build raw multipart body (no extra dependency; Node 18+ fetch + FormData)
  const payloadPart =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="payload"\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    JSON.stringify(payload) +
    `\r\n`;

  const filePart =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="files"; filename="${pdfName}"\r\n` +
    `Content-Type: application/pdf\r\n\r\n`;

  const closing = `\r\n--${boundary}--\r\n`;

  const body = Buffer.concat([
    Buffer.from(payloadPart, "utf8"),
    Buffer.from(filePart,    "utf8"),
    pdfBuffer,
    Buffer.from(closing,     "utf8"),
  ]);

  // ── 1. Create the envelope ──────────────────────────────────────────────────
  const createRes = await fetch(`${BASE_URL}/api/v2/envelope/create`, {
    method:  "POST",
    headers: {
      Authorization:  apiKey,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Documenso /envelope/create failed (HTTP ${createRes.status}): ${errText}`);
  }

  const { id: envelopeId } = await createRes.json();
  if (!envelopeId) throw new Error("Documenso returned no envelope id after create.");

  // ── 2. Distribute (sends signing email to employee) ──────────────────────
  const distRes = await fetch(`${BASE_URL}/api/v2/envelope/distribute`, {
    method:  "POST",
    headers: {
      Authorization:  apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ envelopeId }),
  });

  if (!distRes.ok) {
    const errText = await distRes.text();
    throw new Error(`Documenso /envelope/distribute failed (HTTP ${distRes.status}): ${errText}`);
  }

  const distData   = await distRes.json();
  const signingUrl = distData.recipients?.[0]?.signingUrl ?? null;

  return { envelopeId, signingUrl };
}

/**
 * Fetch the current status of a Documenso envelope.
 * Used by syncSigningStatus() as a manual workaround when webhooks are unavailable (Free plan).
 *
 * Returns one of: "DRAFT" | "PENDING" | "COMPLETED" | "REJECTED" | "CANCELLED"
 *
 * @param {string} envelopeId
 * @returns {Promise<string>}
 */
async function getEnvelopeStatus(envelopeId) {
  const apiKey = API_KEY();
  if (!apiKey) throw new Error("DOCUMENSO_API_KEY is not configured.");

  const res = await fetch(`${BASE_URL}/api/v2/envelope/${envelopeId}`, {
    headers: { Authorization: apiKey },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Documenso status check failed (HTTP ${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.status;
}

/**
 * Cancel a pending Documenso envelope (e.g. HR revokes the letter).
 *
 * @param {string} envelopeId
 * @param {string} [reason]
 */
async function cancelEnvelope(envelopeId, reason = "Cancelled by HR") {
  const apiKey = API_KEY();
  if (!apiKey) throw new Error("DOCUMENSO_API_KEY is not configured.");

  const res = await fetch(`${BASE_URL}/api/v2/envelope/cancel`, {
    method:  "POST",
    headers: {
      Authorization:  apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ envelopeId, reason }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Documenso cancel failed (HTTP ${res.status}): ${errText}`);
  }
}

module.exports = { sendForSigning, getEnvelopeStatus, cancelEnvelope };