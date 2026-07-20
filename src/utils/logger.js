const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';

const transport = isDev
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname',
      },
    }
  : undefined;

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport,
});

// Helper to create prefixed logs
function createPrefixedLogger(prefix) {
  return {
    info: (msg, ...args) => logger.info(`[${prefix}] ${msg}`, ...args),
    debug: (msg, ...args) => logger.debug(`[${prefix}] ${msg}`, ...args),
    warn: (msg, ...args) => logger.warn(`[${prefix}] ${msg}`, ...args),
    error: (msg, ...args) => logger.error(`[${prefix}] ${msg}`, ...args),
  };
}

module.exports = {
  logger,
  whatsapp: createPrefixedLogger('WHATSAPP'),
  telegram: createPrefixedLogger('TELEGRAM'),
  ai: createPrefixedLogger('AI'),
  bridge: createPrefixedLogger('BRIDGE'),
  db: createPrefixedLogger('DATABASE'),
  error: createPrefixedLogger('ERROR'),
};
