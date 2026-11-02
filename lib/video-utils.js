const ff = require('./ffmpeg-utils');
// video/gif -> animated WebP sticker (512x512, max 8s, 15fps)
async function videoToWebp(buf) {
    return ff.run(buf, 'mp4', 'webp', ['-t', '8', '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:-1:-1:color=0x00000000',
        '-c:v', 'libwebp', '-lossless', '0', '-q:v', '60', '-loop', '0', '-preset', 'default', '-an', '-vsync', '0']);
}
module.exports = { videoToWebp };
