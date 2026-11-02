// Helper methods attached to every socket (kept compatible with the old plugins).
const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage, getContentType, jidDecode } = require('@whiskeysockets/baileys');
const TEMP = path.join(__dirname, '..', 'temp');
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/3gpp': '3gp', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/ogg; codecs=opus': 'opus', 'application/pdf': 'pdf', 'application/zip': 'zip' };

function resolveContent(m) {
    if (m.msg && typeof m.msg === 'object') return { content: m.msg, mtype: m.mtype };
    if (m.message) { const t = getContentType(m.message); return { content: m.message[t], mtype: t }; }
    const t = getContentType(m);
    if (t && typeof m[t] === 'object') return { content: m[t], mtype: t };
    return { content: m, mtype: null };   // raw media content (has mimetype/mediaKey)
}

function enhance(sock, session) {
    sock.decodeJid = (jid) => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) { const d = jidDecode(jid) || {}; return (d.user && d.server && d.user + '@' + d.server) || jid; }
        return jid;
    };
    sock.downloadMediaMessage = async (m) => {
        const { content, mtype } = resolveContent(m);
        const mime = content?.mimetype || '';
        let type = mtype ? mtype.replace(/Message$/i, '') : mime.split('/')[0];
        if (['application', 'text', ''].includes(type)) type = 'document';
        const stream = await downloadContentFromMessage(content, type);
        const chunks = []; for await (const c of stream) chunks.push(c);
        return Buffer.concat(chunks);
    };
    sock.downloadAndSaveMediaMessage = async (m, filename, attachExtension = true) => {
        const buffer = await sock.downloadMediaMessage(m);
        const { content } = resolveContent(m);
        const ext = EXT[(content?.mimetype || '').toLowerCase()] || (content?.mimetype || '').split('/')[1]?.split(';')[0] || 'bin';
        fs.mkdirSync(TEMP, { recursive: true });
        let name = filename || `${session.number}-${Date.now()}`;
        if (!path.isAbsolute(name) && !name.includes(path.sep)) name = path.join(TEMP, name);
        const out = attachExtension ? `${name}.${ext}` : name;
        fs.writeFileSync(out, buffer);
        return out;
    };
    sock.chats = { all: () => [...session.chats].map(id => ({ id })) };
    sock.session = session;
    return sock;
}

// delete temp files older than 30 minutes
function cleanTemp() {
    try {
        for (const f of fs.readdirSync(TEMP)) {
            const p = path.join(TEMP, f);
            if (Date.now() - fs.statSync(p).mtimeMs > 30 * 60 * 1000) fs.rmSync(p, { force: true, recursive: true });
        }
    } catch {}
}
module.exports = { enhance, cleanTemp, TEMP };
