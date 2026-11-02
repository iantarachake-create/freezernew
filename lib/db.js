// Storage backend. Priority: DATABASE_URL (PostgreSQL / Supabase)  >  MONGODB_URI  >  local files.
// One tiny API is exposed so kv.js and auth-state.js do not care which backend is used:
//   kvLoad(ns) kvSet(ns,key,v) kvDel(ns,key)  authRead/authWrite/authDel/authClear/authHas
// If a database IS configured but unreachable we keep retrying (we never silently fall back to
// local files, because on a restart-prone host that would "forget" every linked WhatsApp number).
const log = require('./logger').make('db');

let kind = null;          // 'pg' | 'mongo' | null
let ready = false;
let pool = null;          // pg Pool
let Kv = null, AuthKey = null;   // mongoose models

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const TRANSIENT = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|ENOTFOUND|EAI_AGAIN|terminat|timeout|Connection|too many clients|57P01|08006|08003|53300/i;

// ---------------------------------------------------------------- PostgreSQL
async function connectPg(url) {
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: url,
        ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },   // Supabase needs TLS
        max: Number(process.env.PG_POOL_MAX || 8),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 15_000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10_000,
        allowExitOnIdle: false
    });
    // an idle client dying (Supabase restarts, network blip) must NEVER crash the process
    pool.on('error', (e) => log.warn('pg idle client error (pool will reconnect): ' + e.message));
    await pool.query('select 1');
    await pool.query(`
        create table if not exists bot_kv (
            id text primary key,
            ns text not null,
            v  jsonb
        );
        create index if not exists bot_kv_ns_idx on bot_kv (ns);
        create table if not exists bot_auth (
            n text not null,
            k text not null,
            v text,
            primary key (n, k)
        );`);
}

async function pg(text, params, tries = 4) {
    for (let i = 0; ; i++) {
        try { return await pool.query(text, params); }
        catch (e) {
            if (i >= tries - 1 || !TRANSIENT.test(`${e.code || ''} ${e.message}`)) throw e;
            log.warn(`pg query retry ${i + 1}: ${e.message}`);
            await sleep(500 * 2 ** i);
        }
    }
}

// ---------------------------------------------------------------- MongoDB
async function connectMongo(uri) {
    const mongoose = require('mongoose');
    mongoose.set('strictQuery', false);
    await mongoose.connect(uri, { maxPoolSize: 20, serverSelectionTimeoutMS: 8000 });
    Kv = mongoose.models.Kv || mongoose.model('Kv', new mongoose.Schema({
        _id: String, ns: { type: String, index: true }, v: mongoose.Schema.Types.Mixed
    }, { versionKey: false }));
    AuthKey = mongoose.models.AuthKey || mongoose.model('AuthKey', new mongoose.Schema({
        n: { type: String, index: true }, k: String, v: String
    }, { versionKey: false }).index({ n: 1, k: 1 }, { unique: true }));
}

// ---------------------------------------------------------------- connect (retries until it works)
async function connect({ databaseUrl, mongoUri } = {}) {
    if (!databaseUrl && !mongoUri) { log.info('No DATABASE_URL / MONGODB_URI set -> using local file storage'); return false; }
    kind = databaseUrl ? 'pg' : 'mongo';
    for (let attempt = 1; ; attempt++) {
        try {
            if (kind === 'pg') await connectPg(databaseUrl); else await connectMongo(mongoUri);
            ready = true;
            log.info(kind === 'pg' ? 'PostgreSQL (Supabase) connected' : 'MongoDB connected');
            return true;
        } catch (e) {
            if (pool) { try { await pool.end(); } catch {} pool = null; }
            const wait = Math.min(2000 * 2 ** Math.min(attempt, 4), 30_000);
            log.error(`${kind} connection failed (attempt ${attempt}): ${e.message} - retrying in ${wait / 1000}s`);
            await sleep(wait);
        }
    }
}

async function ping() {
    if (!ready) return null;
    try { if (kind === 'pg') await pool.query('select 1'); else await Kv.db.command({ ping: 1 }); return true; }
    catch { return false; }
}

// ---------------------------------------------------------------- kv API
async function kvLoad(ns) {
    if (kind === 'pg') {
        const r = await pg('select id, v from bot_kv where ns = $1', [ns]);
        return r.rows.map(x => [x.id.slice(ns.length + 1), x.v]);
    }
    const rows = await Kv.find({ ns }).lean();
    return rows.map(x => [x._id.slice(ns.length + 1), x.v]);
}
async function kvSet(ns, key, v) {
    const id = `${ns}:${key}`;
    if (kind === 'pg') return pg('insert into bot_kv (id, ns, v) values ($1,$2,$3::jsonb) on conflict (id) do update set v = excluded.v', [id, ns, JSON.stringify(v === undefined ? null : v)]);
    return Kv.updateOne({ _id: id }, { ns, v }, { upsert: true });
}
async function kvDel(ns, key) {
    const id = `${ns}:${key}`;
    if (kind === 'pg') return pg('delete from bot_kv where id = $1', [id]);
    return Kv.deleteOne({ _id: id });
}

// ---------------------------------------------------------------- WhatsApp auth API (values are JSON strings)
async function authRead(n, k) {
    if (kind === 'pg') { const r = await pg('select v from bot_auth where n = $1 and k = $2', [n, k]); return r.rows[0]?.v ?? null; }
    const d = await AuthKey.findOne({ n, k }).lean(); return d ? d.v : null;
}
async function authWrite(n, k, v) {
    if (kind === 'pg') return pg('insert into bot_auth (n, k, v) values ($1,$2,$3) on conflict (n, k) do update set v = excluded.v', [n, k, v]);
    return AuthKey.updateOne({ n, k }, { v }, { upsert: true });
}
async function authDel(n, k) {
    if (kind === 'pg') return pg('delete from bot_auth where n = $1 and k = $2', [n, k]);
    return AuthKey.deleteOne({ n, k });
}
async function authClear(n) {
    if (kind === 'pg') return pg('delete from bot_auth where n = $1', [n]);
    return AuthKey.deleteMany({ n });
}

module.exports = {
    connect, ping, enabled: () => ready, kind: () => kind,
    kvLoad, kvSet, kvDel, authRead, authWrite, authDel, authClear
};
