// Auth state per number. Database (creds AND signal keys; PostgreSQL/Supabase or MongoDB) when configured, otherwise files.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const SESS_DIR = path.join(process.env.SESSIONS_DIR || path.join(__dirname, '..', 'sessions'));

async function fileState(number) {
    const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
    const dir = path.join(SESS_DIR, number);
    fs.mkdirSync(dir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(dir);
    return { state, saveCreds, clear: async () => fs.rmSync(dir, { recursive: true, force: true }), exists: () => fs.existsSync(path.join(dir, 'creds.json')) };
}

async function dbState(number) {
    const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
    const write = (k, v) => db.authWrite(number, k, JSON.stringify(v, BufferJSON.replacer));
    const read = async (k) => { const s = await db.authRead(number, k); return s ? JSON.parse(s, BufferJSON.reviver) : null; };
    const del = (k) => db.authDel(number, k);
    const stored = await read('creds');
    const creds = stored || initAuthCreds();
    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const out = {};
                    await Promise.all(ids.map(async (id) => {
                        let v = await read(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
                        out[id] = v;
                    }));
                    return out;
                },
                set: async (data) => {
                    const jobs = [];
                    for (const cat in data) for (const id in data[cat]) {
                        const v = data[cat][id];
                        jobs.push(v ? write(`${cat}-${id}`, v) : del(`${cat}-${id}`));
                    }
                    await Promise.all(jobs);
                }
            }
        },
        saveCreds: () => write('creds', creds),
        clear: async () => { await db.authClear(number); },
        exists: () => !!stored
    };
}

module.exports = { useAuthState: (number) => (db.enabled() ? dbState(number) : fileState(number)), SESS_DIR };
