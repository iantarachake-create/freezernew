const sharp = require('sharp');
// sticker (webp) -> png
async function convertStickerToImage(buf) { return sharp(buf).png().toBuffer(); }
module.exports = { convertStickerToImage };
