# FREEEZER MD — multi-session engine (v3)

Every person who links a number gets their **own isolated bot** on one server: own login, own settings, own owner list, own stats.

## Quick start
```bash
cp .env.example .env      # set OWNER_NUMBER, ADMIN_TOKEN (and MONGODB_URI on Heroku/Render/Railway)
npm install
npm start                 # open http://localhost:8000 → link a number
```
Docker: `docker build -t freeezer . && docker run -p 8000:8000 --env-file .env -v $PWD/sessions:/app/sessions -v $PWD/data:/app/data freeezer`
Heroku/Render: `Procfile` included. **Use MongoDB there**, the disk is wiped on every restart.

## How people get a bot
* Website `/` → enter number → 8-character pairing code → WhatsApp › Linked devices › Link with phone number.
* Or message any connected bot: `.pair 2547XXXXXXXX` (private chat only).
* Sessions auto-restore after restarts (staggered), reconnect with exponential backoff, and clean themselves up if the user unlinks from their phone.

## Who is "owner"?
| Role | Who | Can |
|---|---|---|
| Session owner | the linked number itself (+ `.sudo add` users) | `.settings`, `.set`, anti-delete, mode, `.logoutbot` … on **their own bot only** |
| Server admin | numbers in `OWNER_NUMBER` | everything above on every session **plus** `.restart`, `.shutdown`, `.install`, `.deleteplugin`, `.sessions`, `.reloadplugins` |

## New features
* **Per-session settings** – `.settings` shows a panel, `.set ANTI_DELETE on`. All old plugins that read/write `config.X` became per-session automatically (via an async-context proxy in `config.js`).
* **Anti-delete** (to your own chat or the same chat) · anti-call · auto view/like/reply status · anti-spam rate limiter · welcome/goodbye
* **AI** (any OpenAI-compatible API, set `AI_API_KEY`): `.ask` with conversation memory, `.aireset`, `.tr`, `.summarize`, `.chatbot on` (auto-answers private chats)
* **Tools**: `.afk`, persistent reminders (`.remind 1h30m …`, survive restarts), `.warn` / `.warns` / `.resetwarn` with auto-kick, `.top` group activity leaderboard
* **Ops**: web dashboard (admin token) with restart/logout per session, `/health`, graceful shutdown, plugin hot-reload, a plugin that fails to load never stops the bot, bounded caches, temp-file cleanup
* Storage: **PostgreSQL / Supabase** (`DATABASE_URL`), MongoDB (`MONGODB_URI`) or plain files when both are empty. Credentials **and** Signal keys are stored, tables are created automatically. Run `npm run dbtest` to verify the connection.
* **Uptime**: sessions reconnect forever (backoff, never "give up"), a watchdog heals dead sockets / stuck states / sessions missing from memory every 60s, the database connect retries until it works, `APP_URL` self-ping stops free hosts sleeping, Docker `HEALTHCHECK`, pm2 auto-restart with backoff.

## Security changes vs. the original zip — please read
1. `config.js` used to contain a **MongoDB URI with password and a Telegram bot token** in plain text. They are removed. If they were not yours, don't use them; if they were, rotate them.
2. The old `install` command downloaded any Gist's JavaScript into `plugins/` and `owner: true` was never enforced → anyone could run code on the server. It is now server-admin only (and `owner: true` is enforced everywhere).
3. `update` pulled and overwrote the code from another GitHub repo → removed (it would also overwrite this engine).
4. `/disconnect`, `/connect-all`, `/stats` were open to the public → now behind `ADMIN_TOKEN`; pairing is rate-limited per IP (`PUBLIC_PAIRING`, `ALLOWED_NUMBERS`, `MAX_SESSIONS` control who/how many).
5. `package.json` used `@whiskeysockets/baileys` → `npm:angularsockets` (an unofficial fork). Switched to the official package (6.x).

## Added missing files
`lib/fetchGif.js`, `lib/video-utils.js`, `data/converter.js`, `data/sticker-converter.js`, `lib/functions2.js` were required by plugins but absent from the zip (reaction GIFs, sticker/video converters, logo maker etc. could not load).

## Notes
* Known duplicate command names inherited from the original plugins (first file alphabetically wins): antilink, invite, ig, gjid, delete, setpp, status. `npm run check` lists them.
* Many download plugins call third-party free APIs that come and go; if one stops working it's the API, not the engine.
* Using unofficial WhatsApp clients can get numbers banned. Keep `ANTI_SPAM` on and avoid mass broadcast.
