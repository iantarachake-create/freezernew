// Per-session execution context. Every event/command runs inside run(store, fn),
// so the shared `config` object can transparently return that session's settings.
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();
module.exports = {
    run: (store, fn) => als.run(store, fn),
    store: () => als.getStore()
};
