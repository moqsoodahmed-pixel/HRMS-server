"use strict";
/**
 * get-telegram-chat-id.js
 * Run: node scripts/get-telegram-chat-id.js
 * 
 * Send ANY message in HRMS Alerts group FIRST, then run this.
 */

require("dotenv/config");
const https = require("https");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8930833844:AAEAInwe8Dpo8zggvd0KZC341w4k7mbJSrQ";

function get(path) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.telegram.org/bot${BOT_TOKEN}${path}`, (res) => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => resolve(JSON.parse(body)));
    }).on("error", reject);
  });
}

async function main() {
  console.log("\n🔍 Fetching all recent updates from Telegram...\n");
  
  // Try with no offset first
  const data = await get("/getUpdates?limit=100&allowed_updates=[\"message\"]");
  
  if (!data.ok) {
    console.error("❌ Error:", data.description);
    console.log("\nTrying to clear webhook first...");
    await get("/deleteWebhook?drop_pending_updates=false");
    const data2 = await get("/getUpdates?limit=100");
    processUpdates(data2);
    return;
  }
  
  processUpdates(data);
}

function processUpdates(data) {
  if (!data.result || data.result.length === 0) {
    console.log("❌ No messages found.\n");
    console.log("👉 Please send a message in HRMS Alerts group NOW, then run this script again.\n");
    return;
  }
  
  const chats = new Map();
  for (const update of data.result) {
    const msg = update.message || update.channel_post;
    if (msg?.chat) {
      chats.set(msg.chat.id, msg.chat);
    }
  }
  
  if (chats.size === 0) {
    console.log("❌ No group chats found in updates.\n");
    return;
  }
  
  console.log("✅ Found these chats:\n");
  for (const [id, chat] of chats) {
    console.log(`  Chat ID  : ${id}`);
    console.log(`  Title    : ${chat.title || chat.username || "private"}`);
    console.log(`  Type     : ${chat.type}`);
    console.log("");
  }
  
  console.log("👉 Copy the Chat ID above and add to Render env as:");
  console.log("   TELEGRAM_CHAT_ID=<the number above>\n");
}

main().catch(console.error);