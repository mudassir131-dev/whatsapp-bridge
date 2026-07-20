const db = require('../database/db');
const config = require('../config');

function getHistory(waChatId) {
  // Retrieve the latest history configured by AI settings limit
  return db.getConversationHistory(waChatId, config.ai.maxHistory);
}

function saveUserMessage(waChatId, text) {
  db.addMessageToHistory(waChatId, 'user', text);
}

function saveAIMessage(waChatId, text) {
  db.addMessageToHistory(waChatId, 'assistant', text);
}

module.exports = {
  getHistory,
  saveUserMessage,
  saveAIMessage,
};
