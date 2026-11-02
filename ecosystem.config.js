// pm2 start ecosystem.config.js   (then: pm2 save && pm2 startup  so it survives a server reboot)
module.exports = { apps: [{
    name: 'freeezer-multi', script: 'index.js', instances: 1, exec_mode: 'fork',
    autorestart: true, max_restarts: 1000, min_uptime: '20s',
    exp_backoff_restart_delay: 2000,           // 2s, 3s, 4.5s ... if it ever crash-loops
    max_memory_restart: '900M', kill_timeout: 8000, time: true
} ] };
