const { Bot, InlineKeyboard } = require('grammy');
const config = require('../config');
const tgLogger = require('../utils/logger').telegram;
const { tgQueue } = require('../utils/queue');
const db = require('../database/db');

if (!config.telegram.token) {
  tgLogger.error('TELEGRAM_BOT_TOKEN is not set!');
  process.exit(1);
}

const bot = new Bot(config.telegram.token);

// Admin Authentication Middleware
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  if (!config.telegram.adminIds.includes(userId)) {
    tgLogger.warn(`Unauthorized access attempt from Telegram User ID: ${userId} (${ctx.from.username || 'unknown'})`);
    return; // Ignore unauthorized messages silently
  }
  await next();
});

// Helper to send messages to all admins
async function sendToAdmins(text, options = {}) {
  const results = [];
  for (const adminId of config.telegram.adminIds) {
    try {
      // Use queue to respect rate limits
      const res = await tgQueue.enqueue(
        () => bot.api.sendMessage(adminId, text, options),
        `Send Telegram message to admin ${adminId}`
      );
      results.push({ adminId, messageId: res.message_id });
    } catch (error) {
      tgLogger.error(`Failed to send Telegram message to admin ${adminId}:`, error);
    }
  }
  return results;
}

// Format and forward a WhatsApp message to Telegram admins
async function forwardWhatsAppMessage(parsedMsg) {
  const timeStr = new Date(parsedMsg.timestamp).toLocaleTimeString();
  
  let text = `*WhatsApp Message*\n\n`;
  text += `👤 *Name:* ${parsedMsg.senderName}\n`;
  text += `📱 *Number:* \`${parsedMsg.senderNumber}\`\n`;
  
  if (parsedMsg.quoted) {
    text += `💬 *Quoted:* _"${parsedMsg.quoted.text}"_\n`;
  }
  
  if (parsedMsg.isMedia) {
    text += `📎 *Media Type:* ${parsedMsg.mediaType}\n`;
    if (parsedMsg.mediaInfo?.filename) {
      text += `📄 *Filename:* ${parsedMsg.mediaInfo.filename}\n`;
    }
    if (parsedMsg.mediaInfo?.caption) {
      text += `📝 *Caption:* ${parsedMsg.mediaInfo.caption}\n`;
    }
  } else {
    text += `✉️ *Message:* ${parsedMsg.text}\n`;
  }
  
  text += `🕒 *Time:* ${timeStr}\n`;

  // Fetch current AI settings for inline keyboard
  const chatSettings = db.getChatSettings(parsedMsg.chatId);
  const aiStateText = chatSettings.aiEnabled 
    ? (chatSettings.manualTakeover ? '🤖 AI Paused (Takeover)' : '🤖 AI Auto-Reply ON') 
    : '🤖 AI Globally OFF';

  text += `⚙️ *AI State:* ${aiStateText}`;

  // Inline keyboard for manual controls
  const keyboard = new InlineKeyboard()
    .text(chatSettings.aiEnabled ? '⏸ Pause AI' : '▶️ Resume AI', `toggle_ai_${parsedMsg.chatId}`)
    .text('🔒 Block AI', `block_ai_${parsedMsg.chatId}`)
    .row()
    .text('🔄 Status', `status_chat_${parsedMsg.chatId}`);

  const sentMsgs = await sendToAdmins(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  // Save the mapping for each admin who received the message
  for (const { adminId, messageId } of sentMsgs) {
    db.saveMessageMapping(
      parsedMsg.chatId,
      parsedMsg.id,
      messageId,
      adminId,
      parsedMsg.senderName,
      parsedMsg.senderNumber
    );
  }

  tgLogger.info(`Forwarded WhatsApp message from ${parsedMsg.senderName} to Telegram admins.`);
}

// Start Telegram Bot
function startBot() {
  bot.start({
    onStart: (botInfo) => {
      tgLogger.info(`Telegram Bot Connected ✓ (@${botInfo.username})`);
    },
  });
}

module.exports = {
  bot,
  sendToAdmins,
  forwardWhatsAppMessage,
  startBot,
};
