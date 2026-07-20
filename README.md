# WhatsApp-Telegram Bridge

A production-quality Node.js application that bridges your personal WhatsApp account with a Telegram Bot. It supports forwarding WhatsApp DMs to a Telegram admin console, replying to them directly from Telegram, and optional AI auto-replies powered by Groq and Llama.

---

## Architecture Flow

```
  WhatsApp User
       ↕
  WhatsApp Web (via Baileys)
       ↕
  Node.js Bridge App (SQLite Session & DB)
    ↙        ↘
Telegram Bot   Groq AI (Llama 3.3)
```

---

## Features

- **No WhatsApp Business API Required:** Uses WhatsApp Web interface matching your normal phone app.
- **Bi-directional Chats:** Forward DMs to Telegram admin, reply to them from Telegram to send back to the WhatsApp user.
- **Idempotency & Deduplication:** Protects against duplicate forwards and AI reply loops.
- **Groq & Llama Integration:** Generates automatic context-aware replies using short-term conversation memory.
- **Manual Takeover:** Temporarily pauses AI auto-replies for a specific user as soon as you reply manually.
- **Persistent Sessions:** SQLite-based database storage and Multi-File auth credentials ensure you don't scan the QR code on every restart.
- **Defensive Rate Limiting:** Outbound message queue prevents spam bans and respects API limit rates.

---

## Setup Instructions

### 1. Requirements
- Node.js version `20.x` or higher.
- A personal WhatsApp account active on a mobile device.

### 2. Installation
Clone this repository to your local system and install dependencies:
```bash
npm install
```

### 3. Telegram Bot Setup
1. Open Telegram and search for [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow the steps to create a bot.
3. Note the generated **HTTP API Token** (e.g. `8907454340:AAE...`).
4. Set the Telegram Bot to allow replies (disabled by default in privacy settings if you want to use it in groups, but since this is a 1-on-1 private bridge, default settings work perfectly).

### 4. Finding your Telegram Admin ID
1. Search Telegram for [@userinfobot](https://t.me/userinfobot) or [@MissRose_bot](https://t.me/MissRose_bot).
2. Send `/start` or `/id` to get your numeric Telegram ID (e.g., `5961841409`).
3. Set this ID in the `TELEGRAM_ADMIN_IDS` configuration.

### 5. Groq API Configuration
1. Register/Login at [console.groq.com](https://console.groq.com).
2. Create an API Key in the "API Keys" section.
3. Configure `GROQ_API_KEY` and set `GROQ_MODEL` (e.g., `llama-3.3-70b-versatile`).

### 6. Environment Configuration
The project is already pre-configured with a `.env` file copied from `.env.example`. Make sure the following keys in `.env` match your configuration:
```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_ADMIN_IDS=your_telegram_numeric_id_comma_separated
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=llama-3.3-70b-versatile
AI_ENABLED=true
```

---

## Running the Application

### Development Mode (with Live Reloading)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

### First-Run WhatsApp Authentication
Upon first launch, the console will print a **QR Code**. 
1. Open WhatsApp on your phone.
2. Tap **Settings** -> **Linked Devices** -> **Link a Device**.
3. Point your phone camera to the terminal to scan the QR Code.
4. Once connected, your session will be saved in the `./auth` directory. You will not need to authenticate again.

*Note: If scanning a QR is not possible, uncomment and set `WA_PHONE_NUMBER=your_number_with_country_code` (e.g., `919876543210` with no `+`) in `.env`. The app will print an 8-digit **Pairing Code** in the logs which you can enter in WhatsApp Linked Devices.*

---

## Commands Reference

Use these commands directly in your Telegram Bot admin chat:

- `/status` — Displays connection state for WhatsApp, Telegram, AI mode toggle, Groq configuration, queue status, and system uptime.
- `/ai_on` — Globally enables AI auto-replies for all incoming WhatsApp chats.
- `/ai_off` — Globally disables AI auto-replies. Incoming messages will still forward, allowing manual reply.
- `/chats` — Lists all active chats with their individual AI settings (e.g. Active, Paused, or Blocked).
- `/help` — Displays command list.

---

## Interactive Controls (Inline Keyboard)

Each forwarded message contains interactive buttons:
- **Pause AI / Resume AI**: Toggles manual takeover for that specific conversation.
- **Block AI / Unblock AI**: Prevents the AI from replying to this chat even if AI is globally ON.
- **Status**: Returns the AI state of the specific contact.

---

## Troubleshooting

- **WhatsApp Reconnection Loops:** The application is designed to reconnect with exponential backoff on network failures. If you get logged out, it terminates reconnect attempts and logs `Logged out from WhatsApp. Re-authentication is required!`. Delete the `./auth` directory to reset your credentials.
- **AI replies are slow:** Groq delivers extremely low latency inference. If you notice delays, verify your network status and API key quotas.
- **App crashes on startup:** Double-check your `.env` formatting and verify no duplicate instances of the application are running on the same port/host.
