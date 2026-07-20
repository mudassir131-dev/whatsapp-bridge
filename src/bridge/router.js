const whatsappClient = require('../whatsapp/client');
const { parseIncomingMessage } = require('../whatsapp/messages');
const { forwardWhatsAppMessage, sendToAdmins } = require('../telegram/bot');
const { getAIState } = require('./conversationMap');
const { generateAIResponse } = require('../ai/groq');
const memory = require('../ai/memory');
const db = require('../database/db');
const bridgeLogger = require('../utils/logger').bridge;
const errorLogger = require('../utils/logger').error;

// Keep an in-memory set of recently processed WhatsApp message IDs to avoid double-processing
const processedMessageIds = new Set();
const MAX_PROCESSED_IDS_CACHE = 1000;

function isDuplicate(messageId) {
  if (processedMessageIds.has(messageId)) {
    return true;
  }
  
  // Also query the SQLite db to verify we haven't forwarded it already
  // (e.g. if the server restarted and Baileys re-emits messages)
  const isIdInDb = db.db.prepare('SELECT 1 FROM message_map WHERE wa_message_id = ?').get(messageId);
  if (isIdInDb) {
    processedMessageIds.add(messageId); // Cache it
    return true;
  }

  return false;
}

// Rate limiting state: waChatId -> { timestamps: [] }
const userMessageRateMap = new Map();

function isFlooding(waChatId, senderName, senderNumber) {
  const now = Date.now();
  if (!userMessageRateMap.has(waChatId)) {
    userMessageRateMap.set(waChatId, { timestamps: [] });
  }

  const userRecord = userMessageRateMap.get(waChatId);
  // Keep only timestamps from the last 10 seconds
  userRecord.timestamps = userRecord.timestamps.filter(ts => now - ts < 10000);
  
  // Add current timestamp
  userRecord.timestamps.push(now);

  // If user sent more than 5 messages in 10 seconds
  if (userRecord.timestamps.length > 5) {
    const settings = db.getChatSettings(waChatId);
    if (!settings.manualTakeover) {
      // Pause AI for this user (trigger Manual Takeover)
      db.updateChatSettings(waChatId, { manualTakeover: true, lastManualInteraction: now });
      
      // Notify admin
      const floodAlertText = `⚠️ *Flood Warning* from ${senderName} (\`${senderNumber}\`). Sent ${userRecord.timestamps.length} messages in 10s. AI auto-replies have been temporarily paused for this chat.`;
      sendToAdmins(floodAlertText, { parse_mode: 'Markdown' }).catch(err => {
        errorLogger.error('Failed to send flood alert to admins:', err);
      });
      bridgeLogger.warn(`Flood detected for chat ${waChatId}. AI auto-replies paused.`);
    }
    return true;
  }
  return false;
}

function addToProcessed(messageId) {
  processedMessageIds.add(messageId);
  if (processedMessageIds.size > MAX_PROCESSED_IDS_CACHE) {
    // Delete oldest elements (first inserted)
    const firstKey = processedMessageIds.values().next().value;
    processedMessageIds.delete(firstKey);
  }
}

async function handleIncomingWhatsApp(rawMsg) {
  let parsedMsg;
  try {
    parsedMsg = parseIncomingMessage(rawMsg);
  } catch (err) {
    errorLogger.error('Failed to parse incoming WhatsApp message:', err);
    return;
  }

  if (!parsedMsg) {
    const remoteJid = rawMsg.key?.remoteJid;
    const fromMe = rawMsg.key?.fromMe;
    bridgeLogger.debug(`Inbound message filtered out (e.g., self-message, status, group, unsupported): JID=${remoteJid}, fromMe=${fromMe}`);
    return;
  }

  // Idempotency check
  if (isDuplicate(parsedMsg.id)) {
    bridgeLogger.debug(`Ignoring duplicate message ID: ${parsedMsg.id}`);
    return;
  }

  // Mark message as processed to prevent duplicate processing
  addToProcessed(parsedMsg.id);

  bridgeLogger.info(`Processing message from ${parsedMsg.senderName} (${parsedMsg.senderNumber})`);

  // Track message rates for flood protection (will trigger manual takeover if flooding)
  isFlooding(parsedMsg.chatId, parsedMsg.senderName, parsedMsg.senderNumber);

  try {
    // 1. Forward WhatsApp message to Telegram
    await forwardWhatsAppMessage(parsedMsg);

    // 2. Save incoming user message to history
    memory.saveUserMessage(parsedMsg.chatId, parsedMsg.text);

    // 3. Process AI auto-reply flow
    const aiState = getAIState(parsedMsg.chatId);
    
    // Check if the message is from before the application startup (offline message replay on reconnect)
    const isOfflineReplay = parsedMsg.timestamp < whatsappClient.appStartTime;
    
    if (aiState.isAIActive) {
      if (isOfflineReplay) {
        bridgeLogger.info(`AI Auto-Reply skipped for chat ${parsedMsg.chatId} because the message was sent before app start (${new Date(parsedMsg.timestamp).toISOString()} < ${new Date(whatsappClient.appStartTime).toISOString()})`);
      } else {
        bridgeLogger.info(`AI Auto-Reply active for chat ${parsedMsg.chatId}. Triggering Groq Llama completion.`);
        
        // Fetch history (last N messages)
        const history = memory.getHistory(parsedMsg.chatId);
        
        // Generate AI completion
        const aiReply = await generateAIResponse(parsedMsg.chatId, parsedMsg.text, history);

        if (aiReply) {
          // Send AI reply to WhatsApp
          await whatsappClient.sendTextMessage(parsedMsg.chatId, aiReply);
          
          // Save AI reply to history
          memory.saveAIMessage(parsedMsg.chatId, aiReply);

          // Forward the AI response back to Telegram so the admin can monitor
          const monitorText = `🤖 *AI Auto-Reply to ${parsedMsg.senderName}*:\n\n${aiReply}`;
          await sendToAdmins(monitorText, { parse_mode: 'Markdown' });
        } else {
          // Groq API call failed
          bridgeLogger.warn(`Groq generation returned empty or failed for chat ${parsedMsg.chatId}.`);
          
          // Notify admin about the AI failure (Do not send error to the WhatsApp user)
          const errorNotification = `⚠️ *AI Response Failed* for ${parsedMsg.senderName} (\`${parsedMsg.senderNumber}\`). Manual reply may be required.`;
          await sendToAdmins(errorNotification, { parse_mode: 'Markdown' });
        }
      }
    } else {
      let reason = 'Globally OFF';
      if (aiState.globalEnabled) {
        if (!aiState.chatEnabled) reason = 'Blocked for Chat';
        else if (aiState.manualTakeover) reason = 'Manual Takeover Active';
      }
      bridgeLogger.info(`AI Auto-Reply skipped for chat ${parsedMsg.chatId}. Reason: ${reason}`);
    }

  } catch (err) {
    errorLogger.error(`Error in message routing for chat ${parsedMsg.chatId}:`, err);
  }
}

// Wire the event listener
whatsappClient.on('message', handleIncomingWhatsApp);

module.exports = {
  handleIncomingWhatsApp,
};
