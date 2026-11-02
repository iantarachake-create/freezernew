// Web layer: pairing page, JSON API (backwards compatible with /code, /status, /active, /ping), admin dashboard.
const express = require('express');
const path = require('path');
const config = require('../config');
const manager = require('./session-manager');
const log = require('./logger').make('web');

const hits = new Map();   // ip -> [timestamps]
function limited(ip, max = 6, windowMs = 10 * 60_000) {
    const now = Date.now(); const a = (hits.get(ip) || []).filter(t => now - t < windowMs);
    a.push(now); hits.set(ip, a); return a.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 600_000) hits.delete(k); }, 300_000).unref();

function admin(req, res, next) {
    if (!config.ADMIN_TOKEN) return res.status(403).json({ error: 'Admin API disabled. Set ADMIN_TOKEN.' });
    const t = req.get('x-admin-token') || '';
    if (t.length === config.ADMIN_TOKEN.length && require('crypto').timingSafeEqual(Buffer.from(t), Buffer.from(config.ADMIN_TOKEN))) return next();
    res.status(401).json({ error: 'Unauthorized' });
}

function create({ isReady = () => true } = {}) {
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json({ limit: '50kb' }));
    app.use(express.static(path.join(__dirname, '..', 'public')));

    app.get('/health', async (req, res) => {
        const dbs = require('./db');
        res.json({ ok: true, ready: isReady(), db: dbs.kind() ? ((await dbs.ping()) ? 'up' : (dbs.enabled() ? 'down' : 'connecting')) : 'files', ...manager.summary() });
    });
    app.get('/ping', (req, res) => res.json({ pong: true, ts: Date.now() }));

    async function pairHandler(req, res) {
        if (!isReady()) return res.status(503).json({ error: 'Server is starting, try again in a few seconds.' });
        if (config.PUBLIC_PAIRING !== 'true' && !(config.ADMIN_TOKEN && req.get('x-admin-token') === config.ADMIN_TOKEN))
            return res.status(403).json({ error: 'Public pairing is disabled on this server.' });
        if (limited(req.ip)) return res.status(429).json({ error: 'Too many attempts, wait a few minutes.' });
        const number = (req.body?.number || req.query.number || '').toString().replace(/[^0-9]/g, '');
        if (!number) return res.status(400).json({ error: 'number required' });
        try {
            const r = await manager.pair(number);
            res.json(r.code ? { status: 'new_pairing', code: r.code } : { status: r.status });
        } catch (e) { res.status(400).json({ error: e.message }); }
    }
    app.post('/api/pair', pairHandler);
    app.get('/code', pairHandler);                     // old route kept for existing pair pages / .pair command

    app.get('/status', (req, res) => {
        const n = (req.query.number || '').toString().replace(/[^0-9]/g, '');
        if (!n) return res.json({ totalActive: manager.connected().length, connections: manager.connected().map(s => ({ number: s.number.slice(0, -4) + '****', uptime: s.info().uptime })) });
        const s = manager.get(n);
        res.json({ isConnected: s?.status === 'open', status: s?.status || 'none' });
    });
    app.get('/active', (req, res) => res.json({ count: manager.connected().length }));

    // ---- admin ----
    app.get('/api/sessions', admin, (req, res) => res.json({ summary: manager.summary(), sessions: manager.list().map(s => s.info()) }));
    app.post('/api/sessions/:n/restart', admin, async (req, res) => { try { await manager.start(req.params.n, { force: true }); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
    app.post('/api/sessions/:n/stop', admin, async (req, res) => res.json({ ok: await manager.stop(req.params.n) }));
    app.delete('/api/sessions/:n', admin, async (req, res) => res.json({ ok: await manager.logout(req.params.n) }));
    app.post('/api/connect-all', admin, (req, res) => { manager.restoreAll().catch(() => {}); res.json({ ok: true }); });
    app.get('/api/plugins', admin, (req, res) => { const l = require('./plugin-loader'); res.json({ commands: l.list().length, failed: l.failed, duplicates: l.duplicates }); });
    app.post('/api/plugins/reload', admin, (req, res) => res.json(require('./plugin-loader').reload()));

    app.use((req, res) => res.status(404).json({ error: 'Not found' }));
    app.use((err, req, res, next) => { log.error(err); res.status(500).json({ error: 'Internal error' }); });
    return app;
}
module.exports = { create };
