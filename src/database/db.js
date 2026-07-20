const Database = require('better-sqlite3');
const config = require('../config');
const { db: dbLogger } = require('../utils/logger');

// Initialize database
let db;
try {
  db = new Database(config.database.path);
  db.pragma('journal_mode = WAL');
  dbLogger.info(`Connected to SQLite database at ${config.database.path}`);
} catch (error) {
  dbLogger.error(`Failed to connect to database at ${config.database.path}`, error);
  process.exit(1);
}

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS message_map (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wa_chat_id TEXT NOT NULL,
    wa_message_id TEXT NOT NULL UNIQUE,
    tg_message_id INTEGER NOT NULL UNIQUE,
    tg_chat_id INTEGER NOT NULL,
    contact_name TEXT,
    phone_number TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wa_chat_id TEXT NOT NULL,
    role TEXT CHECK(role IN ('user', 'assistant')) NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_settings (
    wa_chat_id TEXT PRIMARY KEY,
    ai_enabled INTEGER DEFAULT 1,
    manual_takeover INTEGER DEFAULT 0,
    last_manual_interaction INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_message_map_wa ON message_map(wa_chat_id, wa_message_id);
  CREATE INDEX IF NOT EXISTS idx_message_map_tg ON message_map(tg_message_id);
  CREATE INDEX IF NOT EXISTS idx_history_wa ON conversation_history(wa_chat_id, created_at);
`);

// --- database methods ---

// 1. Message Map operations
const insertMapStmt = db.prepare(`
  INSERT INTO message_map (wa_chat_id, wa_message_id, tg_message_id, tg_chat_id, contact_name, phone_number, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

function saveMessageMapping(waChatId, waMessageId, tgMessageId, tgChatId, contactName, phoneNumber) {
  try {
    insertMapStmt.run(waChatId, waMessageId, tgMessageId, tgChatId, contactName, phoneNumber, Date.now());
  } catch (error) {
    dbLogger.error(`Error saving message mapping for WA Msg ID ${waMessageId}`, error);
  }
}

const getMapByTgMsgStmt = db.prepare(`
  SELECT wa_chat_id, wa_message_id, contact_name, phone_number 
  FROM message_map 
  WHERE tg_message_id = ?
`);

function getWhatsAppDetailsByTgMessage(tgMessageId) {
  try {
    return getMapByTgMsgStmt.get(tgMessageId);
  } catch (error) {
    dbLogger.error(`Error retrieving details for Telegram message ${tgMessageId}`, error);
    return null;
  }
}

// 2. Chat Settings operations
const getSettingsStmt = db.prepare(`
  SELECT ai_enabled, manual_takeover, last_manual_interaction FROM chat_settings WHERE wa_chat_id = ?
`);

function getChatSettings(waChatId) {
  try {
    const row = getSettingsStmt.get(waChatId);
    if (!row) {
      return { aiEnabled: 1, manualTakeover: 0, lastManualInteraction: 0 };
    }
    return {
      aiEnabled: row.ai_enabled === 1,
      manualTakeover: row.manual_takeover === 1,
      lastManualInteraction: row.last_manual_interaction,
    };
  } catch (error) {
    dbLogger.error(`Error getting chat settings for ${waChatId}`, error);
    return { aiEnabled: 1, manualTakeover: 0, lastManualInteraction: 0 };
  }
}

const upsertSettingsStmt = db.prepare(`
  INSERT INTO chat_settings (wa_chat_id, ai_enabled, manual_takeover, last_manual_interaction)
  VALUES (@waChatId, @aiEnabled, @manualTakeover, @lastManualInteraction)
  ON CONFLICT(wa_chat_id) DO UPDATE SET
    ai_enabled = COALESCE(@aiEnabled, ai_enabled),
    manual_takeover = COALESCE(@manualTakeover, manual_takeover),
    last_manual_interaction = COALESCE(@lastManualInteraction, last_manual_interaction)
`);

function updateChatSettings(waChatId, updates) {
  try {
    const current = getChatSettings(waChatId);
    const params = {
      waChatId,
      aiEnabled: updates.aiEnabled !== undefined ? (updates.aiEnabled ? 1 : 0) : null,
      manualTakeover: updates.manualTakeover !== undefined ? (updates.manualTakeover ? 1 : 0) : null,
      lastManualInteraction: updates.lastManualInteraction !== undefined ? updates.lastManualInteraction : null,
    };
    upsertSettingsStmt.run(params);
  } catch (error) {
    dbLogger.error(`Error updating chat settings for ${waChatId}`, error);
  }
}

// 3. Conversation History operations
const getHistoryStmt = db.prepare(`
  SELECT role, content FROM conversation_history
  WHERE wa_chat_id = ?
  ORDER BY created_at DESC
  LIMIT ?
`);

function getConversationHistory(waChatId, limit = 20) {
  try {
    const rows = getHistoryStmt.all(waChatId, limit);
    // Return in chronological order
    return rows.reverse().map(row => ({
      role: row.role,
      content: row.content,
    }));
  } catch (error) {
    dbLogger.error(`Error getting conversation history for ${waChatId}`, error);
    return [];
  }
}

const addHistoryStmt = db.prepare(`
  INSERT INTO conversation_history (wa_chat_id, role, content, created_at)
  VALUES (?, ?, ?, ?)
`);

function addMessageToHistory(waChatId, role, content) {
  try {
    addHistoryStmt.run(waChatId, role, content, Date.now());
    trimConversationHistory(waChatId);
  } catch (error) {
    dbLogger.error(`Error adding message to history for ${waChatId}`, error);
  }
}

function trimConversationHistory(waChatId) {
  try {
    // Keep only the last N messages
    const maxHistory = config.ai.maxHistory;
    const deleteStmt = db.prepare(`
      DELETE FROM conversation_history
      WHERE id NOT IN (
        SELECT id FROM conversation_history
        WHERE wa_chat_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      ) AND wa_chat_id = ?
    `);
    deleteStmt.run(waChatId, maxHistory, waChatId);
  } catch (error) {
    dbLogger.error(`Error trimming history for ${waChatId}`, error);
  }
}

// Get all active chats with settings for command /chats
const getAllSettingsStmt = db.prepare(`
  SELECT wa_chat_id, ai_enabled, manual_takeover FROM chat_settings
`);

function getAllChatSettings() {
  try {
    return getAllSettingsStmt.all().map(row => ({
      waChatId: row.wa_chat_id,
      aiEnabled: row.ai_enabled === 1,
      manualTakeover: row.manual_takeover === 1,
    }));
  } catch (error) {
    dbLogger.error('Error getting all chat settings', error);
    return [];
  }
}

module.exports = {
  saveMessageMapping,
  getWhatsAppDetailsByTgMessage,
  getChatSettings,
  updateChatSettings,
  getConversationHistory,
  addMessageToHistory,
  getAllChatSettings,
  db,
};
