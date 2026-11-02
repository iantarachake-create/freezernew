// Persistent reminders. Survive restarts (stored via kv), delivered by the owning session.
const kv = require('./kv');
const ctxStore = require('./context');
const NS = 'reminders';

async function add(number, item) {
    const list = await kv.get(NS, number, []);
    item.id = Math.random().toString(36).slice(2, 7);
    list.push(item); await kv.set(NS, number, list); return item.id;
}
async function list(number, sender) { return (await kv.get(NS, number, [])).filter(r => !sender || r.sender === sender); }
async function remove(number, id, sender) {
    const l = await kv.get(NS, number, []); const n = l.filter(r => !(r.id === id && r.sender === sender));
    await kv.set(NS, number, n); return n.length !== l.length;
}
async function tick(manager) {
    for (const s of manager.connected()) {
        const l = await kv.get(NS, s.number, []); if (!l.length) continue;
        const now = Date.now(); const due = l.filter(r => r.at <= now);
        if (!due.length) continue;
        await kv.set(NS, s.number, l.filter(r => r.at > now));
        for (const r of due) {
            await ctxStore.run(s.ctx, () => s.sock.sendMessage(r.chat, { text: `⏰ *Reminder* @${r.sender.split('@')[0]}\n${r.text}`, mentions: [r.sender] }).catch(() => {}));
        }
    }
}
// "10m", "2h", "1d", "1h30m"
function parseDuration(str) {
    let ms = 0, any = false;
    for (const [, n, u] of String(str).matchAll(/(\d+)\s*([smhd])/gi)) { any = true; ms += +n * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[u.toLowerCase()]; }
    return any ? ms : null;
}
module.exports = { add, list, remove, tick, parseDuration };
