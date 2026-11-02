const ff = require('../lib/ffmpeg-utils');
// any audio/video -> mp3 (toAudio) or WhatsApp voice note, ogg/opus (toPTT)
const toAudio = (buf, ext = 'mp4') => ff.run(buf, ext, 'mp3', ['-vn', '-ac', '2', '-b:a', '128k', '-ar', '44100']);
const toPTT = (buf, ext = 'mp4') => ff.run(buf, ext, 'opus', ['-vn', '-c:a', 'libopus', '-b:a', '128k', '-vbr', 'on', '-compression_level', '10']);
module.exports = { toAudio, toPTT };
