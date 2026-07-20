const { logger } = require('./logger');

class MessageQueue {
  constructor(delayMs = 1500) {
    this.queue = [];
    this.processing = false;
    this.delayMs = delayMs;
  }

  // Add a task (which is an async function returning a promise) to the queue
  async enqueue(task, description = 'unnamed task') {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, description, resolve, reject });
      this.processNext();
    });
  }

  async processNext() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    const { task, description, resolve, reject } = this.queue.shift();

    try {
      logger.debug(`[QUEUE] Processing: ${description}`);
      const result = await task();
      resolve(result);
    } catch (error) {
      logger.error(`[QUEUE] Failed: ${description}`, error);
      reject(error);
    } finally {
      // Delay before the next message
      setTimeout(() => {
        this.processing = false;
        this.processNext();
      }, this.delayMs);
    }
  }

  get length() {
    return this.queue.length;
  }
}

// Singleton instances for whatsapp and telegram outbound messages
const waQueue = new MessageQueue(1500); // 1.5s delay between WhatsApp messages
const tgQueue = new MessageQueue(500);  // 0.5s delay between Telegram messages

module.exports = {
  waQueue,
  tgQueue,
  MessageQueue,
};
