// Tiny namespaced key-value store (settings, warns, afk, reminders...).
// Memory cache in front; persisted to MongoDB if connected, else to JSON files.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const DIR = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'store');
const cache = new Map();      // ns -> Map(key -> value)
const timers = new Map();     // ns -> flush timer

function file(ns) { return path.join(DIR, ns.replace(/[^a-zA-Z0-9_.-]/g, '_') + '.json'); }

async function load(ns) {
    if (cache.has(ns)) return cache.get(ns);
    const m = new Map();
    if (db.enabled()) {
        for (const [k, v] of await db.kvLoad(ns)) m.set(k, v);
    } else {
        try { Object.entries(JSON.parse(fs.readFileSync(file(ns), 'utf8'))).forEach(([k, v]) => m.set(k, v)); } catch {}
    }
    cache.set(ns, m);
    return m;
}
function flushFile(ns) {
    try {
        fs.mkdirSync(DIR, { recursive: true });
        const tmp = file(ns) + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(cache.get(ns))));
        fs.renameSync(tmp, file(ns));
    } catch (e) { console.error('kv flush failed', ns, e.message); }
}
function schedule(ns) {
    if (timers.has(ns)) return;
    timers.set(ns, setTimeout(() => { timers.delete(ns); flushFile(ns); }, 800));
}

module.exports = {
    async get(ns, key, def = null) { const m = await load(ns); return m.has(key) ? m.get(key) : def; },
    async set(ns, key, value) {
        const m = await load(ns); m.set(key, value);
        if (db.enabled()) await db.kvSet(ns, key, value);
        else schedule(ns);
    },
    async del(ns, key) {
        const m = await load(ns); m.delete(key);
        if (db.enabled()) await db.kvDel(ns, key);
        else schedule(ns);
    },
    async all(ns) { return Object.fromEntries(await load(ns)); },
    async keys(ns) { return [...(await load(ns)).keys()]; },
    flushAll() { for (const [ns, t] of timers) { clearTimeout(t); flushFile(ns); } timers.clear(); }
};
