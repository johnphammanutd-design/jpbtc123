// Sinh icon PWA (192px, 512px, 180px apple-touch) thuần Node — vẽ pixel + đóng gói PNG
// bằng zlib, không cần thư viện đồ họa. Hình: nền xanh Trello, bảng trắng 3 cột.
// Dùng:  node scripts/make-icons.mjs   (ghi vào public/)
import fs from 'node:fs';
import zlib from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, draw) {
  const px = Buffer.alloc(size * size * 4);
  draw(px, size);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const set = (px, size, x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
};
const rect = (px, size, x0, y0, w, h, r, g, b, rad = 0) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (rad > 0) { // bo góc
      const dx = Math.max(x0 + rad - x, x - (x0 + w - 1 - rad), 0);
      const dy = Math.max(y0 + rad - y, y - (y0 + h - 1 - rad), 0);
      if (dx * dx + dy * dy > rad * rad) continue;
    }
    set(px, size, x, y, r, g, b);
  }
};

function drawIcon(px, size) {
  const u = size / 64; // lưới 64 đơn vị
  // nền gradient dọc xanh
  for (let y = 0; y < size; y++) {
    const t = y / size;
    const r = Math.round(0 + 60 * t), g = Math.round(121 - 20 * t), b = Math.round(191 + 6 * t);
    for (let x = 0; x < size; x++) set(px, size, x, y, r, g, b);
  }
  // bảng trắng
  rect(px, size, Math.round(10 * u), Math.round(12 * u), Math.round(44 * u), Math.round(40 * u), 255, 255, 255, Math.round(4 * u));
  // 3 cột: 2 cột đầy, 1 cột ngắn (nhịp kanban)
  const colW = Math.round(10 * u), gap = Math.round(3 * u), top = Math.round(17 * u);
  const x1 = Math.round(14 * u);
  rect(px, size, x1, top, colW, Math.round(30 * u), 0, 121, 191, Math.round(2 * u));
  rect(px, size, x1 + colW + gap, top, colW, Math.round(22 * u), 90, 170, 68, Math.round(2 * u));
  rect(px, size, x1 + 2 * (colW + gap), top, colW, Math.round(13 * u), 242, 214, 0, Math.round(2 * u));
}

fs.writeFileSync(new URL('../public/icon-192.png', import.meta.url), png(192, drawIcon));
fs.writeFileSync(new URL('../public/icon-512.png', import.meta.url), png(512, drawIcon));
fs.writeFileSync(new URL('../public/apple-touch-icon.png', import.meta.url), png(180, drawIcon));
console.log('Đã sinh icon-192.png, icon-512.png, apple-touch-icon.png trong public/');
