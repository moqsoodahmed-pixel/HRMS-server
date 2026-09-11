"use strict";
/**
 * install-python-deps.js
 * Ensures reportlab and pillow are installed before the server starts.
 * On Railway, Python is pre-installed via nixpacks.toml aptPkgs.
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

function checkPackages(python) {
  try {
    execFileSync(python, ["-c", "import reportlab, PIL"], { stdio: "pipe" });
    return true;
  } catch (_) {
    return false;
  }
}

function installPackages(python) {
  const packages = ["reportlab", "pillow"];
  console.log(`[startup] Installing Python packages: ${packages.join(", ")} ...`);

  const attempts = [
    [python, ["-m", "pip", "install", "--break-system-packages", "--quiet", ...packages]],
    [python, ["-m", "pip", "install", "--quiet", ...packages]],
    ["pip3", ["install", "--break-system-packages", "--quiet", ...packages]],
    ["pip3", ["install", "--quiet", ...packages]],
    ["pip", ["install", "--quiet", ...packages]],
  ];

  for (const [cmd, args] of attempts) {
    try {
      execFileSync(cmd, args, { stdio: "inherit" });
      console.log("[startup] ✅ Python packages installed successfully.");
      return true;
    } catch (_) {}
  }
  return false;
}

const python = findPython();
if (!python) {
  console.warn("[startup] ⚠️  Python 3 not found — PDF appointment letter generation will be unavailable.");
} else {
  console.log(`[startup] ✅ Python found: ${python}`);
  if (!checkPackages(python)) {
    const ok = installPackages(python);
    if (!ok) {
      console.warn("[startup] ⚠️  Could not install Python packages. PDF generation may fail.");
    }
  } else {
    console.log("[startup] ✅ Python packages (reportlab, pillow) already installed.");
  }
}