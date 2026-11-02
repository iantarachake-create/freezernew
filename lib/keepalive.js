// Keeps free hosts (Render, Koyeb, Railway, Heroku...) from putting the app to sleep by pinging its own public URL.
// Set APP_URL (or KEEPALIVE_URL) to your public https URL. Render/Railway/Heroku URLs are auto-detected.
const log = require('./logger').make('keepalive');

function detectUrl() {
    const e = process.env;
    if (e.KEEPALIVE_URL) return e.KEEPALIVE_URL;
    if (e.APP_URL) return e.APP_URL;
    if (e.RENDER_EXTERNAL_URL) return e.RENDER_EXTERNAL_URL;
    if (e.RAILWAY_PUBLIC_DOMAIN) return `https://${e.RAILWAY_PUBLIC_DOMAIN}`;
    if (e.KOYEB_PUBLIC_DOMAIN) return `https://${e.KOYEB_PUBLIC_DOMAIN}`;
    if (e.HEROKU_APP_NAME) return `https://${e.HEROKU_APP_NAME}.herokuapp.com`;
    return '';
}

function start() {
    const base = detectUrl().replace(/\/+$/, '');
    if (!base) { log.info('no public URL detected - self-ping off (set APP_URL if your host sleeps when idle)'); return; }
    const every = Math.max(60, Number(process.env.KEEPALIVE_SECONDS || 240)) * 1000;
    const ping = async () => {
        try { const r = await fetch(`${base}/ping`, { signal: AbortSignal.timeout(15_000) }); if (!r.ok) log.warn(`self-ping ${r.status}`); }
        catch (e) { log.warn('self-ping failed: ' + e.message); }
    };
    setInterval(ping, every).unref();
    log.info(`self-ping every ${every / 1000}s -> ${base}/ping`);
}
module.exports = { start };
