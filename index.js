const whatsappClient = require('./src/whatsapp/client');
const { startBot, sendToAdmins } = require('./src/telegram/bot');
const config = require('./src/config');
const { logger, bridge: bridgeLogger } = require('./src/utils/logger');
const db = require('./src/database/db');
const { startHealthServer } = require('./src/bridge/server');

// Ensure commands and replies are loaded so they register their listeners
require('./src/telegram/commands');
require('./src/telegram/replies');
// Load router to listen for whatsapp events
require('./src/bridge/router');

async function main() {
  bridgeLogger.info('=============================================');
  bridgeLogger.info('Starting WhatsApp-Telegram Bridge Application');
  bridgeLogger.info('=============================================');
  
  // 1. Start HTTP Health Server
  try {
    startHealthServer();
  } catch (error) {
    logger.error('Failed to start HTTP Health Server:', error);
    process.exit(1);
  }

  // 2. Start Telegram Bot
  try {
    startBot();
  } catch (error) {
    logger.error('Failed to start Telegram Bot:', error);
    process.exit(1);
  }

  // 2. Start WhatsApp connection ONLY if session credentials already exist
  const fs = require('fs');
  const path = require('path');
  const credsFile = path.join(config.whatsapp.authDir, 'creds.json');
  
  if (fs.existsSync(credsFile)) {
    bridgeLogger.info('Saved WhatsApp session credentials found. Initializing connection automatically...');
    try {
      await whatsappClient.initialize();
    } catch (error) {
      logger.error('Failed to initialize WhatsApp connection:', error);
      process.exit(1);
    }
  } else {
    bridgeLogger.info('No saved WhatsApp session found. Waiting for admin to send /connect command before generating QR.');
  }

  // Set up ready/connected message
  whatsappClient.once('connected', async () => {
    // Send a status confirmation to the admin on connection
    const globalSettings = db.getChatSettings('global');
    const aiGlobal = globalSettings.aiEnabled;

    const startupStatusText = `
🚀 *Bridge Successfully Started!*

📱 *WhatsApp Connection:* Connected ✓
🤖 *AI Auto-Replies (Global):* ${aiGlobal ? '🟢 ON' : '🔴 OFF'}
🧠 *Groq Model:* \`${config.groq.model}\`
    `;
    
    bridgeLogger.info('WhatsApp connection active. Notifying Telegram admin...');
    await sendToAdmins(startupStatusText, { parse_mode: 'Markdown' });
  });

  // Graceful shutdown handler
  const shutdown = () => {
    bridgeLogger.info('Shutting down bridge...');
    if (whatsappClient.getSocket()) {
      try {
        whatsappClient.getSocket().end();
      } catch (e) {
        // Ignore
      }
    }
    try {
      db.db.close();
      bridgeLogger.info('SQLite database closed.');
    } catch (e) {
      // Ignore
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  logger.error('Unhandled bootstrap exception:', err);
  process.exit(1);
});
