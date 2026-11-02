// Message pipeline: normalise -> build context -> gates -> hooks -> command.
const { getContentType, jidNormalizedUser } = require('@whiskeysockets/baileys');
const crypto = require('crypto');
const config = require('../config');
const loader = require('./plugin-loader');
const features = require('./features');
const ai = require('./ai');
const { sms } = require('./msg');
const log = require('./logger').make('handler');

function unwrap(message) {
    let m = message;
    for (let i = 0; i < 5 && m; i++) {
        const t = getContentType(m);
        if (t === 'ephemeralMessage') m = m.ephemeralMessage.message;
        else if (t === 'documentWithCaptionMessage') m = m.documentWithCaptionMessage.message;
        else if (t === 'viewOnceMessageV2Extension') m = m.viewOnceMessageV2Extension.message;
        else break;
    }
    return m;
}

function buildQuoted(conn, m) {
    const ci = m.msg?.contextInfo;
    if (!ci?.quotedMessage) return null;
    const qm = unwrap(ci.quotedMessage);
    const mtype = getContentType(qm);
    const msg = qm[mtype];
    const sender = jidNormalizedUser(ci.participant || m.chat);
    const q = {
        key: { remoteJid: m.chat, id: ci.stanzaId, participant: ci.participant, fromMe: sender === jidNormalizedUser(conn.user.id) },
        id: ci.stanzaId, chat: m.chat, sender, message: qm, mtype, msg,
        text: typeof msg === 'string' ? msg : (msg?.text || msg?.caption || ''),
        mimetype: msg?.mimetype || '', ptt: msg?.ptt, seconds: msg?.seconds, fileName: msg?.fileName
    };
    q.download = () => conn.downloadMediaMessage(q);
    return q;
}

async function groupInfo(s, jid) {
    const hit = s.groupCache.get(jid);
    if (hit && Date.now() - hit.at < 60_000) return hit.data;
    const data = await s.sock.groupMetadata(jid);
    s.groupCache.set(jid, { data, at: Date.now() });
    return data;
}

const myQuoted = (s) => ({
    key: { remoteJid: 'status@broadcast', participant: '0@s.whatsapp.net', fromMe: false, id: crypto.randomBytes(8).toString('hex').toUpperCase() },
    message: { contactMessage: { displayName: `© ${config.BOT_NAME}`, vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${config.BOT_NAME}\nORG:${config.BOT_NAME};\nEND:VCARD` } },
    messageTimestamp: Math.floor(Date.now() / 1000), status: 1
});

async function handleUpsert(s, { messages, type }) {
    if (type !== 'notify' && type !== 'append') return;
    for (const raw of messages) {
        try { await handleOne(s, raw, type); } catch (e) { log.error(`[${s.number}] handler error:`, e); }
    }
}

async function handleOne(s, mek, upsertType) {
    const conn = s.sock;
    if (!mek?.message || !mek.key?.remoteJid) return;
    mek.message = unwrap(mek.message);
    if (!mek.message) return;
    const from = mek.key.remoteJid;

    s.cache.set(mek);                                   // for anti-delete / retries
    if (from.endsWith('@newsletter')) return;
    if (mek.message.protocolMessage) { await features.onRevoke(s, mek); return; }
    if (mek.message.senderKeyDistributionMessage && Object.keys(mek.message).length === 1) return;
    if (upsertType === 'append') return;                // history sync etc.

    if (from === 'status@broadcast') return features.onStatus(s, mek);

    // ignore messages the library itself generated (our own replies echoed back)
    if (mek.key.fromMe && /^BAE5/.test(mek.key.id || '')) return;

    s.stats.messages++;
    const m = sms(conn, mek);
    const type = getContentType(mek.message);
    mek.type = type;
    m.mentionedJid = m.msg?.contextInfo?.mentionedJid || [];
    m.quoted = buildQuoted(conn, m);
    const body = m.body || '';
    m.text = body;
    s.chats.add(from);

    const prefix = String(config.PREFIX || '.');
    const noPrefix = prefix.toLowerCase() === 'none' || prefix === '';
    const isCmd = noPrefix ? !!body : body.startsWith(prefix);
    const rest = isCmd ? body.slice(noPrefix ? 0 : prefix.length).trim() : '';
    const command = isCmd ? rest.split(/\s+/)[0].toLowerCase() : '';
    const args = body.trim().split(/ +/).slice(1);
    const q = args.join(' ');

    const isGroup = from.endsWith('@g.us');
    const sender = m.sender;
    const senderNumber = sender.split('@')[0];
    const botNumber2 = jidNormalizedUser(conn.user.id);
    const botNumber = botNumber2.split('@')[0];
    const isMe = sender === botNumber2 || mek.key.fromMe === true;
    const isOwner = isMe || config.OWNER_NUMBERS.includes(senderNumber) || s.sudo.has(senderNumber);
    const isSuperUser = config.OWNER_NUMBERS.includes(senderNumber);

    let groupMetadata = null, groupName = null, participants = null, groupAdmins = [], isBotAdmins = false, isAdmins = false;
    if (isGroup && (isCmd || loader.hooks().length)) {
        try {
            groupMetadata = await groupInfo(s, from);
            groupName = groupMetadata.subject; participants = groupMetadata.participants;
            groupAdmins = participants.filter(p => p.admin).map(p => p.id);
            isBotAdmins = groupAdmins.includes(botNumber2); isAdmins = groupAdmins.includes(sender);
        } catch {}
    }

    const reply = (text, opts = {}) => conn.sendMessage(from, { text, ...opts }, { quoted: s.myquoted || (s.myquoted = myQuoted(s)) });
    const react = (emoji) => conn.sendMessage(from, { react: { text: emoji, key: mek.key } });
    const ctx = {
        from, quoted: m.quoted, body, isCmd, command, args, q, text: q, prefix, isGroup, sender, senderNumber,
        botNumber2, botNumber, pushname: mek.pushName || 'User', pushName: mek.pushName || 'User',
        isMe, isOwner, isCreator: isOwner, isSuperUser, isDev: isSuperUser, isItzcp: isOwner,
        groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins,
        reply, l: reply, react, config, myquoted: s.myquoted, session: s
    };

    features.track(s, from, sender);
    if (config.READ_MESSAGE === 'true' && !mek.key.fromMe) conn.readMessages([mek.key]).catch(() => {});
    await features.afkCheck(s, mek, ctx).catch(() => {});

    // ---- mode gate (owner always passes) ----
    if (!isOwner) {
        const mode = String(config.MODE).toLowerCase();
        if (mode === 'private') return;
        if (mode === 'group' && !isGroup && isCmd) return;
        if (mode === 'inbox' && isGroup && isCmd) return;
    }

    // ---- event hooks (on: body/text/image/...) ----
    if (!mek.key.fromMe) {
        for (const h of loader.hooks()) {
            const t = h.on;
            const hit = ((t === 'body' || t === 'text') && body) || ((t === 'image' || t === 'photo') && type === 'imageMessage')
                || (t === 'video' && type === 'videoMessage') || (t === 'sticker' && type === 'stickerMessage') || (t === 'audio' && type === 'audioMessage');
            if (hit) Promise.resolve(h.function(conn, mek, m, ctx)).catch(e => log.warn(`[${s.number}] hook error: ${e.message}`));
        }
    }

    // ---- AI chatbot in DMs ----
    if (!isCmd && !isGroup && !mek.key.fromMe && config.AI_CHATBOT === 'true' && body && config.AI_API_KEY) {
        try {
            await conn.sendPresenceUpdate('composing', from);
            await reply(await ai.ask(`${s.number}:${from}`, body));
        } catch (e) { log.warn(`[${s.number}] chatbot: ${e.message}`); }
        return;
    }

    if (!isCmd) return;
    const cmd = loader.find(command);
    if (!cmd) return;
    if (cmd.fromMe && !isOwner) return;
    if (cmd.superuser && !isSuperUser) return reply('🔒 This command is restricted to the server administrator.');
    if (cmd.owner === true && !isOwner) return reply('🔒 Owner only command.');

    if (config.ANTI_SPAM === 'true' && !isOwner) {
        const r = features.allowCommand(s, sender);
        if (r === 'drop') return;
        if (r === 'warn') return reply('⏳ Slow down a little, you are sending commands too fast.');
    }

    s.stats.commands++;
    if (config.READ_CMD === 'true' && !mek.key.fromMe) conn.readMessages([mek.key]).catch(() => {});
    if (cmd.react) conn.sendMessage(from, { react: { text: cmd.react, key: mek.key } }).catch(() => {});
    try {
        await cmd.function(conn, mek, m, ctx);
    } catch (e) {
        log.error(`[${s.number}] command "${command}" failed:`, e);
        reply(`⚠️ *${command}* failed: ${String(e.message || e).slice(0, 160)}`).catch(() => {});
    }
}

module.exports = { handleUpsert };
