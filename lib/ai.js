// Minimal OpenAI-compatible chat client with short per-chat memory.
const axios = require('axios');
const config = require('../config');
const memory = new Map();   // key -> { at, msgs: [] }
const TTL = 30 * 60 * 1000, MAX_TURNS = 12;

function mem(key) {
    const m = memory.get(key);
    if (!m || Date.now() - m.at > TTL) { const n = { at: Date.now(), msgs: [] }; memory.set(key, n); return n; }
    m.at = Date.now(); return m;
}
function reset(key) { memory.delete(key); }

async function ask(key, text, { system } = {}) {
    if (!config.AI_API_KEY) throw new Error('AI is not configured. Set AI_API_KEY (and optionally AI_API_URL / AI_MODEL).');
    const m = mem(key);
    m.msgs.push({ role: 'user', content: text });
    if (m.msgs.length > MAX_TURNS * 2) m.msgs.splice(0, m.msgs.length - MAX_TURNS * 2);
    const { data } = await axios.post(config.AI_API_URL, {
        model: config.AI_MODEL,
        messages: [{ role: 'system', content: system || config.AI_SYSTEM }, ...m.msgs],
        temperature: 0.7, max_tokens: 700
    }, { headers: { Authorization: `Bearer ${config.AI_API_KEY}` }, timeout: 45000 });
    const out = data?.choices?.[0]?.message?.content?.trim();
    if (!out) throw new Error('Empty AI response');
    m.msgs.push({ role: 'assistant', content: out });
    return out;
}
setInterval(() => { for (const [k, v] of memory) if (Date.now() - v.at > TTL) memory.delete(k); }, 10 * 60 * 1000).unref();
module.exports = { ask, reset };
