// Small ffmpeg helpers (buffer in -> buffer out) shared by the media plugins.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function ffmpegBin() {
    try { return require('@ffmpeg-installer/ffmpeg').path; } catch { return 'ffmpeg'; }
}
function run(input, inExt, outExt, args) {
    return new Promise((resolve, reject) => {
        const id = crypto.randomBytes(6).toString('hex');
        const inp = path.join(os.tmpdir(), `${id}.${inExt}`), out = path.join(os.tmpdir(), `${id}.out.${outExt}`);
        fs.writeFileSync(inp, input);
        const done = (err, data) => { fs.rmSync(inp, { force: true }); fs.rmSync(out, { force: true }); err ? reject(err) : resolve(data); };
        require('child_process').execFile(ffmpegBin(), ['-y', '-i', inp, ...args, out], { timeout: 60_000 }, (err, so, se) => {
            if (err) return done(new Error('ffmpeg failed: ' + String(se || err.message).split('\n').slice(-3).join(' ')));
            try { done(null, fs.readFileSync(out)); } catch (e) { done(e); }
        });
    });
}
module.exports = { run };
