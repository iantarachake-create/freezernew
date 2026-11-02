// Per-session settings (only OVERRIDES of config.js defaults are stored).
const kv = require('./kv');
const config = require('../config');
const NS = 'settings';

// what `.settings` shows / `.set` accepts: key -> [type, description]
const SCHEMA = {
    PREFIX: ['text', 'Command prefix'],
    MODE: ['enum:public,private,group,inbox', 'Who can use the bot'],
    ANTI_DELETE: ['bool', 'Re-send deleted messages'],
    ANTI_DELETE_PATH: ['enum:owner,chat', 'Where deleted messages go'],
    ANTI_CALL: ['bool', 'Reject incoming calls'],
    ANTI_SPAM: ['bool', 'Rate-limit command spam'],
    ANTI_LINK: ['bool', 'Link protection in groups'],
    ANTI_LINK_MODE: ['enum:warn,delete,kick', 'What to do with links'],
    ANTI_BAD_WORD: ['bool', 'Bad word filter'],
    AUTO_VIEW_STATUS: ['bool', 'Auto view statuses'],
    AUTO_LIKE_STATUS: ['bool', 'Auto react to statuses'],
    AUTO_STATUS_REPLY: ['bool', 'Auto reply to statuses'],
    AUTO_STATUS_MSG: ['text', 'Status reply text'],
    AUTO_TYPING: ['bool', 'Show typing'],
    AUTO_RECORDING: ['bool', 'Show recording'],
    ALWAYS_ONLINE: ['bool', 'Always online'],
    READ_MESSAGE: ['bool', 'Auto read messages'],
    AUTO_REACT: ['bool', 'Auto react to messages'],
    MENTION_REPLY: ['bool', 'Reply when bot is mentioned'],
    AI_CHATBOT: ['bool', 'AI chatbot in DMs'],
    WELCOME_ENABLE: ['bool', 'Welcome new members'],
    GOODBYE_ENABLE: ['bool', 'Goodbye message'],
    WARN_LIMIT: ['number', 'Warnings before kick'],
    REJECT_MSG: ['text', 'Message sent to rejected callers'],
};

async function load(number) { return { ...(await kv.get(NS, number, {})) }; }
async function save(number, obj) { await kv.set(NS, number, obj); }

function coerce(key, raw) {
    const spec = SCHEMA[key];
    if (!spec) return { error: 'Unknown setting. Use .settings to see all keys.' };
    const [type] = spec; const v = String(raw).trim();
    if (type === 'bool') {
        if (/^(on|true|yes|enable|1)$/i.test(v)) return { value: 'true' };
        if (/^(off|false|no|disable|0)$/i.test(v)) return { value: 'false' };
        return { error: 'Use on/off.' };
    }
    if (type === 'number') return Number.isFinite(+v) && +v >= 0 ? { value: +v } : { error: 'Use a number.' };
    if (type.startsWith('enum:')) {
        const opts = type.slice(5).split(',');
        return opts.includes(v.toLowerCase()) ? { value: v.toLowerCase() } : { error: `Use one of: ${opts.join(', ')}` };
    }
    return v ? { value: v } : { error: 'Value required.' };
}

module.exports = { load, save, SCHEMA, coerce, defaults: (k) => config[k] };
