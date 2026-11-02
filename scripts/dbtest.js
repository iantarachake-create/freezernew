// npm run dbtest  -> checks that DATABASE_URL (Supabase/Postgres) or MONGODB_URI works: connect, create tables, write/read/delete.
const config = require('../config');
const db = require('../lib/db');
(async () => {
    if (!config.DATABASE_URL && !config.MONGODB_URI) { console.log('No DATABASE_URL / MONGODB_URI set.'); process.exit(1); }
    const t = setTimeout(() => { console.log('✗ timed out after 40s'); process.exit(1); }, 40_000);
    await db.connect({ databaseUrl: config.DATABASE_URL, mongoUri: config.MONGODB_URI });
    console.log(`✓ connected (${db.kind()})`);
    await db.kvSet('_test', 'k', { hello: 'world', n: 1 });
    const rows = await db.kvLoad('_test');
    console.log('✓ kv write/read:', JSON.stringify(rows));
    await db.kvDel('_test', 'k');
    await db.authWrite('_test', 'creds', '{"a":1}');
    console.log('✓ auth write/read:', await db.authRead('_test', 'creds'));
    await db.authClear('_test');
    console.log('✓ cleanup done, ping =', await db.ping());
    clearTimeout(t); process.exit(0);
})().catch(e => { console.error('✗', e.message); process.exit(1); });
