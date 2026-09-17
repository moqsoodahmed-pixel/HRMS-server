"use strict";

/**
 * telegramService.js
 * ─────────────────
 * Two separate bots/chats:
 *
 * 1. Clock-In / Clock-Out bot  →  TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 *    (also readable from OrgSettings.telegram.botToken / notifyChatId)
 *
 * 2. Daily Report bot          →  TELEGRAM_DAILY_REPORT_BOT_TOKEN + TELEGRAM_DAILY_REPORT_CHAT_ID
 *    (dedicated bot & group, completely separate from clock-in/out)
 */

const https = require("https");
const { OrgSettings } = require("../models/OrgSettings");

// ─── Config resolvers ─────────────────────────────────────────────────────────

/**
 * Config for Clock-In / Clock-Out bot (existing bot, from OrgSettings or env)
 */
async function getAttendanceConfig() {
  const settings = await OrgSettings.findOne({ singletonKey: "default" })
    .select("+telegram.botToken telegram.notifyChatId telegram.enabled")
    .lean();

  const cfg = settings?.telegram || {};

  const botToken = cfg.botToken || process.env.TELEGRAM_BOT_TOKEN || "";
  const chatId   = cfg.notifyChatId || process.env.TELEGRAM_CHAT_ID || "";

  // Notifications are ON whenever we have working credentials, UNLESS an admin
  // has EXPLICITLY turned them off in Settings.
  //
  // We can only treat OrgSettings.telegram.enabled as an explicit "off" when
  // Telegram was actually configured through the UI (a bot token or chat id was
  // saved there). Otherwise a brand-new OrgSettings document — which the app
  // auto-creates with `enabled: false` by schema default — would silently
  // suppress the env-configured clock-in/out notifications. That default-false
  // flag was the bug: env creds were correct but never used.
  const configuredInUi = Boolean(cfg.botToken || cfg.notifyChatId);
  const enabled = configuredInUi
    ? cfg.enabled === true          // UI-configured: honor the explicit toggle
    : Boolean(botToken && chatId);  // env-configured: on as long as creds exist

  if (!enabled) {
    console.warn(
      "[TelegramService] Clock-in/out notifications are OFF — " +
      (configuredInUi
        ? "Telegram was configured via Settings UI but is toggled disabled there."
        : `missing credentials (botToken: ${botToken ? "SET" : "MISSING"}, chatId: ${chatId ? "SET" : "MISSING"}).`)
    );
  } else if (PLACEHOLDER_CHAT_IDS.has(chatId)) {
    console.error(
      `[TelegramService] Clock-in/out chat id "${chatId}" looks like a placeholder value, not a real Telegram chat id.`
    );
  }

  return { botToken, chatId, enabled };
}

// Telegram's own docs use this exact chat id as their generic example — anyone
// who copy-pasted a sample .env instead of running get-telegram-chat-id.js
// ends up with this literal value. It is never a real chat id.
const PLACEHOLDER_CHAT_IDS = new Set(["-1001234567890", "1234567890"]);

/**
 * Config for Daily Report bot (OrgSettings UI first, env as fallback)
 */
async function getDailyReportConfig() {
  const settings = await OrgSettings.findOne({ singletonKey: "default" })
    .select("+dailyReportTelegram.botToken dailyReportTelegram.notifyChatId dailyReportTelegram.enabled")
    .lean();

  const cfg = settings?.dailyReportTelegram || {};

  const botToken = cfg.botToken || process.env.TELEGRAM_DAILY_REPORT_BOT_TOKEN || "";
  const chatId   = cfg.notifyChatId || process.env.TELEGRAM_DAILY_REPORT_CHAT_ID || "";

  const configuredInUi = Boolean(cfg.botToken || cfg.notifyChatId);
  const enabled = configuredInUi
    ? cfg.enabled === true
    : Boolean(botToken && chatId);

  if (!botToken || !chatId) {
    console.warn(
      "[TelegramService] Daily Report bot is not configured — " +
      `botToken: ${botToken ? "SET" : "MISSING"}, chatId: ${chatId ? "SET" : "MISSING"}. ` +
      "Daily report notifications will not be sent."
    );
    return { botToken, chatId, enabled: false };
  }

  if (!enabled) {
    console.warn("[TelegramService] Daily Report notifications are OFF — toggled disabled in Settings.");
    return { botToken, chatId, enabled: false };
  }

  if (PLACEHOLDER_CHAT_IDS.has(chatId)) {
    console.error(
      `[TelegramService] Daily Report chat id "${chatId}" is still set to the placeholder value. ` +
      "This is a sample id from Telegram's docs, not a real group/channel id — messages will silently fail " +
      "with 'chat not found'. Run `node scripts/get-telegram-chat-id.js daily` after adding the daily-report " +
      "bot to your group and posting a message there, then set the real id (env var or Settings UI)."
    );
    return { botToken, chatId, enabled: false };
  }

  return { botToken, chatId, enabled: true };
}

// ─── Core sender ──────────────────────────────────────────────────────────────

/**
 * Sends an HTML-formatted message using the given bot token and chat ID.
 * Errors are caught and logged — never bubble up to crash the caller.
 */
async function sendTelegramMessage(botToken, chatId, text) {
  try {
    if (!botToken || !chatId) {
      const reason = `Missing config — botToken: ${botToken ? "SET" : "MISSING"}, chatId: ${chatId ? "SET (" + chatId + ")" : "MISSING"}`;
      console.warn(`[TelegramService] ${reason} — skipping.`);
      return { ok: false, description: reason };
    }

    console.log(`[TelegramService] Sending message to chatId: ${chatId}`);

    const payload = JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    });

    return await new Promise((resolve) => {
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
                const migratedId = parsed.parameters?.migrate_to_chat_id;
                const description = migratedId
                  ? `${parsed.description} — Telegram says the new chat id is: ${migratedId}. Update your Chat ID setting to this value.`
                  : parsed.description;
                resolve({ ok: false, description, migratedChatId: migratedId });
              } else {
                console.log("[TelegramService] Message sent successfully.");
                resolve({ ok: true, result: parsed.result });
              }
            } catch (e) {
              console.error("[TelegramService] Failed to parse response:", e.message);
              resolve({ ok: false, description: `Failed to parse Telegram response: ${e.message}` });
            }
          });
        }
      );
      req.on("error", (err) => {
        console.error("[TelegramService] Request error:", err.message);
        resolve({ ok: false, description: err.message });
      });
      req.write(payload);
      req.end();
    });
  } catch (err) {
    console.error("[TelegramService] Failed to send message:", err.message);
    return { ok: false, description: err.message };
  }
}

// ─── Legacy wrapper (used by sendMessage callers if any) ─────────────────────
async function sendMessage(text) {
  const { botToken, chatId, enabled } = await getAttendanceConfig();
  if (!enabled) {
    console.log("[TelegramService] Attendance notifications disabled.");
    return { ok: false, description: "Attendance Telegram bot is disabled or not configured — check server logs for the specific reason." };
  }
  return await sendTelegramMessage(botToken, chatId, text);
}

// ─── Test helper for the Daily Report bot ─────────────────────────────────────
/**
 * Sends a real test message through the dedicated Daily Report bot/chat.
 * Returns { ok, description? } so a controller/route can report true
 * success or failure back to the caller instead of assuming it worked.
 */
async function testDailyReportBot() {
  const { botToken, chatId, enabled } = await getDailyReportConfig();
  if (!enabled) {
    return {
      ok: false,
      description: !botToken || !chatId
        ? "Daily Report bot is not configured (missing TELEGRAM_DAILY_REPORT_BOT_TOKEN or TELEGRAM_DAILY_REPORT_CHAT_ID)."
        : `TELEGRAM_DAILY_REPORT_CHAT_ID "${chatId}" is a placeholder value, not a real chat id.`,
    };
  }
  return await sendTelegramMessage(
    botToken,
    chatId,
    "✅ <b>Daily Report Telegram integration is working!</b>\n\nYour HRMS will now send daily report submissions to this chat."
  );
}

// ─── Clock-In notification ────────────────────────────────────────────────────
async function notifyClockIn(employee, checkInTime, isLate, lateMinutes) {
  const { botToken, chatId, enabled } = await getAttendanceConfig();
  if (!enabled) return;

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

  await sendTelegramMessage(botToken, chatId, message);
}

// ─── Clock-Out notification ───────────────────────────────────────────────────
async function notifyClockOut(employee, checkOutTime, workHours, isEarlyExit, earlyExitMinutes) {
  const { botToken, chatId, enabled } = await getAttendanceConfig();
  if (!enabled) return;

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

  await sendTelegramMessage(botToken, chatId, message);
}

// ─── Daily Report notification (separate bot & group) ────────────────────────
async function notifyDailyReportSubmitted(employee, report) {
  // Uses the DEDICATED daily report bot — completely separate from clock-in/out
  const { botToken, chatId, enabled } = await getDailyReportConfig();

  if (!enabled) {
    console.warn("[TelegramService] Daily Report notification skipped — bot disabled/misconfigured (see warning above).");
    return;
  }

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

  console.log(`[TelegramService] Sending Daily Report notification via dedicated bot to group: ${chatId}`);
  await sendTelegramMessage(botToken, chatId, message);
}

module.exports = { notifyClockIn, notifyClockOut, notifyDailyReportSubmitted, sendMessage, testDailyReportBot };