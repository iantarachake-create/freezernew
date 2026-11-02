const { cmd } = require('../command');
const kv = require('../lib/kv');

cmd({
    pattern: "afk", react: "💤", category: "tools", desc: "Set yourself AFK: .afk [reason]", filename: __filename
}, async (conn, mek, m, { reply, q, sender, session }) => {
    await kv.set(`afk:${session.number}`, sender, { since: Date.now(), reason: q.slice(0, 120) });
    reply(`💤 You are now AFK${q ? `: ${q}` : ''}\nI'll tell people who mention you, and welcome you back when you write again.`);
});
