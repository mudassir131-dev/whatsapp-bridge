const { bot } = require('./bot');
const db = require('../database/db');
const whatsappClient = require('../whatsapp/client');
const tgLogger = require('../utils/logger').telegram;
const bridgeLogger = require('../utils/logger').bridge;

// Listen for replies to forwarded WhatsApp messages
bot.on('message', async (ctx, next) => {
  const replyTo = ctx.message.reply_to_message;
  
  // If this message is not a reply to another message, skip to next middleware (commands)
  if (!replyTo) {
    return next();
  }

  // Check if the replied-to message is in our DB map
  const mapping = db.getWhatsAppDetailsByTgMessage(replyTo.message_id);
  
  if (!mapping) {
    // If it's a reply but not to a WhatsApp forward, skip
    return next();
  }

  const replyText = ctx.message.text;
  if (!replyText) {
    // We only support replying with text for now
    await ctx.reply('⚠️ Only text replies are supported for forwarding to WhatsApp.');
    return;
  }

  try {
    bridgeLogger.info(`Manual reply received from Telegram for chat ${mapping.wa_chat_id}: "${replyText}"`);

    // Temporarily disable AI auto-replies for this specific conversation (Manual Takeover)
    db.updateChatSettings(mapping.wa_chat_id, {
      manualTakeover: true,
      lastManualInteraction: Date.now(),
    });
    bridgeLogger.info(`Manual takeover enabled/extended for WhatsApp chat: ${mapping.wa_chat_id}`);

    // Send the reply to WhatsApp
    await whatsappClient.sendTextMessage(mapping.wa_chat_id, replyText);
    
    // Log success
    tgLogger.info(`Manual reply successfully sent to WhatsApp user: ${mapping.contact_name} (${mapping.phone_number})`);
    
    // Add manual reply to the conversation history so AI is aware of it
    db.addMessageToHistory(mapping.wa_chat_id, 'assistant', replyText);

  } catch (error) {
    tgLogger.error(`Failed to forward reply to WhatsApp:`, error);
    await ctx.reply(`❌ Failed to send reply to WhatsApp: ${error.message}`);
  }
});
