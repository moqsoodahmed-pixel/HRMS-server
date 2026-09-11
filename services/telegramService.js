"use strict";

/**
 * telegramService.js
 * ─────────────────
 * Sends Telegram messages via the Bot API (no extra library needed — pure HTTPS).
 *
 * How it works
 * ────────────
 * 1. You create a Telegram Bot via @BotFather → get a BOT_TOKEN.
 * 2. The Founder/CEO starts a chat with the bot (or adds it to a group/channel).
 * 3. The chat_id is stored in OrgSettings (telegram.notifyChatId).
 * 4. Every time an employee clocks in, this service fires a message to that chat.
 *
 * Environment variables (add to .env)
 * ─────────────────────────────────────
 *   TELEGRAM_BOT_TOKEN=<your-bot-token-from-BotFather>
 *
 * OrgSettings fields (stored in DB, editable via Settings page)
 * ──────────────────────────────────────────────────────────────
 *   telegram.botToken      – overrides env var (optional, lets admin set from UI)
 *   telegram.notifyChatId  – the Founder/CEO's Telegram chat ID (required)
 *   telegram.enabled       – boolean, master on/off switch
 */

const https = require("https");
const { OrgSettings } = require("../models/OrgSettings");

/**
 * Resolves the active Telegram config.
 * DB values take precedence over env vars so the admin can change them without
 * redeploying.
 */
async function getTelegramConfig() {
  const settings = await OrgSettings.findOne({ singletonKey: "default" })
    .select("telegram")
    .lean();

  const cfg = settings?.telegram || {};

  return {
    botToken: cfg.botToken || process.env.TELEGRAM_BOT_TOKEN || "",
    chatId:   cfg.notifyChatId || process.env.TELEGRAM_CHAT_ID || "",
    enabled:  cfg.enabled !== false, // default true if not explicitly false
  };
}

/**
 * Sends a plain-text (Markdown v2) message to the configured chat.
 * Errors are caught and logged but never bubble up — a Telegram failure
 * should never break a check-in response.
 *
 * @param {string} text  – The message text (Markdown supported)
 */
async function sendMessage(text) {
  try {
    const { botToken, chatId, enabled } = await getTelegramConfig();

    if (!enabled) return;
    if (!botToken || !chatId) {
      console.warn(
        "[TelegramService] Bot token or chat ID not configured — skipping notification."
      );
      return;
    }

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
            const parsed = JSON.parse(body);
            if (!parsed.ok) {
              console.error(
                `[TelegramService] API error: ${parsed.description}`
              );
            }
            resolve();
          });
        }
      );
      req.on("error", reject);
      req.write(payload);
      req.end();
    });
  } catch (err) {
    // Never let Telegram errors crash the main request
    console.error("[TelegramService] Failed to send message:", err.message);
  }
}

/**
 * Formats and sends a Clock-In notification to the Founder/CEO.
 *
 * @param {object} employee  – Mongoose Employee document
 * @param {Date}   checkInTime
 * @param {boolean} isLate
 * @param {number}  lateMinutes
 */
async function notifyClockIn(employee, checkInTime, isLate, lateMinutes) {
  const timeStr = checkInTime.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: process.env.TZ || "Asia/Kolkata",
  });

  const dateStr = checkInTime.toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
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

/**
 * Formats and sends a Clock-Out notification to the Founder/CEO.
 *
 * @param {object} employee
 * @param {Date}   checkOutTime
 * @param {number} workHours
 * @param {boolean} isEarlyExit
 * @param {number}  earlyExitMinutes
 */
async function notifyClockOut(
  employee,
  checkOutTime,
  workHours,
  isEarlyExit,
  earlyExitMinutes
) {
  const timeStr = checkOutTime.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: process.env.TZ || "Asia/Kolkata",
  });

  const dateStr = checkOutTime.toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: process.env.TZ || "Asia/Kolkata",
  });

  const statusEmoji = isEarlyExit ? "🟡" : "✅";
  const statusLabel = isEarlyExit
    ? `Early exit by ${earlyExitMinutes} min`
    : "Full Day";

  const hoursLabel =
    workHours != null ? `${workHours.toFixed(2)} hrs` : "N/A";

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

module.exports = { notifyClockIn, notifyClockOut, sendMessage };