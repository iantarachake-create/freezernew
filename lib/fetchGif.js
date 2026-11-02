const axios = require('axios');
const ff = require('./ffmpeg-utils');
async function fetchGif(url) { return Buffer.from((await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 })).data); }
// WhatsApp plays looping mp4 as a GIF, so convert gif -> mp4 (even dimensions, yuv420p)
async function gifToVideo(buf) {
    return ff.run(buf, 'gif', 'mp4', ['-movflags', 'faststart', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-an']);
}
module.exports = { fetchGif, gifToVideo };
