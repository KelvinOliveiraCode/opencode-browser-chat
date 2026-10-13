// Gera os ícones PNG da extensão (16/32/48/128) sem dependências.
// Uso: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'extension', 'icons');
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      const p = pixels(x, y, size);
      raw[o++] = p[0]; raw[o++] = p[1]; raw[o++] = p[2]; raw[o++] = p[3];
    }
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// Bolha de chat: fundo escuro arredondado, traço claro de balão.
function draw(x, y, s) {
  const cx = s / 2, cy = s / 2;
  const dx = (x + 0.5 - cx) / (s * 0.42);
  const dy = (y + 0.5 - cy) / (s * 0.42);
  const r = Math.hypot(dx, dy);
  const edge = 1 - 2.2 / s;

  // fora do círculo: transparente
  if (r > 1) return [0, 0, 0, 0];
  // antialias na borda
  const a = Math.min(1, Math.max(0, (1 - r) / (2.6 / s) + 0.5));
  const inside = r < edge;

  // cor de fundo
  let col = inside ? [22, 24, 29, Math.round(255 * a)] : [0, 0, 0, 0];
  if (inside) {
    // gradiente sutil
    const t = y / s;
    col = [
      Math.round(28 - 8 * t),
      Math.round(31 - 8 * t),
      Math.round(38 - 10 * t),
      Math.round(255 * a)
    ];
  }

  // corpo do balão: retângulo arredondado na metade superior
  const bx = (x + 0.5) / s, by = (y + 0.5) / s;
  const bx0 = 0.24, bx1 = 0.76, by0 = 0.28, by1 = 0.62, rad = 0.09;
  const qx = Math.max(bx0 + rad, Math.min(bx, bx1 - rad));
  const qy = Math.max(by0 + rad, Math.min(by, by1 - rad));
  const inBody = Math.hypot(bx - qx, by - qy) <= rad;

  // rabinho
  const inTail = bx >= 0.34 && bx <= 0.46 && by > by1 && by <= 0.72;

  // "reticências" dentro do balão
  const dots = [];
  for (const d of [0.38, 0.5, 0.62]) dots.push(Math.hypot(bx - d, by - 0.45) <= 0.035);

  const ink = 226;
  const accent = [122, 172, 250];
  if (dots.some(Boolean) && inside) {
    col = [...accent, Math.round(255 * a)];
  } else if ((inBody || inTail) && inside) {
    col = [ink, ink, ink, Math.round(255 * a)];
  }
  return col;
}

for (const size of [16, 32, 48, 128]) {
  const buf = png(size, draw);
  const file = join(outDir, `icon${size}.png`);
  writeFileSync(file, buf);
  console.log('escrito', file, buf.length, 'bytes');
}
