// Owns every WhatsApp connection. One Session per phone number, fully isolated
// (auth, settings, caches, owner list, stats, reconnect policy).
const EventEmitter = require('events');
const config = require('../config');
const kv = require('./kv');
const ctxStore = require('./context');
const settingsLib = require('./settings');
const MsgCache = require('./msgcache');
const { useAuthState } = require('./auth-state');
const { enhance, cleanTemp } = require('./conn-utils');
const { silent } = require('./logger');
const log = require('./logger').make('sessions');

const clean = (n) => String(n || '').replace(/[^0-9]/g, '');

class Session extends EventEmitter {
    constructor(number) {
        super();
        this.number = number; this.status = 'created'; this.sock = null; this.auth = null;
        this.retries = 0; this.createdAt = Date.now(); this.openedAt = null; this.pairingCode = null; this.lastError = null;
        this.settings = {}; this.sudo = new Set();
        this.cache = new MsgCache(); this.groupCache = new Map(); this.chats = new Set(); this.rate = new Map();
        this.stats = { messages: 0, commands: 0 };
        this.timers = []; this.stateSince = Date.now(); this.stopping = false; this.starting = false; this.myquoted = null;
        const self = this;
        this.ctx = {
            number, session: this,
            get settings() { return self.settings; },
            setSetting(k, v) { self.settings[k] = v; settingsLib.save(number, self.settings).catch(() => {}); }
        };
    }
    run(fn) { return ctxStore.run(this.ctx, fn); }
    info() {
        return { number: this.number, status: this.status, uptime: this.openedAt ? Math.floor((Date.now() - this.openedAt) / 1000) : 0,
            retries: this.retries, messages: this.stats.messages, commands: this.stats.commands, lastError: this.lastError };
    }
}

class SessionManager extends EventEmitter {
    constructor() { super(); this.sessions = new Map(); this.handler = null; this.userStopped = new Set(); }
    get(number) { return this.sessions.get(clean(number)); }
    list() { return [...this.sessions.values()]; }
    connected() { return this.list().filter(s => s.status === 'open'); }

    async start(number, opts = {}) {
        number = clean(number); this.userStopped.delete(number);
        if (!number || number.length < 8 || number.length > 15) throw new Error('Invalid phone number (digits only, with country code).');
        let s = this.sessions.get(number);
        if (s && s.starting) return s;
        if (s && ['open', 'connecting'].includes(s.status) && !opts.force) return s;
        if (!s) {
            if (this.sessions.size >= config.MAX_SESSIONS) throw new Error(`Session limit reached (${config.MAX_SESSIONS}).`);
            s = new Session(number); this.sessions.set(number, s);
        } else await this._teardown(s);
        s.starting = true; s.stopping = false;
        try { await this._connect(s, opts); }
        catch (e) {
            // linked numbers must come back on their own (e.g. database blip) - never leave them dead
            s.lastError = e.message;
            if (!s.stopping && s.auth?.state?.creds?.registered) { s.status = 'reconnecting'; s.stateSince = Date.now(); this._scheduleReconnect(s, 5000); }
            throw e;
        } finally { s.starting = false; }
        return s;
    }

    async _connect(s, opts) {
        const { default: makeWASocket, makeCacheableSignalKeyStore, fetchLatestBaileysVersion, Browsers, delay } = require('@whiskeysockets/baileys');
        s.status = 'connecting'; s.stateSince = Date.now(); s.lastError = null;
        s.auth = await useAuthState(s.number);
        s.settings = await settingsLib.load(s.number);
        s.sudo = new Set(await kv.get('sudo', s.number, []));
        let version; try { ({ version } = await fetchLatestBaileysVersion()); } catch {}

        const sock = makeWASocket({
            version, logger: silent, printQRInTerminal: false, browser: Browsers.macOS('Safari'),
            auth: { creds: s.auth.state.creds, keys: makeCacheableSignalKeyStore(s.auth.state.keys, silent) },
            syncFullHistory: false, markOnlineOnConnect: false,
            keepAliveIntervalMs: 25_000, connectTimeoutMs: 60_000, retryRequestDelayMs: 500, generateHighQualityLinkPreview: false,
            getMessage: async (key) => s.cache.get(key)?.message,
            cachedGroupMetadata: async (jid) => { const h = s.groupCache.get(jid); return h && Date.now() - h.at < 60_000 ? h.data : undefined; }
        });
        s.sock = enhance(sock, s);
        const ev = sock.ev;

        ev.on('creds.update', () => s.auth.saveCreds().catch(e => log.error(`[${s.number}] saveCreds`, e)));

        ev.on('connection.update', (u) => s.run(() => this._onConnection(s, sock, u)));
        ev.on('messages.upsert', (u) => s.run(() => this.handler?.handleUpsert(s, u)));
        ev.on('call', (c) => s.run(() => require('./features').onCall(s, c)));
        ev.on('group-participants.update', (u) => s.run(async () => {
            s.groupCache.delete(u.id);
            try { await require('./group-events').groupEvents(sock, u); } catch (e) { log.warn(`[${s.number}] group event: ${e.message}`); }
        }));
        ev.on('groups.update', (arr) => arr.forEach(g => g.id && s.groupCache.delete(g.id)));

        // first-time link: request a pairing code
        if (!s.auth.state.creds.registered) {
            s.status = 'pairing';
            setTimeout(async () => {
                try {
                    await delay(500);
                    const code = await sock.requestPairingCode(s.number);
                    s.pairingCode = code?.match(/.{1,4}/g)?.join('-') || code;
                    s.emit('code', s.pairingCode);
                    log.info(`[${s.number}] pairing code issued`);
                } catch (e) { s.lastError = e.message; s.emit('code_error', e); log.warn(`[${s.number}] pairing failed: ${e.message}`); }
            }, 2500);
        }
    }

    async _onConnection(s, sock, { connection, lastDisconnect }) {
        if (s.sock !== sock) return;                       // stale socket
        if (connection === 'open') {
            s.status = 'open'; s.stateSince = Date.now(); s.retries = 0; s.openedAt = Date.now(); s.pairingCode = null;
            await kv.set('active', s.number, { since: Date.now() }).catch(() => {});
            s.emit('open');
            log.info(`[${s.number}] connected`);
            this._startLoops(s);
            if (!(await kv.get('welcomed', s.number))) {
                await kv.set('welcomed', s.number, true);
                const jid = sock.decodeJid(sock.user.id);
                await sock.sendMessage(jid, { text: `*✅ ${config.BOT_NAME} connected*\n\n🔑 Prefix: ${config.PREFIX}\n⚙️ Mode: ${config.MODE}\n📖 Send *${config.PREFIX}menu* for all commands\n🛠 Send *${config.PREFIX}settings* to customise this bot (only you can change it)` }).catch(() => {});
            }
        }
        if (connection !== 'close') return;

        const code = lastDisconnect?.error?.output?.statusCode;
        const { DisconnectReason } = require('@whiskeysockets/baileys');
        s.lastError = lastDisconnect?.error?.message || null;
        this._stopLoops(s);
        if (s.stopping) return;

        if (code === DisconnectReason.loggedOut || code === 401) {
            log.warn(`[${s.number}] logged out from phone - removing session`);
            return this._purge(s, 'logged_out');
        }
        if (code === DisconnectReason.connectionReplaced || code === 440) {
            s.status = 'replaced'; log.warn(`[${s.number}] session opened elsewhere - not reconnecting`); return;
        }
        if (s.status === 'pairing' && !s.auth.state.creds.registered && [408, 428, 500].includes(code)) {
            s.status = 'pair_expired'; this._teardown(s); return;
        }
        // 515 right after pairing = normal restart request; anything else: exponential backoff.
        // We NEVER give up: after the fast attempts we keep retrying every ~60s (10 min if WhatsApp says 403/forbidden).
        const immediate = code === DisconnectReason.restartRequired || code === 515;
        let wait = immediate ? 500 : Math.min(2000 * 2 ** Math.min(s.retries, 5), 60_000) + Math.floor(Math.random() * 1000);
        if (code === 403) wait = 600_000;
        if (!immediate) s.retries++;
        s.status = 'reconnecting'; s.stateSince = Date.now();
        log.warn(`[${s.number}] closed (${code ?? 'unknown'}), reconnecting in ${Math.round(wait / 1000)}s (attempt ${s.retries})`);
        this._scheduleReconnect(s, wait);
    }

    _scheduleReconnect(s, wait) {
        clearTimeout(s._retryTimer); s.retryAt = Date.now() + wait;
        s._retryTimer = setTimeout(async () => {
            if (s.stopping || this.sessions.get(s.number) !== s) return;
            try { await this.start(s.number, { force: true }); }
            catch (e) {
                // e.g. the database was briefly unreachable: schedule another try instead of leaving the session dead
                s.lastError = e.message; s.retries++; s.status = 'reconnecting'; s.stateSince = Date.now();
                log.error(`[${s.number}] reconnect failed: ${e.message}`);
                this._scheduleReconnect(s, Math.min(2000 * 2 ** Math.min(s.retries, 5), 60_000));
            }
        }, wait);
    }

    // ---- watchdog: heals anything the event-driven reconnect missed ----
    startWatchdog() {
        if (this._wd) return;
        this._wd = setInterval(() => this._watchdog().catch(e => log.error('watchdog: ' + e.message)), 60_000);
        this._wd.unref?.();
    }
    async _watchdog() {
        const now = Date.now();
        for (const s of this.list()) {
            if (s.stopping || s.starting) continue;
            const age = now - (s.stateSince || now);
            // socket looks open to us but the websocket underneath is dead
            if (s.status === 'open') {
                const ws = s.sock?.ws;
                const alive = !ws ? true : (typeof ws.isOpen === 'boolean' ? ws.isOpen : (ws.readyState === undefined ? true : ws.readyState === 1));
                const rs = ws?.readyState;
                if (s.sock && !alive) {
                    s._deadChecks = (s._deadChecks || 0) + 1;
                    if (s._deadChecks >= 2) { s._deadChecks = 0; log.warn(`[${s.number}] websocket dead (state ${rs}) - restarting`); this.start(s.number, { force: true }).catch(e => log.error(`[${s.number}] ${e.message}`)); }
                } else s._deadChecks = 0;
                continue;
            }
            // a retry that should have fired long ago, or a connect that never finished
            const overdue = s.status === 'reconnecting' && now > (s.retryAt || 0) + 120_000;
            const stuck = (s.status === 'connecting' && age > 300_000) || s.status === 'failed';
            if (overdue || stuck) {
                log.warn(`[${s.number}] stuck in '${s.status}' for ${Math.round(age / 1000)}s - restarting`);
                this.start(s.number, { force: true }).catch(e => log.error(`[${s.number}] ${e.message}`));
            }
        }
        // sessions that should be running but are missing from memory (a failed restore, a crashed start...)
        const want = await kv.keys('active').catch(() => []);
        for (const n of want) {
            if (!this.sessions.has(n) && !this.userStopped.has(n)) { log.warn(`[${n}] marked active but not running - starting`); await this.start(n).catch(e => log.error(`[${n}] ${e.message}`)); await new Promise(r => setTimeout(r, 1500)); }
        }
    }

    _startLoops(s) {
        this._stopLoops(s);
        s.timers.push(setInterval(() => s.run(() => {
            if (config.ALWAYS_ONLINE === 'true') s.sock?.sendPresenceUpdate('available').catch(() => {});
        }), 30_000));
        s.timers.push(setInterval(() => { const now = Date.now(); for (const [k, v] of s.rate) if (!v.length || now - v[v.length - 1] > 60_000) s.rate.delete(k); }, 120_000));
    }
    _stopLoops(s) { s.timers.forEach(clearInterval); s.timers = []; }

    async _teardown(s) {
        clearTimeout(s._retryTimer); this._stopLoops(s);
        const sock = s.sock; s.sock = null;
        if (sock) { try { sock.ev.removeAllListeners(); } catch {} try { sock.end(undefined); } catch {} try { sock.ws?.close(); } catch {} }
    }
    async _purge(s, status) {
        await this._teardown(s);
        try { await s.auth?.clear(); } catch {}
        await kv.del('active', s.number).catch(() => {}); await kv.del('welcomed', s.number).catch(() => {});
        s.status = status; this.sessions.delete(s.number); s.emit('close', status);
    }

    // stop the connection but keep credentials (resumes on next boot)
    async stop(number) {
        const s = this.get(number); if (!s) return false;
        s.stopping = true; this.userStopped.add(s.number); await this._teardown(s); s.status = 'stopped'; this.sessions.delete(s.number); return true;
    }
    // log the device out and delete everything
    async logout(number) {
        number = clean(number); let s = this.get(number);
        if (!s) { try { (await useAuthState(number)).clear(); } catch {} await kv.del('active', number); return true; }
        s.stopping = true;
        try { await s.sock?.logout(); } catch {}
        await this._purge(s, 'logged_out'); return true;
    }

    // returns a pairing code for a number that is not linked yet
    async pair(number) {
        number = clean(number);
        const existing = this.get(number);
        if (existing?.status === 'open') throw new Error('This number is already connected.');
        if (config.ALLOWED_NUMBERS.length && !config.ALLOWED_NUMBERS.includes(number)) throw new Error('This number is not allowed to pair on this server.');
        if (existing) { await this._purge(existing, 'restart'); }
        const s = await this.start(number);
        if (s.status !== 'pairing') return { status: s.status };
        if (s.pairingCode) return { code: s.pairingCode };
        const code = await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('Timed out waiting for WhatsApp. Try again.')), 30_000);
            s.once('code', c => { clearTimeout(t); resolve(c); });
            s.once('code_error', e => { clearTimeout(t); reject(e); });
        });
        return { code };
    }

    async restoreAll() {
        const nums = new Set(await kv.keys('active'));
        const fs = require('fs'); const { SESS_DIR } = require('./auth-state');
        if (!require('./db').enabled()) { try { fs.readdirSync(SESS_DIR).filter(n => /^\d+$/.test(n) && fs.existsSync(`${SESS_DIR}/${n}/creds.json`)).forEach(n => nums.add(n)); } catch {} }
        log.info(`restoring ${nums.size} session(s)`);
        for (const n of nums) {
            try { await this.start(n); } catch (e) { log.error(`[${n}] restore failed: ${e.message}`); }
            await new Promise(r => setTimeout(r, 1500));    // stagger to avoid WhatsApp rate limits
        }
    }

    summary() {
        const list = this.list();
        return { total: list.length, connected: list.filter(s => s.status === 'open').length, max: config.MAX_SESSIONS,
            messages: list.reduce((a, s) => a + s.stats.messages, 0), commands: list.reduce((a, s) => a + s.stats.commands, 0),
            memoryMB: Math.round(process.memoryUsage().rss / 1048576), uptime: Math.floor(process.uptime()) };
    }
    async shutdown() { for (const s of this.list()) { s.stopping = true; await this._teardown(s); } }
}

const manager = new SessionManager();
setInterval(cleanTemp, 15 * 60 * 1000).unref();
module.exports = manager;
