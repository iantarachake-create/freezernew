const { cmd } = require('../command');
const config = require('../config');
const ai = require('../lib/ai');

const run = async (key, text, reply, react, system) => {
    try { await react("⏳"); const out = await ai.ask(key, text, { system }); await reply(out); await react("✅"); }
    catch (e) { await react("❌"); reply(`❌ ${e.message}`); }
};

cmd({
    pattern: "ask", alias: ["chat", "ai2"], react: "🧠", category: "ai",
    desc: "Chat with AI that remembers the conversation: .ask <question>", filename: __filename
}, async (conn, mek, m, { q, quoted, reply, react, from, session }) => {
    const text = q || quoted?.text;
    if (!text) return reply("Ask something: *.ask what is the capital of Kenya?*");
    await run(`${session.number}:${from}`, text, reply, react);
});

cmd({
    pattern: "aireset", alias: ["newchat"], react: "🧹", category: "ai", desc: "Forget the AI conversation in this chat", filename: __filename
}, async (conn, mek, m, { reply, from, session }) => { ai.reset(`${session.number}:${from}`); reply("🧹 Conversation memory cleared."); });

cmd({
    pattern: "tr", alias: ["translate"], react: "🌍", category: "ai", desc: "Translate: .tr <language> <text> (or reply to a message)", filename: __filename
}, async (conn, mek, m, { args, quoted, reply, react, from, session }) => {
    const lang = args[0]; const text = args.slice(1).join(' ') || quoted?.text;
    if (!lang || !text) return reply("Usage: *.tr swahili Good morning* (or reply to a message with *.tr french*)");
    await run(`tmp:${Date.now()}`, text, reply, react, `Translate the user's text into ${lang}. Output only the translation.`);
});

cmd({
    pattern: "summarize", alias: ["tldr", "summary"], react: "📝", category: "ai", desc: "Summarise a replied message or given text", filename: __filename
}, async (conn, mek, m, { q, quoted, reply, react }) => {
    const text = q || quoted?.text;
    if (!text) return reply("Reply to a long message with *.summarize* or add text after it.");
    await run(`tmp:${Date.now()}`, text, reply, react, 'Summarise the text in 3-5 short bullet points. Same language as the text.');
});

cmd({
    pattern: "chatbot", react: "🤖", category: "ai", desc: "Turn the AI chatbot on/off for private chats: .chatbot on|off", filename: __filename
}, async (conn, mek, m, { q, reply, isOwner }) => {
    if (!isOwner) return reply("🔒 Owner only.");
    if (!config.AI_API_KEY) return reply("❌ AI is not configured on this server (AI_API_KEY missing).");
    if (!/^(on|off)$/i.test(q.trim())) return reply(`Chatbot is currently *${config.AI_CHATBOT === 'true' ? 'ON' : 'OFF'}*. Use *.chatbot on* or *.chatbot off*`);
    config.AI_CHATBOT = q.trim().toLowerCase() === 'on' ? 'true' : 'false';
    reply(`🤖 AI chatbot ${config.AI_CHATBOT === 'true' ? 'enabled — I will answer every private message' : 'disabled'}.`);
});
