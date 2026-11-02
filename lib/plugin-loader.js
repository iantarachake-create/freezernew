// Loads every plugins/*.js. A broken plugin never takes the bot down; it is reported instead.
const fs = require('fs');
const path = require('path');
const events = require('../command');
const log = require('./logger').make('plugins');
const DIR = path.join(__dirname, '..', 'plugins');

let index = new Map();
const failed = [];
const duplicates = [];

// commands that affect the whole server (every session) -> only the global OWNER_NUMBER may run them
const SUPER_ONLY = new Set(['install', 'deleteplugin', 'restart', 'shutdown', 'sessions', 'reloadplugins']);

function rebuild() {
    index = new Map(); duplicates.length = 0;
    for (const c of events.commands) {
        if (c.on) continue;
        for (const name of [c.pattern, ...(c.alias || [])].filter(Boolean).map(s => String(s).toLowerCase())) {
            if (index.has(name) && index.get(name) !== c) duplicates.push(name); else index.set(name, c);
        }
    }
}

function load() {
    events.commands.length = 0; failed.length = 0;
    const files = fs.readdirSync(DIR).filter(f => f.endsWith('.js')).sort();
    for (const f of files) {
        const p = path.join(DIR, f);
        try { delete require.cache[require.resolve(p)]; require(p); }
        catch (e) { failed.push({ file: f, error: e.message.split('\n')[0] }); log.warn(`plugin ${f} skipped: ${e.message.split('\n')[0]}`); }
    }
    for (const c of events.commands) if (SUPER_ONLY.has(String(c.pattern))) c.superuser = true;
    rebuild();
    log.info(`${files.length - failed.length}/${files.length} plugins loaded, ${index.size} command names, ${events.commands.filter(c => c.on).length} event hooks`);
    return { loaded: files.length - failed.length, failed };
}

module.exports = {
    load, reload: load,
    find: (name) => index.get(String(name).toLowerCase()),
    hooks: () => events.commands.filter(c => c.on),
    list: () => events.commands.filter(c => !c.on && !c.dontAddCommandList),
    failed, duplicates
};
