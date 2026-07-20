const http = require('http');
const whatsappClient = require('../whatsapp/client');
const config = require('../config');
const db = require('../database/db');
const { bridge: logger } = require('../utils/logger');

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

function startHealthServer() {
  const port = process.env.PORT || 3000;

  const server = http.createServer((req, res) => {
    const url = req.url;
    const method = req.method;

    if (method === 'GET' && url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('WhatsApp AI Bridge is running');
      return;
    }

    if (method === 'GET' && url === '/health') {
      const waStatus = whatsappClient.getStatus();
      
      // Get global AI setting
      const globalSettings = db.getChatSettings('global');
      const aiGlobal = globalSettings.aiEnabled;

      const healthInfo = {
        status: 'UP',
        uptime: formatUptime(process.uptime()),
        whatsapp: waStatus,
        telegram: 'Connected', // If server is serving HTTP, TG Bot is initialized and connected
        aiStatus: aiGlobal ? 'ON' : 'OFF',
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(healthInfo, null, 2));
      return;
    }

    // Default 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.listen(port, () => {
    logger.info(`HTTP Health Server listening on port ${port} ✓`);
  });

  // Handle server errors
  server.on('error', (err) => {
    logger.error('HTTP Health Server error:', err);
  });

  return server;
}

module.exports = {
  startHealthServer,
};
