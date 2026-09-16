"use strict";

/**
 * telegramService.js
 * ─────────────────
 * Sends Telegram messages via the Bot API (no extra library needed — pure HTTPS).
 *
 * OrgSettings fields (stored in DB, editable via Settings page)
 * ──────────────────────────────────────────────────────────────
 *   telegram.botToken      – overrides env var (optional)
 *   telegram.notifyChatId  – the Founder/CEO's Telegram chat ID (required)
 *   telegram.enabled       – boolean, master on/off switch
 *
 * Environment variables (.env fallback)
 * ─────────────────────────────────────
 *   TELEGRAM_BOT_TOKEN=<your-bot-token-from-BotFather>
 *   TELEGRAM_CHAT_ID=<your-chat-id>
 */

const https = require("https");
const { OrgSettings } = require("../models/OrgSettings");

/**
 * Resolves the active Telegram config.
 * NOTE: botToken has `select: false` in OrgSettings schema, so we must
 * explicitly select it with +botToken.
 */
async function getTelegramConfig() {
  const settings = await OrgSettings.findOne({ singletonKey: "default" })
    .select("+telegram.botToken telegram.notifyChatId telegram.enabled")
    .lean();

  const cfg = settings?.telegram || {};

  return {
    botToken: cfg.botToken || process.env.TELEGRAM_BOT_TOKEN || "",
    chatId:   cfg.notifyChatId || process.env.TELEGRAM_CHAT_ID || "",
    enabled:  cfg.enabled !== false,
  };
}

/**
 * Core send function — sends an HTML-formatted message to the configured chat.
 * Errors are caught and logged but never bubble up.
 */
async function sendMessage(text) {
  try {
    const { botToken, chatId, enabled } = await getTelegramConfig();

    if (!enabled) {
      console.log("[TelegramService] Notifications disabled — skipping.");
      return;
    }
    if (!botToken || !chatId) {
      console.warn(
        `[TelegramService] Missing config — botToken: ${botToken ? "SET" : "MISSING"}, chatId: ${chatId ? "SET (" + chatId + ")" : "MISSING"} — skipping.`
      );
      return;
    }

    console.log(`[TelegramService] Sending message to chatId: ${chatId}`);

    const payload = JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    });

    await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "api.telegram.org",
          path: `/bot${botToken}/sendMessage`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            try {
              const parsed = JSON.parse(body);
              if (!parsed.ok) {
                console.error(`[TelegramService] API error: ${parsed.description}`);
              } else {
                console.log("[TelegramService] Message sent successfully.");
              }
            } catch (e) {
              console.error("[TelegramService] Failed to parse response:", e.message);
            }
            resolve();
          });
        }
      );
      req.on("error", (err) => {
        console.error("[TelegramService] Request error:", err.message);
        resolve(); // resolve so we don't crash the caller
      });
      req.write(payload);
      req.end();
    });
  } catch (err) {
    console.error("[TelegramService] Failed to send message:", err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification helpers
// ─────────────────────────────────────────────────────────────────────────────

async function notifyClockIn(employee, checkInTime, isLate, lateMinutes) {
  const timeStr = checkInTime.toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: true, timeZone: process.env.TZ || "Asia/Kolkata",
  });
  const dateStr = checkInTime.toLocaleDateString("en-IN", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: process.env.TZ || "Asia/Kolkata",
  });

  const statusEmoji = isLate ? "🔴" : "🟢";
  const statusLabel = isLate ? `Late by ${lateMinutes} min` : "On Time";

  const message =
    `${statusEmoji} <b>Employee Clock-In Alert</b>\n\n` +
    `👤 <b>Name:</b> ${employee.fullName}\n` +
    `🪪 <b>Employee Code:</b> ${employee.employeeCode}\n` +
    `🏢 <b>Department:</b> ${employee.department}\n` +
    `💼 <b>Designation:</b> ${employee.designation}\n` +
    `📅 <b>Date:</b> ${dateStr}\n` +
    `🕐 <b>Clock-In Time:</b> ${timeStr}\n` +
    `📊 <b>Status:</b> ${statusLabel}\n`;

  await sendMessage(message);
}

async function notifyClockOut(employee, checkOutTime, workHours, isEarlyExit, earlyExitMinutes) {
  const timeStr = checkOutTime.toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: true, timeZone: process.env.TZ || "Asia/Kolkata",
  });
  const dateStr = checkOutTime.toLocaleDateString("en-IN", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: process.env.TZ || "Asia/Kolkata",
  });

  const statusEmoji = isEarlyExit ? "🟡" : "✅";
  const statusLabel = isEarlyExit ? `Early exit by ${earlyExitMinutes} min` : "Full Day";
  const hoursLabel = workHours != null ? `${workHours.toFixed(2)} hrs` : "N/A";

  const message =
    `${statusEmoji} <b>Employee Clock-Out Alert</b>\n\n` +
    `👤 <b>Name:</b> ${employee.fullName}\n` +
    `🪪 <b>Employee Code:</b> ${employee.employeeCode}\n` +
    `🏢 <b>Department:</b> ${employee.department}\n` +
    `💼 <b>Designation:</b> ${employee.designation}\n` +
    `📅 <b>Date:</b> ${dateStr}\n` +
    `🕐 <b>Clock-Out Time:</b> ${timeStr}\n` +
    `⏱️ <b>Total Work Hours:</b> ${hoursLabel}\n` +
    `📊 <b>Status:</b> ${statusLabel}\n`;

  await sendMessage(message);
}

/**
 * Sends a Daily Report Submitted notification.
 *
 * @param {object} employee  – { fullName, employeeCode, department, designation }
 * @param {object} report    – DailyReport document
 */
async function notifyDailyReportSubmitted(employee, report) {
  const submittedAt = new Date(report.submittedAt || Date.now()).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: true, timeZone: process.env.TZ || "Asia/Kolkata",
  });

  const reportDate = new Date(report.date).toLocaleDateString("en-IN", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: process.env.TZ || "Asia/Kolkata",
  });

  const truncate = (text, maxLen = 300) => {
    if (!text) return "—";
    return text.length > maxLen ? text.substring(0, maxLen) + "..." : text;
  };

  const hoursLabel = report.hoursWorked != null ? `${report.hoursWorked} hrs` : "—";

  let message =
    `📋 <b>Daily Report Submitted</b>\n\n` +
    `👤 <b>Name:</b> ${employee.fullName}\n` +
    `🪪 <b>Employee Code:</b> ${employee.employeeCode}\n` +
    `🏢 <b>Department:</b> ${employee.department}\n` +
    `💼 <b>Designation:</b> ${employee.designation}\n` +
    `📅 <b>Report Date:</b> ${reportDate}\n` +
    `🕐 <b>Submitted At:</b> ${submittedAt}\n` +
    `⏱️ <b>Hours Worked:</b> ${hoursLabel}\n\n` +
    `📝 <b>Work Summary:</b>\n${truncate(report.workSummary)}\n\n` +
    `✅ <b>Tasks Completed:</b>\n${truncate(report.tasksCompleted)}\n\n` +
    `🔄 <b>Tasks In Progress:</b>\n${truncate(report.tasksInProgress)}\n\n` +
    `🚧 <b>Blockers:</b>\n${truncate(report.blockers)}\n\n` +
    `📌 <b>Next Day Plan:</b>\n${truncate(report.nextDayPlan)}\n`;

  if (report.additionalNotes) {
    message += `\n🗒️ <b>Additional Notes:</b>\n${truncate(report.additionalNotes)}\n`;
  }

  await sendMessage(message);
}

module.exports = { notifyClockIn, notifyClockOut, notifyDailyReportSubmitted, sendMessage };