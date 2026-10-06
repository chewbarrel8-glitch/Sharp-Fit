// 生成应用图标：纯像素绘制 PNG -> sips 缩放 -> iconutil 生成 icns
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const S = 1024;

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
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
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(file, w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
}

// ---------- 绘制 ----------
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r);
  const dy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(dx, 0), oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - r;
}
function sdSeg(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}
const lerp = (a, b, t) => a + (b - a) * t;
function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

const buf = Buffer.alloc(S * S * 4);
// 基础几何
const bars = [
  { cx: 268, top: 566 }, { cx: 512, top: 428 }, { cx: 756, top: 276 }
];
const BW = 128, BASE = 812;
const linePts = bars.map((b) => [b.cx, b.top - 56]);
const DOT = [linePts[2][0], linePts[2][1]];

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    // 圆角方形裁剪
    const dRR = sdRoundRect(x, y, S / 2, S / 2, S / 2 - 12, S / 2 - 12, 224);
    let a = 1 - smooth(-dRR / 1.6 + 0.5);
    if (a <= 0) { buf[i + 3] = 0; continue; }

    // 背景：垂直渐变 + 顶部微光
    let col = mix([19, 25, 38], [9, 12, 19], y / S);
    const glow = Math.max(0, 1 - Math.hypot(x - S * 0.28, y - S * 0.16) / 620);
    col = mix(col, [38, 52, 74], glow * 0.5);

    // 柱：volt 渐变 + 圆角顶
    for (const b of bars) {
      const hw = BW / 2;
      if (Math.abs(x - b.cx) <= hw && y >= b.top - 20 && y <= BASE) {
        const r = 20;
        const dx = Math.abs(x - b.cx) - (hw - r);
        const dy = (y - (b.top + r)) * -1;
        let inBar = dx <= 0 || y >= b.top + r;
        if (y < b.top + r && dx > 0) {
          const cx0 = b.cx + Math.sign(x - b.cx) * (hw - r);
          const cy0 = b.top + r;
          inBar = Math.hypot(x - cx0, y - cy0) <= r;
        }
        if (inBar) {
          const g = (BASE - y) / (BASE - b.top);
          col = mix([216, 255, 75], [140, 214, 16], Math.min(1, g));
        }
      }
    }

    // 趋势线（白色，圆头）
    const LW = 13;
    let dLine = Infinity;
    for (let k = 0; k < linePts.length - 1; k++) {
      dLine = Math.min(dLine, sdSeg(x, y, linePts[k][0], linePts[k][1], linePts[k + 1][0], linePts[k + 1][1]));
    }
    if (dLine <= LW) col = [246, 250, 255];
    // 端点圆点
    const dDot = Math.hypot(x - DOT[0], y - DOT[1]);
    if (dDot <= 30) col = [246, 250, 255];
    else if (dDot <= 44) col = mix(col, [246, 250, 255], (44 - dDot) / 14 * 0.35);

    buf[i] = Math.round(col[0]);
    buf[i + 1] = Math.round(col[1]);
    buf[i + 2] = Math.round(col[2]);
    buf[i + 3] = Math.round(a * 255);
  }
}

const root = path.join(__dirname, '..');
const buildDir = path.join(root, 'build');
fs.mkdirSync(buildDir, { recursive: true });
writePNG(path.join(buildDir, 'icon_1024.png'), S, S, buf);

// iconset
const iconset = path.join(buildDir, 'icon.iconset');
fs.rmSync(iconset, { recursive: true, force: true });
fs.mkdirSync(iconset, { recursive: true });
const src1024 = path.join(buildDir, 'icon_1024.png');
for (const [name, size] of [
  ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024]
]) {
  execSync(`sips -z ${size} ${size} "${src1024}" --out "${path.join(iconset, name)}" >/dev/null 2>&1`);
}
execSync(`iconutil -c icns "${iconset}" -o "${path.join(buildDir, 'icon.icns')}"`);
console.log('[icon] build/icon.icns 已生成');
