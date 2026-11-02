// Bounded per-session message cache (anti-delete, getMessage for retries).
class MsgCache {
    constructor(max = 3000) { this.max = max; this.map = new Map(); }
    key(k) { return `${k.remoteJid}|${k.id}`; }
    set(msg) { if (!msg?.key?.id) return; const k = this.key(msg.key); this.map.delete(k); this.map.set(k, msg); if (this.map.size > this.max) this.map.delete(this.map.keys().next().value); }
    get(key) { return this.map.get(this.key(key)); }
    get size() { return this.map.size; }
}
module.exports = MsgCache;
