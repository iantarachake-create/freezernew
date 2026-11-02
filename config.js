// Global defaults. NO secrets live here - everything comes from environment variables (.env).
// The exported object is a Proxy: inside a session's context, reads return that session's
// own override (if any), writes are saved for that session only. Plugins keep using
// `config.X` exactly as before and automatically become multi-session aware.
const fs = require('fs');
const path = require('path');
try { if (fs.existsSync(path.join(__dirname, '.env'))) require('dotenv').config({ path: path.join(__dirname, '.env') }); } catch {}
const ctx = require('./lib/context');

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const bool = (k, d = 'false') => String(env(k, d)).toLowerCase() === 'true' ? 'true' : 'false';
const owners = String(env('OWNER_NUMBER', '')).split(',').map(s => s.replace(/[^0-9]/g, '')).filter(Boolean);

const base = {
    // identity
    BOT_NAME: env('BOT_NAME', 'FREEEZER MD'),
    BOT: env('BOT_NAME', 'FREEEZER MD'),
    BOT_FOOTER: env('BOT_FOOTER', '© ᴘᴏᴡᴇʀᴇᴅ ʙʏ freeezer'),
    OWNER_NAME: env('OWNER_NAME', 'Freeezer'),
    OWNER_NUMBER: owners.join(','),
    OWNER_NUMBERS: owners,
    DEV: owners[0] || '',
    DESCRIPTION: env('DESCRIPTION', '© freeezer'),
    STICKER_NAME: env('STICKER_NAME', 'FREEEZER'),
    PREFIX: env('PREFIX', '.'),
    MODE: env('MODE', env('WORK_TYPE', 'public')),   // public | private | group | inbox
    get WORK_TYPE() { return this.MODE; },
    PUBLIC_MODE: bool('PUBLIC_MODE', 'true'),

    // status automation
    AUTO_VIEW_STATUS: bool('AUTO_VIEW_STATUS'),
    AUTO_STATUS_SEEN: bool('AUTO_STATUS_SEEN'),
    AUTO_LIKE_STATUS: bool('AUTO_LIKE_STATUS'),
    AUTO_STATUS_REACT: bool('AUTO_STATUS_REACT'),
    AUTO_LIKE_EMOJI: ['❤️', '🌹', '✨', '🥰', '😍', '💞', '💕', '☺️', '🤗'],
    AUTO_STATUS_REPLY: bool('AUTO_STATUS_REPLY'),
    AUTO_STATUS_MSG: env('AUTO_STATUS_MSG', '🤗'),

    // chat
    READ_MESSAGE: bool('READ_MESSAGE'),
    READ_CMD: bool('READ_CMD'),
    AUTO_TYPING: bool('AUTO_TYPING'),
    AUTO_RECORDING: bool('AUTO_RECORDING'),
    ALWAYS_ONLINE: bool('ALWAYS_ONLINE'),
    AUTO_REACT: bool('AUTO_REACT'),
    CUSTOM_REACT: bool('CUSTOM_REACT'),
    CUSTOM_REACT_EMOJIS: env('CUSTOM_REACT_EMOJIS', '💝,💖,💗,❤️‍🔥,🩷,🧡,💛,💚'),
    AUTO_STICKER: bool('AUTO_STICKER'),
    AUTO_REPLY: bool('AUTO_REPLY'),
    MENTION_REPLY: bool('MENTION_REPLY'),
    AI_CHATBOT: bool('AI_CHATBOT'),

    // protection
    ANTI_DELETE: bool('ANTI_DELETE'),
    ANTI_DELETE_PATH: env('ANTI_DELETE_PATH', 'owner'),  // owner | chat
    ANTI_CALL: bool('ANTI_CALL'),
    REJECT_MSG: env('REJECT_MSG', '*📵 Calls are not allowed, please send a message instead.*'),
    ANTI_SPAM: bool('ANTI_SPAM', 'true'),
    ANTI_LINK: bool('ANTI_LINK'),
    ANTI_LINK_MODE: env('ANTI_LINK_MODE', 'warn'),    // warn | delete | kick
    ANTI_LINK_KICK: bool('ANTI_LINK_KICK'),
    DELETE_LINKS: bool('DELETE_LINKS'),
    ANTI_BAD_WORD: bool('ANTI_BAD_WORD'),
    WARN_LIMIT: Number(env('WARN_LIMIT', 3)),

    // groups
    WELCOME_ENABLE: bool('WELCOME_ENABLE'),
    GOODBYE_ENABLE: bool('GOODBYE_ENABLE'),
    WELCOME: bool('WELCOME'),
    ADMIN_EVENTS: bool('ADMIN_EVENTS'),
    WELCOME_MSG: env('WELCOME_MSG', null),
    GOODBYE_MSG: env('GOODBYE_MSG', null),
    WELCOME_IMAGE: env('WELCOME_IMAGE', null),
    GOODBYE_IMAGE: env('GOODBYE_IMAGE', null),
    GROUP_INVITE_LINK: env('GROUP_INVITE_LINK', ''),

    // media / links
    IMAGE_PATH: env('IMAGE_PATH', 'https://files.catbox.moe/d1stg5.jpg'),
    MENU_IMAGE_URL: env('MENU_IMAGE_URL', 'https://files.catbox.moe/d1stg5.jpg'),
    CHANNEL_LINK: env('CHANNEL_LINK', ''),
    LIVE_MSG: env('LIVE_MSG', '> Bot is alive'),

    // infrastructure (global only)
    DATABASE_URL: env('DATABASE_URL', env('SUPABASE_DB_URL', '')),   // PostgreSQL / Supabase (preferred)
    MONGODB_URI: env('MONGODB_URI', ''),
    PORT: Number(env('PORT', 8000)),
    MAX_SESSIONS: Number(env('MAX_SESSIONS', 50)),
    ADMIN_TOKEN: env('ADMIN_TOKEN', ''),
    PUBLIC_PAIRING: bool('PUBLIC_PAIRING', 'true'),
    ALLOWED_NUMBERS: String(env('ALLOWED_NUMBERS', '')).split(',').map(s => s.replace(/[^0-9]/g, '')).filter(Boolean),

    // AI (any OpenAI-compatible endpoint)
    AI_API_URL: env('AI_API_URL', 'https://api.openai.com/v1/chat/completions'),
    AI_API_KEY: env('AI_API_KEY', ''),
    AI_MODEL: env('AI_MODEL', 'gpt-4o-mini'),
    AI_SYSTEM: env('AI_SYSTEM', 'You are a helpful, concise WhatsApp assistant.'),
};

// keys that must never be overridden per session
const GLOBAL_ONLY = new Set(['DATABASE_URL', 'MONGODB_URI', 'PORT', 'MAX_SESSIONS', 'ADMIN_TOKEN', 'PUBLIC_PAIRING', 'ALLOWED_NUMBERS',
    'OWNER_NUMBERS', 'AI_API_KEY', 'AI_API_URL']);

module.exports = new Proxy(base, {
    get(target, key) {
        const s = ctx.store();
        if (s && s.settings && typeof key === 'string' && !GLOBAL_ONLY.has(key) && Object.prototype.hasOwnProperty.call(s.settings, key)) {
            return s.settings[key];
        }
        return Reflect.get(target, key);
    },
    set(target, key, value) {
        const s = ctx.store();
        if (s && s.setSetting && typeof key === 'string' && !GLOBAL_ONLY.has(key)) { s.setSetting(key, value); return true; }
        target[key] = value;
        return true;
    },
    has(target, key) { return key in target; }
});
module.exports.GLOBAL_ONLY = GLOBAL_ONLY;
