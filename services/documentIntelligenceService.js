"use strict";

// Polyfill process.getBuiltinModule and web primitives for Node.js <= 18 compatibility (required by pdf-parse v2)
if (typeof process.getBuiltinModule !== 'function') {
  process.getBuiltinModule = function (name) {
    try {
      return require(name);
    } catch {
      return undefined;
    }
  };
}
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() {
      this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
    }
  };
}
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(w, h) {
      this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4);
    }
  };
}
if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = class Path2D {};
}

let PDFParse = null;
try {
  const pdfParsePkg = require('pdf-parse');
  PDFParse = pdfParsePkg.PDFParse || pdfParsePkg;
} catch (loadErr) {
  console.warn('[documentIntelligence] Warning loading pdf-parse:', loadErr.message);
}

const Tesseract = require('tesseract.js');

/**
 * Normalizes text lines, removes spurious control chars, trims excessive whitespace.
 */
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Fast zero-dependency image dimensions extractor for JPEG and PNG buffers.
 */
function getImageDimensions(buffer) {
  if (!buffer || buffer.length < 24) return null;
  // PNG: signature 0x89 0x50 0x4E 0x47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  // JPEG: starts with 0xFF 0xD8
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
    let offset = 2;
    while (offset < buffer.length) {
      while (offset < buffer.length && buffer[offset] === 0xFF) offset++;
      if (offset >= buffer.length) break;
      const marker = buffer[offset++];
      if (marker === 0xD9 || marker === 0xDA) break; // EOI or SOS
      if (offset + 2 > buffer.length) break;
      const len = buffer.readUInt16BE(offset);
      // SOF markers: C0, C1, C2, C3, C5, C6, C7, C9, CA, CB, CD, CE, CF
      if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)) {
        if (offset + 7 <= buffer.length) {
          const height = buffer.readUInt16BE(offset + 3);
          const width = buffer.readUInt16BE(offset + 5);
          return { width, height };
        }
      }
      offset += len;
    }
  }
  return null;
}

/**
 * Sanitizes candidate person names extracted from OCR lines.
 */
function cleanName(raw) {
  if (!raw) return '';
  let cleaned = raw
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[-—–_]/g, ' ')
    .replace(/[^A-Za-z.\s]+$/, '')
    .trim();
  cleaned = cleaned.replace(/([a-z])([A-Z])/g, '$1 $2');
  cleaned = cleaned.replace(/\s+(?:ll|is|os|a|ii|li|l|i)$/i, '').trim();
  cleaned = cleaned.replace(/\s+/g, ' ');
  return cleaned;
}

/**
 * Extracts raw readable text from uploaded file buffer (supports PDF, scanned PDF, JPG, PNG, WEBP).
 */
async function extractTextFromBuffer(fileBuffer, mimeType = '', originalName = '') {
  const isPdf = mimeType === 'application/pdf' || originalName.toLowerCase().endsWith('.pdf');

  if (isPdf && PDFParse) {
    try {
      const uint8 = new Uint8Array(fileBuffer);
      const parser = new PDFParse(uint8);
      const res = await parser.getText();
      let fullText = '';
      if (res && res.pages && Array.isArray(res.pages)) {
        fullText = res.pages.map(p => p.text || '').join('\n');
      } else if (res && typeof res.text === 'string') {
        fullText = res.text;
      }

      fullText = cleanText(fullText);

      // If PDF had digital text with enough length, return immediately
      if (fullText && fullText.length >= 25) {
        return { text: fullText, method: 'pdf-digital' };
      }

      // If digital text was sparse (e.g. scanned PDF document), attempt OCR on first page screenshot
      try {
        const screenshot = await parser.getScreenshot({ pageIndex: 0 });
        if (screenshot && screenshot.pages && screenshot.pages[0] && screenshot.pages[0].data) {
          const pageImgBuffer = Buffer.from(screenshot.pages[0].data);
          const ocrResult = await Tesseract.recognize(pageImgBuffer, 'eng');
          const ocrText = cleanText(ocrResult.data?.text || '');
          if (ocrText) {
            return { text: ocrText, method: 'pdf-ocr' };
          }
        }
      } catch (ocrPdfErr) {
        console.warn('[documentIntelligence] Scanned PDF OCR fallback failed:', ocrPdfErr.message);
      }

      return { text: fullText, method: 'pdf-digital-sparse' };
    } catch (pdfErr) {
      console.warn('[documentIntelligence] PDF parsing error:', pdfErr.message);
    }
  }

  // Handle image files or fallback OCR
  try {
    const ocrResult = await Tesseract.recognize(fileBuffer, 'eng');
    const text = cleanText(ocrResult.data?.text || '');
    return { text, method: 'image-ocr' };
  } catch (imgErr) {
    console.warn('[documentIntelligence] Image OCR error:', imgErr.message);
    return { text: '', method: 'failed' };
  }
}

/**
 * Specialized parser for Aadhaar cards.
 */
function parseAadhaar(text) {
  const data = {};

  // 1. Aadhaar Number (12 digits, often formatted as 4 4 4)
  const numMatch = text.match(/\b([2-9][0-9]{3}\s[0-9]{4}\s[0-9]{4})\b/) ||
                   text.match(/\b([2-9][0-9]{11})\b/);
  if (numMatch) {
    const raw = numMatch[1].replace(/\s+/g, '');
    data.aadhaarNumber = `${raw.slice(0, 4)} ${raw.slice(4, 8)} ${raw.slice(8, 12)}`;
  }

  // 2. Gender
  const genderMatch = text.match(/\b(MALE|FEMALE|TRANSGENDER)\b/i);
  if (genderMatch) {
    data.gender = genderMatch[1].toUpperCase();
  }

  // 3. Date of Birth
  const dobMatch = text.match(/(?:DOB|Date of Birth|Birth|D\.O\.B)[:\s]+([0-9]{2}[/-][0-9]{2}[/-][0-9]{4})/i) ||
                   text.match(/(?:Year of Birth|YOB)[:\s]+([0-9]{4})/i) ||
                   text.match(/\b([0-9]{2}\/[0-9]{2}\/[0-9]{4})\b/);
  if (dobMatch) {
    data.dob = dobMatch[1];
  }

  // 4. Full Name
  // Typically precedes the DOB line, or appears below Government of India
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let nameFound = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(Government of India|Bharat Sarkar|UIDAI|Unique Identification|Enrollment|Help)/i.test(line)) {
      continue;
    }
    if (/(?:DOB|Date of Birth|Birth|Year of Birth)/i.test(line)) {
      if (i > 0) {
        const prev = lines[i - 1];
        if (prev.length >= 3 && prev.length <= 50 && !/^\d+$/.test(prev)) {
          nameFound = prev;
          break;
        }
      }
    }
  }
  if (!nameFound) {
    const explicitName = text.match(/(?:Name|Full Name)[:\s]*([A-Za-z\s.]+)/i);
    if (explicitName) nameFound = explicitName[1].trim();
  }
  if (nameFound) {
    data.fullName = nameFound.replace(/[^A-Za-z\s.]/g, '').trim();
  }

  // 5. Address (if available, e.g. back side of Aadhaar)
  const addrMatch = text.match(/(?:Address|Address\s*:|S\/O|W\/O|D\/O|C\/O)[:\s]+([\s\S]{10,250}?(?:[1-9][0-9]{5}))/i);
  if (addrMatch) {
    data.address = addrMatch[1].replace(/\n+/g, ', ').replace(/\s+/g, ' ').trim();
  }

  return data;
}

/**
 * Specialized parser for PAN cards.
 */
function parsePAN(text) {
  const data = {};

  // 1. PAN Number: 10 chars, [A-Z]{5}[0-9]{4}[A-Z]{1}
  const panMatch = text.match(/\b([A-Z]{5}[0-9]{4}[A-Z]{1})\b/i);
  if (panMatch) {
    data.panNumber = panMatch[1].toUpperCase();
  }

  // 2. Date of Birth: DD/MM/YYYY
  const dobMatch = text.match(/(?:Date of Birth|DOB)[:\s]*([0-9]{2}[/-][0-9]{2}[/-][0-9]{4})/i) ||
                   text.match(/\b([0-9]{2}\/[0-9]{2}\/[0-9]{4})\b/);
  if (dobMatch) {
    data.dob = dobMatch[1];
  }

  // 3. Father's Name
  const fatherMatch = text.match(/(?:Father's Name|Father Name|Fathers Name)[:\s]*\n?([A-Za-z\s.]+)/i);
  if (fatherMatch) {
    data.fatherName = fatherMatch[1].split('\n')[0].replace(/[^A-Za-z\s.]/g, '').trim();
  }

  // 4. Full Name (card holder name)
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let nameFound = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/(?:INCOME TAX DEPARTMENT|GOVT\.? OF INDIA|Permanent Account Number|Card)/i.test(line)) {
      continue;
    }
    if (data.panNumber && line.toUpperCase().includes(data.panNumber)) {
      continue;
    }
    if (/(?:Father's Name|Father Name)/i.test(line)) {
      if (i > 0 && !nameFound) {
        nameFound = lines[i - 1];
      }
      continue;
    }
    if (!nameFound && line.length >= 3 && line.length <= 40 && /^[A-Za-z\s.]+$/.test(line)) {
      nameFound = line;
    }
  }
  if (!nameFound) {
    const explicitName = text.match(/(?:Name|Cardholder Name)[:\s]*([A-Za-z\s.]+)/i);
    if (explicitName) nameFound = explicitName[1].trim();
  }
  if (nameFound) {
    data.fullName = nameFound.replace(/[^A-Za-z\s.]/g, '').trim();
  }

  return data;
}

/**
 * Specialized parser for Bank Account Details and Cancelled Cheques.
 */
function parseBank(text) {
  const data = {};

  // 1. IFSC Code: 4 letters + 0 + 6 alphanumeric
  const ifscMatch = text.match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/i);
  if (ifscMatch) {
    data.ifscCode = ifscMatch[1].toUpperCase();
  }

  // 2. Account Number: 9 to 18 digits
  const accMatch = text.match(/(?:A\/C|Account|Acc|A\/c)[\s#.:]*(?:No|Number|Num)?[\s.:]*([0-9]{9,18})\b/i) ||
                   text.match(/\b([0-9]{11,18})\b/);
  if (accMatch) {
    data.accountNumber = accMatch[1];
  }

  // 3. Account Holder Name
  const nameMatch = text.match(/(?:Account Holder|Customer Name|Name|A\/c Name|A\/C Holder)[:\s]*([A-Za-z\s.]+)/i) ||
                    text.match(/(?:Pay to|Pay)[:\s]*([A-Za-z\s.]+)/i);
  if (nameMatch) {
    data.accountHolderName = nameMatch[1].split('\n')[0].replace(/[^A-Za-z\s.]/g, '').trim();
  }

  // 4. Bank Name detection
  const bankList = [
    'State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Punjab National Bank',
    'Bank of Baroda', 'Canara Bank', 'Union Bank of India', 'Kotak Mahindra Bank', 'IndusInd Bank',
    'Yes Bank', 'IDBI Bank', 'Federal Bank', 'Indian Bank', 'Central Bank of India', 'Bank of India'
  ];
  for (const b of bankList) {
    if (new RegExp(b.replace(/\s+/g, '\\s*'), 'i').test(text)) {
      data.bankName = b;
      break;
    }
  }
  if (!data.bankName && data.ifscCode) {
    // Basic prefix mapping fallback
    const pfx = data.ifscCode.slice(0, 4);
    const map = {
      'SBIN': 'State Bank of India',
      'HDFC': 'HDFC Bank',
      'ICIC': 'ICICI Bank',
      'UTIB': 'Axis Bank',
      'PUNB': 'Punjab National Bank',
      'BARB': 'Bank of Baroda',
      'CNRB': 'Canara Bank',
      'KKBK': 'Kotak Mahindra Bank',
      'UBIN': 'Union Bank of India',
    };
    if (map[pfx]) data.bankName = map[pfx];
  }

  // 5. Branch
  const branchMatch = text.match(/(?:Branch|Branch Name|Br\.)[:\s]*([A-Za-z0-9\s,.-]+)/i);
  if (branchMatch) {
    data.branch = branchMatch[1].split('\n')[0].trim();
  }

  // 6. MICR Code: 9 digits
  const micrMatch = text.match(/(?:MICR|MICR Code)[:\s]*([0-9]{9})\b/i);
  if (micrMatch) {
    data.micrCode = micrMatch[1];
  }

  return data;
}

/**
 * Specialized parser for Educational Certificates.
 */
function parseEducation(text) {
  const data = {};

  // 1. Candidate Name
  const nameMatch = text.match(/(?:certify that|candidate name|student name|name of candidate|named|certifies that)\s+(?:Mr\.|Ms\.|Mrs\.)?\s*([A-Za-z\s.]+?)(?:\s+(?:has|is|bearing|son|daughter|s\/o|d\/o|completed)|,|\n|$)/i);
  if (nameMatch) {
    data.candidateName = nameMatch[1].replace(/[^A-Za-z\s.]/g, '').trim();
  }

  // 2. Institution / University
  const instInText = text.match(/\b(?:from|at)\b\s+([A-Z][A-Za-z0-9\s,.-]+?(?:University|Institute of Technology|College of Engineering|College|School|Academy|Board of Education|Institute))/);
  if (instInText) {
    data.institution = instInText[1].trim();
  } else {
    const lines = text.split('\n').map(l => l.trim());
    for (const line of lines) {
      const instMatch = line.match(/([A-Za-z0-9\s,.-]+(?:University|Institute of Technology|College of Engineering|College|School|Academy|Board of Education)[A-Za-z0-9\s,.-]*)/i);
      if (instMatch) {
        data.institution = instMatch[1].replace(/^(?:from|at|in)\s+/i, '').trim();
        break;
      }
    }
  }

  // 3. Degree
  const degreeMatch = text.match(/\b(Bachelor of Technology|Bachelor of Engineering|Bachelor of Science|Bachelor of Commerce|Bachelor of Arts|Master of Technology|Master of Science|Master of Business Administration|B\.?Tech|B\.?E\.?|B\.?Sc\.?|B\.?Com\.?|B\.?A\.?|BCA|M\.?Tech|M\.?Sc\.?|MBA|MCA|Diploma|Higher Secondary|SSLC|HSC|CBSE|ICSE)\b/i);
  if (degreeMatch) {
    data.degree = degreeMatch[1].trim();
  }

  // 4. Course / Stream
  const courseMatch = text.match(/\b(Computer Science(?: and Engineering)?|Information Technology|Mechanical Engineering|Electrical Engineering|Civil Engineering|Electronics and Communication|Commerce|Business Administration|Artificial Intelligence|Data Science)\b/i);
  if (courseMatch) {
    data.course = courseMatch[1].trim();
  }

  // 5. Passing Year
  const yearMatch = text.match(/(?:Passing Year|Year of Passing|Passed in|Graduated in|Examination of|Session)[:\s]*([12][0-9]{3})/i) ||
                    text.match(/\b(20[12][0-9])\b/);
  if (yearMatch) {
    data.passingYear = yearMatch[1];
  }

  // 6. Registration / Roll Number
  const regMatch = text.match(/(?:Reg(?:istration)?(?:\s*No|\s*Number)?|Roll\s*No|Enrollment\s*No|Seat\s*No|Hall Ticket\s*No)[:\s]*([A-Z0-9\-\/]+)/i);
  if (regMatch) {
    data.registrationNumber = regMatch[1].trim();
  }

  return data;
}

/**
 * Specialized parser for Experience Letters.
 */
function parseExperience(text) {
  const data = {};

  // 1. Employee Name
  const nameMatch = text.match(/(?:certify that\s+(?:Mr\.|Ms\.|Mrs\.)?\s*|employee name[:\s]*)([A-Za-z\s.]+)/i) ||
                    text.match(/(?:This is to certify that\s+)([A-Za-z\s.]+)/i);
  if (nameMatch) {
    data.employeeName = nameMatch[1].split(/[\n,]/)[0].replace(/[^A-Za-z\s.]/g, '').trim();
  }

  // 2. Company Name
  const compMatch = text.match(/(?:with|at)\s+([A-Za-z0-9\s.,]+(?:Pvt\.?\s*Ltd\.?|Private\s*Limited|LLP|Inc\.?|Corporation|Solutions|Technologies|Software|Services))/i);
  if (compMatch) {
    data.companyName = compMatch[1].trim();
  } else {
    // Check first 3 lines
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 0 && lines[0].length < 60) {
      data.companyName = lines[0];
    }
  }

  // 3. Designation
  const desigMatch = text.match(/(?:Designation|Role|Position|worked as|employed as)[:\s]*([A-Za-z\s\-/]+)/i);
  if (desigMatch) {
    data.designation = desigMatch[1].split(/[\n,]/)[0].trim();
  }

  // 4. Employment Period
  const periodMatch = text.match(/(?:Duration|Period|Tenure|From)[:\s]*([A-Za-z0-9\s,.-]+(?:to|until|-)[A-Za-z0-9\s,.-]+)/i) ||
                      text.match(/([0-9]{2}\/[0-9]{2}\/[0-9]{4}\s*(?:to|-)\s*[0-9]{2}\/[0-9]{2}\/[0-9]{4})/i);
  if (periodMatch) {
    data.employmentPeriod = periodMatch[1].trim();
  }

  return data;
}

/**
 * Specialized parser for Address Proof.
 */
function parseAddressProof(text) {
  const data = {};

  // 1. Full Name
  const nameMatch = text.match(/(?:Name|Customer Name|Consumer Name|Tenant Name|Subscriber)[:\s]*([A-Za-z\s.]+)/i);
  if (nameMatch) {
    data.fullName = nameMatch[1].split('\n')[0].replace(/[^A-Za-z\s.]/g, '').trim();
  }

  // 2. Address
  const addrMatch = text.match(/(?:Address|Premises|Billing Address)[:\s]+([\s\S]{10,250}?(?:[1-9][0-9]{5}))/i);
  if (addrMatch) {
    data.address = addrMatch[1].replace(/\n+/g, ', ').replace(/\s+/g, ' ').trim();
  } else {
    const pinMatch = text.match(/\b([1-9][0-9]{5})\b/);
    if (pinMatch) {
      data.pincode = pinMatch[1];
    }
  }

  // 3. Document Type detection
  if (/Electricity|BESCOM|TNEB|MSEDCL|Power|Electric/i.test(text)) data.documentType = 'Electricity Bill';
  else if (/Rental Agreement|Lease Agreement|Rent/i.test(text)) data.documentType = 'Rental Agreement';
  else if (/Water Supply|Water Bill/i.test(text)) data.documentType = 'Water Bill';
  else if (/LPG|Gas|Indane|Bharatgas|HP Gas/i.test(text)) data.documentType = 'LPG Connection Bill';
  else if (/Election Commission|Voter/i.test(text)) data.documentType = 'Voter ID';
  else data.documentType = 'Address Proof';

  return data;
}

/**
 * Specialized parser for Offer Letter / Employment Agreement.
 */
function parseOfferLetter(text) {
  const data = {};
  const compMatch = text.match(/(?:at|with|join)\s+([A-Za-z0-9\s.,]+(?:Pvt\.?\s*Ltd\.?|Private\s*Limited|LLP|Inc\.?|Solutions|Technologies))/i);
  if (compMatch) data.companyName = compMatch[1].trim();

  const roleMatch = text.match(/(?:Designation|Role|Position)[:\s]*([A-Za-z\s\-/]+)/i);
  if (roleMatch) data.designation = roleMatch[1].split(/[\n,]/)[0].trim();

  const dateMatch = text.match(/(?:Date of Joining|Joining Date|Start Date)[:\s]*([0-9]{2}[/-][0-9]{2}[/-][0-9]{4}|[A-Za-z]+\s+[0-9]{1,2},?\s+[12][0-9]{3})/i);
  if (dateMatch) data.joiningDate = dateMatch[1].trim();

  return data;
}

/**
 * Main dispatcher: runs text extraction and parses structured document data.
 */
async function processDocument(fileBuffer, mimeType, category, originalName = '') {
  // 1. Passport-size Photo requires no OCR
  if (category === 'Passport-size Photo') {
    return {
      ocrStatus: 'SKIPPED',
      extractedData: null,
      rawText: '',
      method: 'skipped',
    };
  }

  try {
    const { text, method } = await extractTextFromBuffer(fileBuffer, mimeType, originalName);

    let structured = {};
    switch (category) {
      case 'Aadhaar Card': {
        structured = parseAadhaar(text);

        // Multi-region enhancement for image uploads if full-page OCR missed Aadhaar number or got noisy name
        const isPdf = mimeType === 'application/pdf' || originalName.toLowerCase().endsWith('.pdf');
        if (!isPdf && fileBuffer) {
          const dims = getImageDimensions(fileBuffer);
          if (dims && dims.width > 300 && dims.height > 300) {
            let worker = null;
            try {
              // 1. If Aadhaar number missing, scan bottom region
              if (!structured.aadhaarNumber) {
                worker = await Tesseract.createWorker('eng');
                const bottomRect = {
                  left: Math.round(dims.width * 0.15),
                  top: Math.round(dims.height * 0.69),
                  width: Math.round(dims.width * 0.75),
                  height: Math.round(dims.height * 0.26),
                };
                const bottomRes = await worker.recognize(fileBuffer, { rectangle: bottomRect });
                const bText = cleanText(bottomRes.data?.text || '');
                const numMatch = bText.match(/\b([2-9][0-9]{3}\s[0-9]{4}\s[0-9]{4})\b/) ||
                                 bText.match(/\b([2-9][0-9]{11})\b/);
                if (numMatch) {
                  const raw = numMatch[1].replace(/\s+/g, '');
                  structured.aadhaarNumber = `${raw.slice(0, 4)} ${raw.slice(4, 8)} ${raw.slice(8, 12)}`;
                }
              }

              // 2. Check if name is missing or appears noisy/garbled
              const isNoisyName = !structured.fullName ||
                                  structured.fullName.length < 3 ||
                                  /^[.\s\-_|]/.test(structured.fullName) ||
                                  /^[A-Z]\s+[A-Z]{2}\s+[a-z]+/.test(structured.fullName);

              if (isNoisyName) {
                if (!worker) worker = await Tesseract.createWorker('eng');
                const nameRect = {
                  left: Math.round(dims.width * 0.28),
                  top: Math.round(dims.height * 0.17),
                  width: Math.round(dims.width * 0.38),
                  height: Math.round(dims.height * 0.25),
                };
                const nameRes = await worker.recognize(fileBuffer, { rectangle: nameRect });
                const nText = cleanText(nameRes.data?.text || '');
                const nameLines = nText.split('\n').map(l => l.trim()).filter(Boolean);
                for (let i = 0; i < nameLines.length; i++) {
                  if (/(?:DOB|Birth|D\.O\.B|\/)/i.test(nameLines[i])) {
                    if (i > 0) {
                      const cand = cleanName(nameLines[i - 1]);
                      if (cand && cand.length >= 2) {
                        structured.fullName = cand;
                        break;
                      }
                    }
                  }
                }
                if (!structured.fullName) {
                  for (const line of nameLines) {
                    if (!/(?:DOB|Birth|Government|India|Authority)/i.test(line)) {
                      const cand = cleanName(line);
                      if (cand && cand.length >= 3 && /^[A-Za-z\s.]+$/.test(cand)) {
                        structured.fullName = cand;
                        break;
                      }
                    }
                  }
                }
              }
            } catch (regionErr) {
              console.warn('[documentIntelligence] Aadhaar region OCR fallback error:', regionErr.message);
            } finally {
              if (worker) {
                await worker.terminate();
              }
            }
          }
        }
        break;
      }
      case 'PAN Card': {
        structured = parsePAN(text);

        // Multi-region enhancement for image uploads if full-page OCR missed PAN number or name/dob
        const isPdf = mimeType === 'application/pdf' || originalName.toLowerCase().endsWith('.pdf');
        if (!isPdf && fileBuffer) {
          const dims = getImageDimensions(fileBuffer);
          if (dims && dims.width > 300 && dims.height > 300) {
            let worker = null;
            try {
              // 1. If PAN number missing, scan middle region (excluding right side QR code)
              if (!structured.panNumber) {
                worker = await Tesseract.createWorker('eng');
                const panRect = {
                  left: Math.round(dims.width * 0.20),
                  top: Math.round(dims.height * 0.35),
                  width: Math.round(dims.width * 0.40),
                  height: Math.round(dims.height * 0.15),
                };
                const panRes = await worker.recognize(fileBuffer, { rectangle: panRect });
                const pText = (panRes.data?.text || '').replace(/\s+/g, '');
                const m = pText.match(/([A-Z]{5}[0-9]{4}[A-Z])/i);
                if (m) structured.panNumber = m[1].toUpperCase();
              }

              // 2. If Name missing or noisy
              if (!structured.fullName || structured.fullName.length < 3) {
                if (!worker) worker = await Tesseract.createWorker('eng');
                const nameRect = {
                  left: Math.round(dims.width * 0.04),
                  top: Math.round(dims.height * 0.50),
                  width: Math.round(dims.width * 0.25),
                  height: Math.round(dims.height * 0.15),
                };
                const nameRes = await worker.recognize(fileBuffer, { rectangle: nameRect });
                const nLines = (nameRes.data?.text || '').split('\n').map((l) => cleanName(l)).filter((l) => l.length >= 3);
                for (const cand of nLines) {
                  if (!/Name|Permanent|Account|Income|Tax|Father/i.test(cand)) {
                    structured.fullName = cand;
                    break;
                  }
                }
              }

              // 3. If DOB missing
              if (!structured.dob) {
                if (!worker) worker = await Tesseract.createWorker('eng');
                const dobRect = {
                  left: Math.round(dims.width * 0.04),
                  top: Math.round(dims.height * 0.83),
                  width: Math.round(dims.width * 0.22),
                  height: Math.round(dims.height * 0.14),
                };
                const dobRes = await worker.recognize(fileBuffer, { rectangle: dobRect });
                const dobM = (dobRes.data?.text || '').match(/\b([0-9]{2}\/[0-9]{2}\/[0-9]{4})\b/);
                if (dobM) structured.dob = dobM[1];
              }
            } catch (pErr) {
              console.warn('[documentIntelligence] PAN region OCR fallback error:', pErr.message);
            } finally {
              if (worker) await worker.terminate();
            }
          }
        }
        break;
      }
      case 'Bank Account Details':
      case 'Cancelled Cheque':
        structured = parseBank(text);
        break;
      case 'Educational Certificates':
        structured = parseEducation(text);
        break;
      case 'Experience Certificate':
        structured = parseExperience(text);
        break;
      case 'Address Proof':
        structured = parseAddressProof(text);
        break;
      case 'Offer Letter':
        structured = parseOfferLetter(text);
        break;
      default:
        structured = {};
        break;
    }

    return {
      ocrStatus: 'COMPLETED',
      extractedData: structured,
      rawText: text ? text.slice(0, 5000) : '',
      method,
    };
  } catch (err) {
    console.error(`[documentIntelligence] Extraction failed for category "${category}":`, err.message);
    return {
      ocrStatus: 'FAILED',
      extractedData: {},
      rawText: '',
      method: 'error',
      error: err.message,
    };
  }
}

module.exports = {
  extractTextFromBuffer,
  processDocument,
  getImageDimensions,
  parseAadhaar,
  parsePAN,
  parseBank,
  parseEducation,
  parseExperience,
  parseAddressProof,
  parseOfferLetter,
};
