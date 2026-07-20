const Groq = require('groq-sdk');
const config = require('../config');
const aiLogger = require('../utils/logger').ai;

let groqClient = null;
try {
  groqClient = new Groq({
    apiKey: config.groq.apiKey,
  });
} catch (error) {
  aiLogger.error('Failed to initialize Groq client:', error);
}

// Configurable system prompt
const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant communicating through WhatsApp. Respond naturally and conversationally. Match the user's language when possible, including English, Hindi, Urdu, or Hinglish. Keep answers concise unless the user asks for detail. Never claim to be human.`;

const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;

async function generateAIResponse(waChatId, newMsgText, history = []) {
  if (!groqClient) {
    aiLogger.error('Groq client is not initialized');
    return null;
  }

  aiLogger.info(`Generating AI response for chat: ${waChatId}`);
  
  try {
    // Format messages for Groq API
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      { role: 'user', content: newMsgText }
    ];

    aiLogger.debug(`Sending prompt to Groq with model: ${config.groq.model}`);

    const response = await groqClient.chat.completions.create({
      messages,
      model: config.groq.model,
      temperature: 0.7,
      max_tokens: 800,
    });

    const aiReply = response.choices[0]?.message?.content?.trim();
    if (!aiReply) {
      aiLogger.error(`Empty response received from Groq for chat ${waChatId}`);
      return null;
    }

    aiLogger.info(`AI response successfully generated for chat: ${waChatId}`);
    return aiReply;
  } catch (error) {
    aiLogger.error(`Groq API error for chat ${waChatId}:`, error);
    return null; // Return null so caller handles error notification
  }
}

module.exports = {
  generateAIResponse,
  SYSTEM_PROMPT,
};
