const config = require('./config');
const db = require('./lib/db');
const kv = require('./lib/kv');
const log = require('./lib/logger').make('boot');

// Nothing is allowed to take the bot down: log and keep running.
process.on('unhandledRejection', (e) => log.error('unhandledRejection', e));
process.on('uncaughtException', (e) => log.error('uncaughtException', e));

let ready = false;

(async () => {
    const loader = require('./lib/plugin-loader');
    const manager = require('./lib/session-manager');
    manager.handler = require('./lib/handler');

    // 1) web server first, so the host's health check passes while the database connects
    const app = require('./lib/server').create({ isReady: () => ready });
    const listen = () => new Promise((resolve) => {
        const srv = app.listen(config.PORT, () => { log.info(`web on :${config.PORT}  (pairing page: / )`); resolve(srv); });
        srv.on('error', (e) => { log.error('web server error: ' + e.message); setTimeout(() => { try { srv.close(); } catch {} listen().then(resolve); }, 3000); });
        srv.keepAliveTimeout = 65_000; srv.headersTimeout = 70_000;
    });
    const server = await listen();
    require('./lib/keepalive').start();

    // 2) database (PostgreSQL/Supabase or MongoDB). Retries until it connects; never falls back to files when one is configured.
    await db.connect({ databaseUrl: config.DATABASE_URL, mongoUri: config.MONGODB_URI });
    loader.load();

    // 3) background jobs + sessions
    require('./lib/scheduler');
    setInterval(() => require('./lib/scheduler').tick(manager).catch(() => {}), 15_000).unref();
    ready = true;
    manager.startWatchdog();
    manager.restoreAll().catch(e => log.error('restore failed', e));

    // periodic DB heartbeat: keeps pooled connections warm and logs outages
    if (db.enabled()) setInterval(async () => { if ((await db.ping()) === false) log.warn('database ping failed (queries auto-retry)'); }, 60_000).unref();

    const stop = async (sig) => {
        log.info(`${sig} received, shutting down`);
        try { await require('./lib/features').flushActivity(); kv.flushAll(); await manager.shutdown(); } catch {}
        server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 4000).unref();
    };
    process.on('SIGINT', () => stop('SIGINT')); process.on('SIGTERM', () => stop('SIGTERM'));
})().catch((e) => { log.error('fatal during boot - exiting so the supervisor restarts us', e); process.exit(1); });
