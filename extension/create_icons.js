const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function generatePNG(width, height, r, g, b) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type (RGB)
  ihdrData[10] = 0; // compression method
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace method

  const ihdrChunk = createChunk('IHDR', ihdrData);

  // IDAT chunk (raw RGB image data with filter byte 0 per scanline)
  const scanlineLength = 1 + width * 3;
  const rawData = Buffer.alloc(height * scanlineLength);

  for (let y = 0; y < height; y++) {
    const offset = y * scanlineLength;
    rawData[offset] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const px = offset + 1 + x * 3;
      // Draw a subtle gradient / circle style
      const dx = x - width / 2;
      const dy = y - height / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < width / 2 - 1) {
        rawData[px] = r;
        rawData[px + 1] = g;
        rawData[px + 2] = b;
      } else {
        rawData[px] = 15;
        rawData[px + 1] = 23;
        rawData[px + 2] = 42;
      }
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressedData);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(4 + 4 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);

  const crc = crc32(Buffer.concat([Buffer.from(type, 'ascii'), data]));
  buf.writeInt32BE(crc, 8 + len);
  return buf;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return ~c;
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Purple/violet brand accent color: RGB (99, 102, 241) -> #6366f1
fs.writeFileSync(path.join(iconsDir, 'icon16.png'), generatePNG(16, 16, 99, 102, 241));
fs.writeFileSync(path.join(iconsDir, 'icon48.png'), generatePNG(48, 48, 99, 102, 241));
fs.writeFileSync(path.join(iconsDir, 'icon128.png'), generatePNG(128, 128, 99, 102, 241));

console.log('Icons generated successfully!');
