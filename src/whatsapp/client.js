const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const waLogger = require('../utils/logger').whatsapp;
const { waQueue } = require('../utils/queue');
const EventEmitter = require('events');

class WhatsAppClient extends EventEmitter {
  constructor() {
    super();
    this.sock = null;
    this.connectionStatus = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, OPEN, RECONNECTING, LOGGED_OUT
    this.reconnectAttempt = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectTimeout = null;
    this.appStartTime = Date.now();
    this.qrCount = 0;
  }

  async initialize() {
    if (this.connectionStatus === 'OPEN') {
      waLogger.info('WhatsApp is already connected. Skipping initialization.');
      return;
    }
    if (this.connectionStatus === 'CONNECTING' && this.sock) {
      waLogger.info('WhatsApp connection is already in progress. Skipping initialization.');
      return;
    }

    this.qrCount = 0;
    this.connectionStatus = 'CONNECTING';
    this.emit('status', this.connectionStatus);

    try {
      const { state, saveCreds } = await useMultiFileAuthState(config.whatsapp.authDir);

      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // We'll handle printing QR or generating pairing codes ourselves
        markOnlineOnConnect: true,
        syncFullHistory: false, // Don't sync full history to speed up startup and save bandwidth
      });

      // Handle credentials update (saves session data)
      this.sock.ev.on('creds.update', saveCreds);

      // Handle connection updates
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrCount++;
          if (this.qrCount > 5) {
            waLogger.warn('QR code not scanned within 5 updates. Stopping WhatsApp connection to prevent infinite loop.');
            await this.disconnect();
            return;
          }
          this.handleQR(qr);
        }

        if (connection === 'connecting') {
          waLogger.info('Connecting to WhatsApp...');
        }

        if (connection === 'open') {
          this.connectionStatus = 'OPEN';
          this.reconnectAttempt = 0;
          waLogger.info('WhatsApp Connected ✓');
          this.emit('status', this.connectionStatus);
          this.emit('connected');
        }

        if (connection === 'close') {
          const error = lastDisconnect?.error;
          const statusCode = error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          waLogger.warn(`Connection closed. Status code: ${statusCode || 'unknown'}. Error: ${error ? error.message : 'none'}`);

          if (shouldReconnect) {
            this.connectionStatus = 'RECONNECTING';
            this.emit('status', this.connectionStatus);
            this.handleReconnect();
          } else {
            this.connectionStatus = 'LOGGED_OUT';
            waLogger.error('Logged out from WhatsApp. Re-authentication is required!');
            this.emit('status', this.connectionStatus);
            this.emit('logout');
          }
        }
      });

      // Handle incoming messages
      this.sock.ev.on('messages.upsert', (event) => {
        if (event.messages) {
          for (const msg of event.messages) {
            this.emit('message', msg);
          }
        }
      });

      // Handle pairing code if requested
      if (!this.sock.authState.creds.registered && config.whatsapp.phoneNumber) {
        waLogger.info(`Pairing code requested for phone number: ${config.whatsapp.phoneNumber}`);
        // Delay slightly to allow socket setup to finish
        setTimeout(async () => {
          try {
            const code = await this.sock.requestPairingCode(config.whatsapp.phoneNumber);
            waLogger.info(`----------------------------------------`);
            waLogger.info(`PAIRING CODE: ${code}`);
            waLogger.info(`Enter this pairing code in WhatsApp on your phone:`);
            waLogger.info(`WhatsApp -> Linked Devices -> Link Device -> Link with phone number instead`);
            waLogger.info(`----------------------------------------`);
            this.emit('pairing_code', code);
          } catch (err) {
            waLogger.error('Failed to request pairing code:', err);
          }
        }, 3000);
      }

    } catch (err) {
      waLogger.error('Initialization error:', err);
      this.connectionStatus = 'DISCONNECTED';
      this.emit('status', this.connectionStatus);
      this.handleReconnect();
    }
  }

  handleQR(qr) {
    waLogger.info('Scan this QR Code to connect your WhatsApp account:');
    qrcodeTerminal.generate(qr, { small: true });
    
    // Save as PNG image in the artifacts directory for crisp rendering in chat
    const artifactsDir = 'C:/Users/ADMIN/.gemini/antigravity-ide/brain/4d0bb377-6cb6-460a-9334-64f4cb319f19';
    const qrPath = path.join(artifactsDir, 'qr.png');
    
    try {
      if (!fs.existsSync(artifactsDir)) {
        fs.mkdirSync(artifactsDir, { recursive: true });
      }
      QRCode.toFile(qrPath, qr, {
        color: {
          dark: '#000000',
          light: '#ffffff'
        },
        width: 300
      }, (err) => {
        if (err) {
          waLogger.error('Failed to save QR code image file:', err);
        } else {
          waLogger.info(`Saved clean QR code image to ${qrPath}`);
        }
      });
    } catch (e) {
      waLogger.error('Failed to write QR code image:', e);
    }

    this.emit('qr', qr);
  }

  handleReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      waLogger.error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached. Stopping reconnect loop.`);
      return;
    }

    this.reconnectAttempt++;
    // Exponential backoff with jitter, capped at 30 seconds
    const backoffDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempt) + Math.random() * 1000, 30000);
    waLogger.info(`Attempting to reconnect in ${(backoffDelay / 1000).toFixed(1)}s (Attempt ${this.reconnectAttempt}/${this.maxReconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      this.initialize();
    }, backoffDelay);
  }

  // Queue-based message sender to prevent ban/rate limits
  async sendTextMessage(jid, text, options = {}) {
    if (this.connectionStatus !== 'OPEN') {
      throw new Error('WhatsApp connection is not active');
    }

    // STRICT DOUBLE-VALIDATION CHECK FOR 1-to-1 PRIVATE CHATS
    if (!jid || !jid.endsWith('@s.whatsapp.net')) {
      waLogger.error(`BLOCKED outbound WhatsApp message: Destination JID '${jid}' is not a valid 1-to-1 private chat!`);
      throw new Error('Outbound message blocked: Destination JID is not a valid 1-to-1 private chat');
    }

    return waQueue.enqueue(async () => {
      waLogger.info(`Sending message to ${jid}`);
      return await this.sock.sendMessage(jid, { text }, options);
    }, `Send WhatsApp message to ${jid}`);
  }

  getSocket() {
    return this.sock;
  }

  getStatus() {
    return this.connectionStatus;
  }

  async logout() {
    waLogger.info('Logging out of WhatsApp...');
    
    // Close reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    this.reconnectAttempt = 0;
    
    // Call socket logout if possible
    if (this.sock) {
      try {
        await this.sock.logout();
      } catch (e) {
        waLogger.debug('Socket logout error (might already be disconnected):', e.message);
      }
      try {
        this.sock.end();
      } catch (e) {
        // Ignore
      }
      this.sock = null;
    }

    // Delete credentials directory contents to force re-authentication
    try {
      if (fs.existsSync(config.whatsapp.authDir)) {
        fs.rmSync(config.whatsapp.authDir, { recursive: true, force: true });
        waLogger.info(`Cleaned session directory: ${config.whatsapp.authDir}`);
      }
    } catch (e) {
      waLogger.error('Failed to clean session directory:', e);
    }

    this.connectionStatus = 'DISCONNECTED';
    this.emit('status', this.connectionStatus);
    this.emit('logout');
  }

  async disconnect() {
    waLogger.info('Disconnecting WhatsApp socket due to QR scan timeout...');
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    this.reconnectAttempt = 0;
    
    if (this.sock) {
      try {
        this.sock.end();
      } catch (e) {
        // Ignore
      }
      this.sock = null;
    }

    this.connectionStatus = 'DISCONNECTED';
    this.emit('status', this.connectionStatus);
    this.emit('qr_timeout');
  }
}

// Export singleton instance
module.exports = new WhatsAppClient();
