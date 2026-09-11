"use strict";
/**
 * install-python-deps.js
 * ──────────────────────
 * Ensures reportlab and pillow are installed before the server starts.
 * Called automatically via the "start" script in package.json.
 * Safe to run multiple times — pip skips already-installed packages.
 */

const { execFileSync } = require("child_process");

const PYTHON_CANDIDATES = [
  "python3",
  "/usr/bin/python3",
  "/usr/local/bin/python3",
  "/opt/homebrew/bin/python3",
  "/Library/Developer/CommandLineTools/usr/bin/python3",
  "python",
];

function findPython() {
  for (const cmd of PYTHON_CANDIDATES) {
    try {
      execFileSync(cmd, ["--version"], { stdio: "pipe" });
      return cmd;
    } catch (_) {}
  }
  return null;
}

function installPackages(python) {
  const packages = ["reportlab", "pillow"];
  console.log(`[startup] Installing Python packages: ${packages.join(", ")} ...`);

  // Try --break-system-packages first (required on Render/Ubuntu 24+)
  try {
    execFileSync(
      python,
      ["-m", "pip", "install", "--break-system-packages", "--quiet", ...packages],
      { stdio: "inherit" }
    );
    console.log("[startup] ✅ Python packages installed (--break-system-packages).");
    return;
  } catch (_) {}

  // Fallback without flag (macOS / older Linux)
  try {
    execFileSync(
      python,
      ["-m", "pip", "install", "--quiet", ...packages],
      { stdio: "inherit" }
    );
    console.log("[startup] ✅ Python packages installed.");
    return;
  } catch (_) {}

  // Try pip3 directly
  try {
    execFileSync("pip3", ["install", "--quiet", ...packages], { stdio: "inherit" });
    console.log("[startup] ✅ Python packages installed via pip3.");
    return;
  } catch (_) {}

  console.warn("[startup] ⚠️  Could not install Python packages automatically. PDF generation may fail.");
}

function checkPackages(python) {
  try {
    execFileSync(python, ["-c", "import reportlab, PIL"], { stdio: "pipe" });
    return true;
  } catch (_) {
    return false;
  }
}

const python = findPython();
if (!python) {
  console.warn("[startup] ⚠️  Python 3 not found — PDF appointment letter generation will be unavailable.");
} else {
  if (!checkPackages(python)) {
    installPackages(python);
  } else {
    console.log("[startup] ✅ Python packages (reportlab, pillow) already installed.");
  }
}