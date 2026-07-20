const db = require('../database/db');

function resolveWhatsAppDetails(tgMessageId) {
  return db.getWhatsAppDetailsByTgMessage(tgMessageId);
}

function getAIState(waChatId) {
  // Get per-chat settings
  const chatSettings = db.getChatSettings(waChatId);
  // Get global settings
  const globalSettings = db.getChatSettings('global');

  // AI is active if globally enabled, chat-specific AI is enabled, and not in manual takeover
  const isAIActive = globalSettings.aiEnabled && chatSettings.aiEnabled && !chatSettings.manualTakeover;

  return {
    globalEnabled: globalSettings.aiEnabled,
    chatEnabled: chatSettings.aiEnabled,
    manualTakeover: chatSettings.manualTakeover,
    isAIActive,
  };
}

function enableAIChat(waChatId) {
  db.updateChatSettings(waChatId, { aiEnabled: true, manualTakeover: false });
}

function disableAIChat(waChatId) {
  db.updateChatSettings(waChatId, { aiEnabled: false });
}

function resumeAIChat(waChatId) {
  db.updateChatSettings(waChatId, { manualTakeover: false });
}

function pauseAIChat(waChatId) {
  db.updateChatSettings(waChatId, { manualTakeover: true });
}

module.exports = {
  resolveWhatsAppDetails,
  getAIState,
  enableAIChat,
  disableAIChat,
  resumeAIChat,
  pauseAIChat,
};
