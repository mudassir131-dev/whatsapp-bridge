const { bot, sendToAdmins } = require('./bot');
const config = require('../config');
const db = require('../database/db');
const whatsappClient = require('../whatsapp/client');
const tgLogger = require('../utils/logger').telegram;

// Track QR messages sent to admins to update/delete them
const qrMessagesMap = {}; // adminId -> lastQrMessageId

// Helper to format seconds to human-readable uptime
function formatUptime(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (hrs > 0) parts.push(`${hrs}h`);
  if (mins > 0) parts.push(`${mins}m`);
  parts.push(`${secs}s`);
  return parts.join(' ');
}

// Help command
bot.command('help', async (ctx) => {
  const helpText = `
*WhatsApp-Telegram Bridge Admin Controls*

*Commands:*
/status - Display status of all connections & configurations
/connect - Connect WhatsApp (requests QR code if not authenticated)
/disconnect - Disconnect and log out of WhatsApp session
/ai_on - Turn on AI auto-replies globally
/ai_off - Turn off AI auto-replies globally
/chats - List active chats and their AI settings
/help - Show this help menu

*Manual Reply:*
To reply to a WhatsApp user, simply reply directly to their forwarded message in this chat.

*Takeover Behavior:*
Replying manually to a message automatically pauses AI auto-replies for that specific contact. You can resume AI at any time using the buttons under the forwarded messages.
`;
  await ctx.reply(helpText, { parse_mode: 'Markdown' });
});

// Start command
bot.command('start', async (ctx) => {
  await ctx.reply(
    '👋 Welcome to the WhatsApp-Telegram Admin Control Bot. Use /help to see available commands.',
    { parse_mode: 'Markdown' }
  );
});

// Status command
bot.command('status', async (ctx) => {
  const waStatus = whatsappClient.getStatus();
  const uptime = formatUptime(process.uptime());
  
  // Get global AI setting (fallback to config if not saved in db)
  const globalSettings = db.getChatSettings('global');
  const aiGlobal = globalSettings.aiEnabled;

  const statusText = `
📊 *Bridge Status Report*

🟢 *Telegram Bot:* Connected
📱 *WhatsApp Client:* ${waStatus === 'OPEN' ? '🟢 Connected' : waStatus === 'CONNECTING' ? '🟡 Connecting' : waStatus === 'RECONNECTING' ? '🟡 Reconnecting' : '🔴 Disconnected'}
🤖 *AI Auto-Replies (Global):* ${aiGlobal ? '🟢 ON' : '🔴 OFF'}
🧠 *Groq Configuration:*
   - *API Key:* ${config.groq.apiKey ? '✅ Configured' : '❌ Missing'}
   - *Model:* \`${config.groq.model}\`
⏱️ *Uptime:* ${uptime}
⚙️ *Active Queued Messages:* ${require('../utils/queue').waQueue.length}
`;
  await ctx.reply(statusText, { parse_mode: 'Markdown' });
});

// Connect command
bot.command('connect', async (ctx) => {
  const status = whatsappClient.getStatus();
  if (status === 'OPEN') {
    await ctx.reply('✅ WhatsApp is already connected.');
    return;
  }
  
  if (status === 'CONNECTING') {
    await ctx.reply('🟡 WhatsApp connection is already in progress. Please wait for the QR code.');
    return;
  }
  
  await ctx.reply('🔄 Starting WhatsApp connection... Please wait.');
  try {
    await whatsappClient.initialize();
  } catch (err) {
    tgLogger.error('Failed to initialize WhatsApp connection from /connect:', err);
    await ctx.reply(`❌ Failed to start connection: ${err.message}`);
  }
});

// Disconnect command
bot.command('disconnect', async (ctx) => {
  const status = whatsappClient.getStatus();
  if (status === 'DISCONNECTED' || status === 'LOGGED_OUT') {
    await ctx.reply('⚠️ WhatsApp is already disconnected.');
    return;
  }

  await ctx.reply('🔌 Disconnecting and logging out WhatsApp... Please wait.');
  try {
    await whatsappClient.logout();
    await ctx.reply('❌ WhatsApp disconnected. Use /connect to re-authenticate.');
  } catch (err) {
    tgLogger.error('Error during disconnect command:', err);
    await ctx.reply(`❌ Error during disconnect: ${err.message}`);
  }
});

// AI Global On command
bot.command('ai_on', async (ctx) => {
  db.updateChatSettings('global', { aiEnabled: true });
  tgLogger.info('AI Auto-Replies enabled globally by admin.');
  await ctx.reply('🤖 *AI Auto-Replies globally enabled.*', { parse_mode: 'Markdown' });
});

// AI Global Off command
bot.command('ai_off', async (ctx) => {
  db.updateChatSettings('global', { aiEnabled: false });
  tgLogger.info('AI Auto-Replies disabled globally by admin.');
  await ctx.reply('🤖 *AI Auto-Replies globally disabled.* (WhatsApp messages will still be forwarded, and you can reply manually).', { parse_mode: 'Markdown' });
});

// List chats command
bot.command('chats', async (ctx) => {
  const chats = db.getAllChatSettings().filter(c => c.waChatId !== 'global');
  
  if (chats.length === 0) {
    await ctx.reply('No active conversations found in database settings.');
    return;
  }

  let text = `👥 *Active WhatsApp Chats & AI Settings:*\n\n`;
  for (const chat of chats) {
    const isPaused = chat.manualTakeover;
    const aiBlocked = !chat.aiEnabled;
    
    let statusEmoji = '🟢';
    let statusText = 'AI Active';
    if (aiBlocked) {
      statusEmoji = '🔴';
      statusText = 'AI Blocked';
    } else if (isPaused) {
      statusEmoji = '🟡';
      statusText = 'AI Paused (Takeover)';
    }

    text += `${statusEmoji} *${chat.waChatId.split('@')[0]}:* ${statusText}\n`;
  }

  await ctx.reply(text, { parse_mode: 'Markdown' });
});

// WhatsApp client event listeners for QR code delivery and success notification
whatsappClient.on('qr', async (qr) => {
  try {
    const QRCode = require('qrcode');
    const { InputFile } = require('grammy');
    
    // Generate PNG image buffer
    const buffer = await QRCode.toBuffer(qr, { width: 300 });
    
    for (const adminId of config.telegram.adminIds) {
      // Delete previous QR message if exists to prevent cluttering
      const prevMsgId = qrMessagesMap[adminId];
      if (prevMsgId) {
        try {
          await bot.api.deleteMessage(adminId, prevMsgId);
        } catch (err) {
          tgLogger.debug(`Failed to delete expired QR message for admin ${adminId}:`, err.message);
        }
      }

      // Send the new QR code
      const sentMsg = await bot.api.sendPhoto(adminId, new InputFile(buffer), {
        caption: '📱 *WhatsApp Link Request*\n\nOpen WhatsApp → Linked Devices → Link a Device and scan this QR code.',
        parse_mode: 'Markdown'
      });
      
      qrMessagesMap[adminId] = sentMsg.message_id;
    }
  } catch (err) {
    tgLogger.error('Failed to send WhatsApp QR code to Telegram admins:', err);
  }
});

whatsappClient.on('connected', async () => {
  // Clear any active QR code messages from admin chats
  for (const adminId of config.telegram.adminIds) {
    const prevMsgId = qrMessagesMap[adminId];
    if (prevMsgId) {
      try {
        await bot.api.deleteMessage(adminId, prevMsgId);
      } catch (err) {
        tgLogger.debug(`Failed to clean up QR message for admin ${adminId}:`, err.message);
      }
      delete qrMessagesMap[adminId];
    }
    
    try {
      await bot.api.sendMessage(adminId, '✅ *WhatsApp connected successfully.*', { parse_mode: 'Markdown' });
    } catch (err) {
      tgLogger.error(`Failed to send connection confirmation to admin ${adminId}:`, err);
    }
  }
});

// Handle Callback Queries (Inline Keyboard Buttons)
bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  
  if (data.startsWith('toggle_ai_')) {
    const waChatId = data.replace('toggle_ai_', '');
    const settings = db.getChatSettings(waChatId);
    
    // Toggle manual takeover state (Pause / Resume AI)
    const newTakeover = !settings.manualTakeover;
    db.updateChatSettings(waChatId, { manualTakeover: newTakeover });
    
    const actionText = newTakeover ? 'Paused' : 'Resumed';
    tgLogger.info(`AI Auto-Reply ${actionText} for ${waChatId} by inline button.`);
    
    await ctx.answerCallbackQuery({ text: `AI Auto-Replies ${actionText} for this chat.` });
    
    // Update the message inline keyboard
    const { InlineKeyboard } = require('grammy');
    const newKeyboard = new InlineKeyboard()
      .text(newTakeover ? '▶️ Resume AI' : '⏸ Pause AI', `toggle_ai_${waChatId}`)
      .text(settings.aiEnabled ? '🔒 Block AI' : '🔓 Unblock AI', `block_ai_${waChatId}`)
      .row()
      .text('🔄 Status', `status_chat_${waChatId}`);

    await ctx.editMessageReplyMarkup({ reply_markup: newKeyboard });

  } else if (data.startsWith('block_ai_')) {
    const waChatId = data.replace('block_ai_', '');
    const settings = db.getChatSettings(waChatId);
    
    // Toggle AI enabled state for this specific chat
    const newEnabled = !settings.aiEnabled;
    db.updateChatSettings(waChatId, { aiEnabled: newEnabled, manualTakeover: false });
    
    const actionText = newEnabled ? 'Unblocked' : 'Blocked';
    tgLogger.info(`AI Auto-Reply ${actionText} for ${waChatId} by inline button.`);
    
    await ctx.answerCallbackQuery({ text: `AI Auto-Replies ${actionText} for this chat.` });
    
    // Update the message inline keyboard
    const { InlineKeyboard } = require('grammy');
    const newKeyboard = new InlineKeyboard()
      .text('⏸ Pause AI', `toggle_ai_${waChatId}`)
      .text(newEnabled ? '🔒 Block AI' : '🔓 Unblock AI', `block_ai_${waChatId}`)
      .row()
      .text('🔄 Status', `status_chat_${waChatId}`);

    await ctx.editMessageReplyMarkup({ reply_markup: newKeyboard });

  } else if (data.startsWith('status_chat_')) {
    const waChatId = data.replace('status_chat_', '');
    const settings = db.getChatSettings(waChatId);
    
    let statusText = 'AI Active';
    if (!settings.aiEnabled) {
      statusText = 'AI Blocked';
    } else if (settings.manualTakeover) {
      statusText = 'AI Paused (Manual Takeover)';
    }
    
    await ctx.answerCallbackQuery({ text: `Chat Status: ${statusText}`, show_alert: true });
  }
});
