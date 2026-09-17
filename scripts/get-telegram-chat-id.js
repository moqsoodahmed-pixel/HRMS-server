"use strict";
/**
 * get-telegram-chat-id.js
 * ────────────────────────
 * Finds the chat id for either Telegram bot used by this app, so you can
 * paste a REAL id into your env vars instead of a placeholder.
 *
 * Usage:
 *   node scripts/get-telegram-chat-id.js            # attendance (clock-in/out) bot
 *   node scripts/get-telegram-chat-id.js daily       # daily-report bot
 *
 * Steps:
 *   1. Add the relevant bot to the target Telegram group (or DM it directly).
 *   2. Send ANY message in that group/DM.
 *   3. Run this script within a few minutes — Telegram only keeps unread
 *      updates for a short window.
 */

require("dotenv/config");
const https = require("https");

const which = (process.argv[2] || "attendance").toLowerCase();

let BOT_TOKEN;
let envVarName;
if (which === "daily" || which === "daily-report" || which === "report") {
  BOT_TOKEN = process.env.TELEGRAM_DAILY_REPORT_BOT_TOKEN;
  envVarName = "TELEGRAM_DAILY_REPORT_CHAT_ID";
} else {
  BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  envVarName = "TELEGRAM_CHAT_ID";
}

if (!BOT_TOKEN) {
  console.error(
    `❌ No bot token found in env for "${which}". ` +
    `Set ${which === "attendance" ? "TELEGRAM_BOT_TOKEN" : "TELEGRAM_DAILY_REPORT_BOT_TOKEN"} first.`
  );
  process.exit(1);
}

function get(path) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.telegram.org/bot${BOT_TOKEN}${path}`, (res) => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

async function main() {
  console.log(`\n🔍 Checking bot identity for "${which}" bot...\n`);
  const me = await get("/getMe");
  if (!me.ok) {
    console.error("❌ Bot token is invalid or revoked:", me.description);
    console.log("   Get a fresh token from @BotFather and update your env vars.\n");
    return;
  }
  console.log(`✅ Bot is valid: @${me.result.username} (${me.result.first_name})\n`);

  console.log("🔍 Fetching recent updates...\n");
  let data = await get("/getUpdates?limit=100&allowed_updates=[\"message\",\"channel_post\",\"my_chat_member\"]");

  if (!data.ok) {
    console.error("❌ Error:", data.description);
    console.log("\nTrying to clear webhook first...");
    await get("/deleteWebhook?drop_pending_updates=false");
    data = await get("/getUpdates?limit=100");
  }

  processUpdates(data, envVarName);
}

function processUpdates(data, envVarName) {
  if (!data.result || data.result.length === 0) {
    console.log("❌ No messages found.\n");
    console.log("👉 Add the bot to your group (or message it directly), send any message, then re-run this script.\n");
    return;
  }

  const chats = new Map();
  for (const update of data.result) {
    const msg = update.message || update.channel_post || update.my_chat_member;
    if (msg?.chat) chats.set(msg.chat.id, msg.chat);
  }

  if (chats.size === 0) {
    console.log("❌ No chats found in recent updates.\n");
    return;
  }

  console.log("✅ Found these chats:\n");
  for (const [id, chat] of chats) {
    console.log(`  Chat ID  : ${id}`);
    console.log(`  Title    : ${chat.title || chat.username || "private"}`);
    console.log(`  Type     : ${chat.type}`);
    console.log("");
  }

  console.log(`👉 Copy the correct Chat ID above and set it in your deployment (e.g. Render env vars) as:`);
  console.log(`   ${envVarName}=<the number above>\n`);
}

main().catch((err) => {
  console.error("❌ Unexpected error:", err.message);
  process.exit(1);
});