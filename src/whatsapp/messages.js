const waLogger = require('../utils/logger').whatsapp;

function parseIncomingMessage(msg) {
  // Ignore messages from self
  if (msg.key.fromMe) {
    return null;
  }

  // Ignore group messages, channels, newsletters, statuses, broadcasts, etc.
  // Direct 1-on-1 chats always end with @s.whatsapp.net or @lid JID suffix.
  if (!msg.key.remoteJid || (!msg.key.remoteJid.endsWith('@s.whatsapp.net') && !msg.key.remoteJid.endsWith('@lid'))) {
    return null;
  }

  let messageContent = msg.message;
  if (!messageContent) {
    return null;
  }

  // Unwrap ephemeral, viewOnce, or documentWithCaption wrappers
  if (messageContent.ephemeralMessage) {
    messageContent = messageContent.ephemeralMessage.message;
  }
  if (messageContent.viewOnceMessage) {
    messageContent = messageContent.viewOnceMessage.message;
  }
  if (messageContent.viewOnceMessageV2) {
    messageContent = messageContent.viewOnceMessageV2.message;
  }
  if (messageContent.documentWithCaptionMessage) {
    messageContent = messageContent.documentWithCaptionMessage.message;
  }

  if (!messageContent) {
    return null;
  }

  const messageType = Object.keys(messageContent)[0];
  if (!messageType) {
    return null;
  }

  // Ignore protocol messages, keep-alives, senderKeyDistributionMessage, etc.
  const ignoredTypes = ['protocolMessage', 'senderKeyDistributionMessage', 'reactionMessage'];
  if (ignoredTypes.includes(messageType)) {
    return null;
  }

  let ts = Date.now();
  if (msg.messageTimestamp) {
    const rawTs = msg.messageTimestamp;
    const numTs = typeof rawTs === 'object' && typeof rawTs.toNumber === 'function'
      ? rawTs.toNumber()
      : Number(rawTs);
    if (!isNaN(numTs)) {
      ts = numTs * 1000;
    }
  }

  const parsed = {
    id: msg.key.id,
    chatId: msg.key.remoteJid,
    senderNumber: msg.key.remoteJid.split('@')[0],
    senderName: msg.pushName || 'Unknown Contact',
    timestamp: ts,
    text: '',
    isMedia: false,
    mediaType: null,
    mediaInfo: null,
    quoted: null,
  };

  // Extract quoted message context
  const contextInfo = messageContent[messageType]?.contextInfo;
  if (contextInfo?.quotedMessage) {
    const quotedMsg = contextInfo.quotedMessage;
    const quotedType = Object.keys(quotedMsg)[0];
    let quotedText = '';

    if (quotedType === 'conversation') {
      quotedText = quotedMsg.conversation;
    } else if (quotedType === 'extendedTextMessage') {
      quotedText = quotedMsg.extendedTextMessage.text;
    } else if (quotedType === 'imageMessage') {
      quotedText = `[Image] ${quotedMsg.imageMessage.caption || ''}`;
    } else if (quotedType === 'documentMessage') {
      quotedText = `[Document] ${quotedMsg.documentMessage.fileName || quotedMsg.documentMessage.title || ''}`;
    } else {
      quotedText = `[Quoted ${quotedType}]`;
    }

    parsed.quoted = {
      id: contextInfo.stanzaId,
      sender: contextInfo.participant,
      text: quotedText,
    };
  }

  // Handle specific message types
  if (messageType === 'conversation') {
    parsed.text = messageContent.conversation;
  } else if (messageType === 'extendedTextMessage') {
    parsed.text = messageContent.extendedTextMessage.text;
  } else if (messageType === 'imageMessage') {
    parsed.isMedia = true;
    parsed.mediaType = 'image';
    parsed.text = messageContent.imageMessage.caption || '';
    parsed.mediaInfo = {
      type: 'image',
      caption: messageContent.imageMessage.caption || '',
      mimeType: messageContent.imageMessage.mimetype,
      filename: 'image.jpg',
    };
  } else if (messageType === 'documentMessage') {
    parsed.isMedia = true;
    parsed.mediaType = 'document';
    parsed.text = messageContent.documentMessage.caption || '';
    parsed.mediaInfo = {
      type: 'document',
      caption: messageContent.documentMessage.caption || '',
      mimeType: messageContent.documentMessage.mimetype,
      filename: messageContent.documentMessage.fileName || 'document',
    };
  } else {
    // Other unsupported media types (video, audio, sticker)
    parsed.isMedia = true;
    parsed.mediaType = messageType;
    parsed.text = `[Unsupported Message Type: ${messageType}]`;
    parsed.mediaInfo = {
      type: messageType,
      caption: '',
      filename: 'file',
    };
  }

  // Log message parsing
  waLogger.debug(`Parsed inbound message from ${parsed.senderName} (${parsed.senderNumber}): "${parsed.text}"`);

  return parsed;
}

module.exports = {
  parseIncomingMessage,
};
