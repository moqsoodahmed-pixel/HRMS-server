"use strict";
/**
 * check-telegram-config.js
 * ─────────────────────────
 * Run this on the SAME machine/environment that actually runs your server
 * (e.g. run it as a one-off command on Render, not just locally) — env vars
 * differ between local .env and your deployment's dashboard settings.
 *
 * Usage: node scripts/check-telegram-config.js
 *
 * For each bot it:
 *   1. Confirms the token is valid (getMe)
 *   2. Confirms the chat id isn't an obvious placeholder
 *   3. Sends a real test message to the configured chat, so you know for
 *      certain whether it will show up in Telegram.
 */

require("dotenv/config");
const https = require("https");

const PLACEHOLDER_CHAT_IDS = new Set(["-1001234567890", "1234567890"]);

function get(botToken, path) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.telegram.org/bot${botToken}${path}`, (res) => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

function post(botToken, path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${botToken}${path}`,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      },
      (res) => {
        let body = "";
        res.on("data", d => body += d);
        res.on("end", () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function checkBot(label, botToken, chatId) {
  console.log(`\n──────── ${label} ────────`);

  if (!botToken || !chatId) {
    console.log(`❌ Not configured — botToken: ${botToken ? "SET" : "MISSING"}, chatId: ${chatId ? "SET" : "MISSING"}`);
    return;
  }

  if (PLACEHOLDER_CHAT_IDS.has(String(chatId))) {
    console.log(`❌ chatId "${chatId}" is a placeholder value, not a real chat id.`);
    console.log(`   Fix: add the bot to your target group, send a message, then run:`);
    console.log(`   node scripts/get-telegram-chat-id.js ${label.toLowerCase().includes("daily") ? "daily" : "attendance"}`);
    return;
  }

  const me = await get(botToken, "/getMe");
  if (!me.ok) {
    console.log(`❌ Token invalid: ${me.description}`);
    return;
  }
  console.log(`✅ Token valid — bot is @${me.result.username}`);

  const chat = await get(botToken, `/getChat?chat_id=${encodeURIComponent(chatId)}`);
  if (!chat.ok) {
    console.log(`❌ Bot cannot see chat "${chatId}": ${chat.description}`);
    console.log(`   Most likely cause: the bot was never added to that group, or was removed/kicked.`);
    return;
  }
  console.log(`✅ Bot can see chat: "${chat.result.title || chat.result.username}" (${chat.result.type})`);

  const sent = await post(botToken, "/sendMessage", {
    chat_id: chatId,
    text: `✅ Test message from check-telegram-config.js for ${label} — if you can see this in Telegram, this bot/chat pair is working.`,
    parse_mode: "HTML",
  });
  if (!sent.ok) {
    console.log(`❌ sendMessage failed: ${sent.description}`);
    if (/bot was kicked|not enough rights|CHAT_WRITE_FORBIDDEN/i.test(sent.description || "")) {
      console.log(`   The bot is in the chat but doesn't have permission to post — check group admin settings.`);
    }
    return;
  }
  console.log(`✅ Test message sent successfully — check the "${chat.result.title || chatId}" chat in Telegram now.`);
}

async function main() {
  await checkBot(
    "Attendance (clock-in/out) bot",
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.TELEGRAM_CHAT_ID
  );
  await checkBot(
    "Daily Report bot",
    process.env.TELEGRAM_DAILY_REPORT_BOT_TOKEN,
    process.env.TELEGRAM_DAILY_REPORT_CHAT_ID
  );
  console.log("");
}

main().catch((err) => {
  console.error("Unexpected error:", err.message);
  process.exit(1);
});