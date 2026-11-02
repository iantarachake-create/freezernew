// npm run check  -> loads all plugins and reports problems (run after `npm install`)
const loader = require('../lib/plugin-loader');
const r = loader.load();
console.log(`\nLoaded: ${r.loaded}  Failed: ${r.failed.length}`);
r.failed.forEach(f => console.log(`  ✗ ${f.file}: ${f.error}`));
if (loader.duplicates.length) console.log(`Duplicate command names (first one wins): ${[...new Set(loader.duplicates)].join(', ')}`);
process.exit(r.failed.length ? 1 : 0);
