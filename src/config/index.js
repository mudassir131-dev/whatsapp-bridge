require('dotenv').config();
const path = require('path');

// Helper to parse comma-separated admin IDs into numbers
function parseAdminIds(idsString) {
  if (!idsString) return [];
  return idsString
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
    .map(Number)
    .filter(id => !isNaN(id));
}

// Validate required environment variables
const requiredEnv = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_IDS', 'GROQ_API_KEY'];
const missing = requiredEnv.filter(name => !process.env[name]);

if (missing.length > 0) {
  console.error(`[CONFIG ERROR] Missing required environment variables: ${missing.join(', ')}`);
  console.error('Please configure your .env file correctly.');
  process.exit(1);
}

// Map user-friendly model name to Groq API ID
let groqModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
// Normalize common user inputs for model
if (groqModel.toLowerCase().replace(/[\s\-_.]/g, '') === 'llama33') {
  groqModel = 'llama-3.3-70b-versatile';
}

const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN.trim(),
    adminIds: parseAdminIds(process.env.TELEGRAM_ADMIN_IDS),
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY.trim(),
    model: groqModel.trim(),
  },
  ai: {
    enabled: process.env.AI_ENABLED === 'true',
    maxHistory: parseInt(process.env.MAX_HISTORY_MESSAGES || '20', 10),
  },
  whatsapp: {
    phoneNumber: process.env.WA_PHONE_NUMBER ? process.env.WA_PHONE_NUMBER.replace(/\D/g, '') : null,
    authDir: path.resolve(process.cwd(), process.env.AUTH_DIR || './auth'),
  },
  database: {
    path: path.resolve(process.cwd(), process.env.DB_PATH || './data/bridge.db'),
  },
  logLevel: process.env.LOG_LEVEL || 'info',
  nodeEnv: process.env.NODE_ENV || 'development',
};

// Make sure auth directory and db directory paths are correct
const fs = require('fs');
const dbDir = path.dirname(config.database.path);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
if (!fs.existsSync(config.whatsapp.authDir)) {
  fs.mkdirSync(config.whatsapp.authDir, { recursive: true });
}

module.exports = config;
