let pino;
try { pino = require('pino'); } catch { pino = null; }
const level = process.env.LOG_LEVEL || 'info';
const root = pino ? pino({ level }) : null;
const fmt = (a) => a.map(x => (x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
const make = (name) => ({
    info: (...a) => root ? root.child({ s: name }).info(fmt(a)) : console.log(`[${name}]`, ...a),
    warn: (...a) => root ? root.child({ s: name }).warn(fmt(a)) : console.warn(`[${name}]`, ...a),
    error: (...a) => root ? root.child({ s: name }).error(fmt(a)) : console.error(`[${name}]`, ...a),
});
// silent logger for Baileys internals
const silent = pino ? pino({ level: 'silent' }) : { level: 'silent', child() { return this; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
module.exports = { make, silent };
