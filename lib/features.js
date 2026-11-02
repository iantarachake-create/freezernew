// Built-in, session-aware features. Every function receives the Session object.
const kv = require('./kv');
const config = require('../config');
const log = require('./logger').make('features');
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ---------- status automation ----------
async function onStatus(s, mek) {
    const c = s.sock;
    const view = config.AUTO_VIEW_STATUS === 'true' || config.AUTO_STATUS_SEEN === 'true';
    const like = config.AUTO_LIKE_STATUS === 'true' || config.AUTO_STATUS_REACT === 'true';
    if (mek.key.fromMe) return;
    if (view) await c.readMessages([mek.key]).catch(() => {});
    if (like && mek.key.participant) {
        const emojis = Array.isArray(config.AUTO_LIKE_EMOJI) && config.AUTO_LIKE_EMOJI.length ? config.AUTO_LIKE_EMOJI : ['❤️'];
        await c.sendMessage('status@broadcast', { react: { text: pick(emojis), key: mek.key } },
            { statusJidList: [mek.key.participant, c.decodeJid(c.user.id)] }).catch(() => {});
    }
    if (config.AUTO_STATUS_REPLY === 'true' && mek.key.participant) {
        await c.sendMessage(mek.key.participant, { text: config.AUTO_STATUS_MSG }, { quoted: mek }).catch(() => {});
    }
}

// ---------- anti-call ----------
async function onCall(s, calls) {
    if (config.ANTI_CALL !== 'true') return;
    for (const call of calls) {
        if (call.status !== 'offer') continue;
        try {
            await s.sock.rejectCall(call.id, call.from);
            await s.sock.sendMessage(call.from, { text: config.REJECT_MSG });
        } catch (e) { log.warn(`[${s.number}] anti-call failed: ${e.message}`); }
    }
}

// ---------- anti-delete ----------
async function onRevoke(s, mek) {
    if (config.ANTI_DELETE !== 'true') return;
    const pm = mek.message?.protocolMessage;
    if (!pm || pm.type !== 0 || !pm.key) return;
    const original = s.cache.get({ remoteJid: pm.key.remoteJid || mek.key.remoteJid, id: pm.key.id });
    if (!original || original.key.fromMe) return;
    const chat = original.key.remoteJid;
    const who = original.key.participant || chat;
    const target = config.ANTI_DELETE_PATH === 'chat' ? chat : s.sock.decodeJid(s.sock.user.id);
    const where = chat.endsWith('@g.us') ? 'group' : 'private chat';
    try {
        await s.sock.sendMessage(target, {
            text: `🚫 *ANTI-DELETE*\n👤 @${who.split('@')[0]} deleted a message in a ${where}\n🕒 ${new Date().toLocaleString()}`,
            mentions: [who]
        });
        await s.sock.sendMessage(target, { forward: original }, { quoted: original });
    } catch (e) { log.warn(`[${s.number}] anti-delete failed: ${e.message}`); }
}

// ---------- anti-spam (sliding window per sender) ----------
const WINDOW = 10_000, LIMIT = 6;
function allowCommand(s, sender) {
    const now = Date.now();
    const arr = (s.rate.get(sender) || []).filter(t => now - t < WINDOW);
    arr.push(now); s.rate.set(sender, arr);
    if (arr.length <= LIMIT) return 'ok';
    return arr.length === LIMIT + 1 ? 'warn' : 'drop';
}

// ---------- AFK ----------
async function afkCheck(s, mek, ctx) {
    const ns = `afk:${s.number}`;
    const mine = await kv.get(ns, ctx.sender);
    if (mine && !(ctx.isCmd && ctx.command === 'afk')) {
        await kv.del(ns, ctx.sender);
        const mins = Math.max(1, Math.round((Date.now() - mine.since) / 60000));
        await ctx.reply(`👋 Welcome back @${ctx.senderNumber}! You were AFK for ${mins} min.`, { mentions: [ctx.sender] });
    }
    if (!ctx.isGroup) return;
    const targets = new Set([...(mek.mentionedJid || []), ...(mek.quoted ? [mek.quoted.sender] : [])]);
    for (const jid of targets) {
        const a = await kv.get(ns, jid);
        if (a) {
            const mins = Math.max(1, Math.round((Date.now() - a.since) / 60000));
            await ctx.reply(`💤 @${jid.split('@')[0]} is AFK (${mins} min ago)${a.reason ? `: ${a.reason}` : ''}`, { mentions: [jid] });
        }
    }
}

// ---------- group activity (for leaderboard) ----------
const activity = new Map();   // `${number}` -> Map(group -> Map(jid -> n))
let dirty = new Set();
function track(s, chat, sender) {
    if (!chat.endsWith('@g.us')) return;
    let g = activity.get(s.number); if (!g) activity.set(s.number, g = new Map());
    let m = g.get(chat); if (!m) g.set(chat, m = new Map());
    m.set(sender, (m.get(sender) || 0) + 1);
    dirty.add(s.number);
}
async function topActive(number, chat, n = 10) {
    const saved = await kv.get(`activity:${number}`, chat, {});
    const live = activity.get(number)?.get(chat);
    const merged = { ...saved };
    if (live) for (const [j, c] of live) merged[j] = (merged[j] || 0) + c;
    return Object.entries(merged).sort((a, b) => b[1] - a[1]).slice(0, n);
}
async function flushActivity() {
    const batch = dirty; dirty = new Set();
    for (const number of batch) {
        const g = activity.get(number); if (!g) continue;
        for (const [chat, m] of g) {
            const saved = await kv.get(`activity:${number}`, chat, {});
            for (const [j, c] of m) saved[j] = (saved[j] || 0) + c;
            await kv.set(`activity:${number}`, chat, saved);
        }
        activity.delete(number);
    }
}
setInterval(() => flushActivity().catch(() => {}), 60_000).unref();

module.exports = { onStatus, onCall, onRevoke, allowCommand, afkCheck, track, topActive, flushActivity };
