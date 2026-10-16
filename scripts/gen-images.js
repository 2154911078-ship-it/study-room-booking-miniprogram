/**
 * scripts/gen-images.js —— 自制图片资源生成器（零依赖）
 *
 * 用纯 Node.js 生成项目所需全部 PNG 素材（Logo / tabBar 图标 / 轮播图 /
 * 封面 / 头像 / 空态插画），完全程序绘制，无任何商用或第三方素材版权风险。
 *
 * 运行：node scripts/gen-images.js
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT = path.join(__dirname, "..", "images");
fs.mkdirSync(OUT, { recursive: true });

/* ============ PNG 编码器（8bit RGBA, 无隔行） ============ */

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ============ 迷你画布（超采样抗锯齿） ============ */

function Canvas(w, h, scale) {
  this.w = w;
  this.h = h;
  this.s = scale || 2;
  this.W = w * this.s;
  this.H = h * this.s;
  this.px = new Float64Array(this.W * this.H * 4); // 全 0 = 透明
}

Canvas.prototype = {
  /** 逐超采样像素着色：pred(x,y 逻辑坐标) → color[r,g,b,a 0-255] 或 null */
  paint(pred, colorFn) {
    const s = this.s;
    const buf = this.px;
    for (let py = 0; py < this.H; py++) {
      const y = (py + 0.5) / s;
      const rowBase = py * this.W * 4;
      for (let pxx = 0; pxx < this.W; pxx++) {
        const x = (pxx + 0.5) / s;
        if (!pred(x, y)) continue;
        const c = colorFn(x, y);
        if (!c) continue;
        const i = rowBase + pxx * 4;
        if (c[3] === 0) {
          // alpha=0 视为擦除（挖空/切角）
          buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 0;
          continue;
        }
        const a = c[3] / 255;
        buf[i] = c[0] * a + buf[i] * (1 - a);
        buf[i + 1] = c[1] * a + buf[i + 1] * (1 - a);
        buf[i + 2] = c[2] * a + buf[i + 2] * (1 - a);
        buf[i + 3] = c[3] + buf[i + 3] * (1 - a);
      }
    }
  },

  rect(x, y, w, h, color) {
    this.paint(
      (px, py) => px >= x && px < x + w && py >= y && py < y + h,
      () => color
    );
  },

  clearRect(x, y, w, h) {
    this.rect(x, y, w, h, [0, 0, 0, 0]);
  },

  roundRect(x, y, w, h, r, color, gradFn) {
    const inShape = (px, py) => {
      if (px < x || px >= x + w || py < y || py >= y + h) return false;
      const cx = px < x + r ? x + r : px > x + w - r ? x + w - r : px;
      const cy = py < y + r ? y + r : py > y + h - r ? y + h - r : py;
      return (px - cx) * (px - cx) + (py - cy) * (py - cy) <= r * r;
    };
    this.paint(inShape, gradFn || (() => color));
  },

  circle(cx, cy, r, color) {
    this.paint(
      (px, py) => (px - cx) * (px - cx) + (py - cy) * (py - cy) <= r * r,
      () => color
    );
  },

  ring(cx, cy, R, r, color, minY, maxY) {
    this.paint(
      (px, py) => {
        if (minY !== undefined && py < minY) return false;
        if (maxY !== undefined && py > maxY) return false;
        const d2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
        return d2 <= R * R && d2 >= r * r;
      },
      () => color
    );
  },

  polygon(points, color) {
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    points.forEach((p) => {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    });
    this.paint((px, py) => {
      if (px < minX || px > maxX || py < minY || py > maxY) return false;
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i][0], yi = points[i][1];
        const xj = points[j][0], yj = points[j][1];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      return inside;
    }, () => color);
  },

  /** 输出降采样后的 RGBA Buffer */
  toRGBA() {
    const { w, h, s, W, H, px } = this;
    const out = Buffer.alloc(w * h * 4);
    const n = s * s;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let dy = 0; dy < s; dy++) {
          for (let dx = 0; dx < s; dx++) {
            const i = ((y * s + dy) * W + (x * s + dx)) * 4;
            r += px[i]; g += px[i + 1]; b += px[i + 2]; a += px[i + 3];
          }
        }
        const o = (y * w + x) * 4;
        out[o] = Math.round(r / n);
        out[o + 1] = Math.round(g / n);
        out[o + 2] = Math.round(b / n);
        out[o + 3] = Math.round(a / n);
      }
    }
    return out;
  },

  save(name) {
    const file = path.join(OUT, name);
    // 保护：项目里的 logo / 头像 / 空态 / tabBar 图标现已由 gen-brand-images.ps1、
    // gen-tab-icons.ps1 绘制成卡通版，这里默认不再覆盖（要重新生成旧版素材加 --force）
    if (!process.argv.includes("--force") && fs.existsSync(file)) {
      console.log("  = images/" + name + "  已存在，跳过（--force 可覆盖）");
      return;
    }
    const buf = encodePNG(this.w, this.h, this.toRGBA());
    fs.writeFileSync(file, buf);
    console.log("  + images/" + name + "  (" + (buf.length / 1024).toFixed(1) + " KB)");
  }
};

/* ============ 调色板 ============ */

const C = {
  primary: [47, 91, 255, 255],
  primaryLight: [76, 124, 255, 255],
  deep: [30, 63, 184, 255],
  white: [255, 255, 255, 255],
  accent: [255, 138, 61, 255],
  tabNormal: [138, 147, 166, 255],
  tabActive: [47, 91, 255, 255]
};

function vGrad(h, c1, c2) {
  return (x, y) => {
    const t = Math.min(1, Math.max(0, y / h));
    return [
      Math.round(c1[0] + (c2[0] - c1[0]) * t),
      Math.round(c1[1] + (c2[1] - c1[1]) * t),
      Math.round(c1[2] + (c2[2] - c1[2]) * t),
      255
    ];
  };
}

/* ============ 素材绘制 ============ */

function drawLogo() {
  const cv = new Canvas(240, 240, 3);
  cv.roundRect(0, 0, 240, 240, 54, null, vGrad(240, C.primaryLight, C.deep));
  // 穹顶（自习厅轮廓）
  cv.ring(120, 150, 96, 84, C.white, 46, 150);
  // 打开的书
  cv.polygon([[50, 152], [113, 140], [113, 198], [50, 208]], C.white);
  cv.polygon([[127, 140], [190, 152], [190, 208], [127, 198]], C.white);
  // 书脊与书签
  cv.rect(113, 141, 14, 57, C.deep);
  cv.rect(146, 150, 9, 26, C.accent);
  cv.save("logo.png");
}

function drawBanners() {
  const palettes = [
    [[61, 107, 255], [108, 61, 255]],
    [[15, 163, 107], [14, 124, 140]],
    [[255, 122, 61], [232, 75, 110]]
  ];
  palettes.forEach((p, i) => {
    const cv = new Canvas(750, 320, 2);
    cv.paint(
      () => true,
      (x, y) => {
        const t = (x / 750 + y / 320) / 2;
        return [
          Math.round(p[0][0] + (p[1][0] - p[0][0]) * t),
          Math.round(p[0][1] + (p[1][1] - p[0][1]) * t),
          Math.round(p[0][2] + (p[1][2] - p[0][2]) * t),
          255
        ];
      }
    );
    cv.circle(620, 60, 120, [255, 255, 255, 28]);
    cv.circle(700, 270, 180, [255, 255, 255, 20]);
    cv.circle(60, 300, 90, [255, 255, 255, 14]);
    cv.rect(0, 300, 750, 20, [255, 255, 255, 26]);
    cv.save("banner-" + (i + 1) + ".png");
  });
}

function drawCovers() {
  const palettes = [
    [[92, 134, 255], [38, 71, 158]],
    [[24, 180, 126], [11, 122, 102]],
    [[142, 107, 255], [74, 51, 184]],
    [[255, 147, 81], [216, 84, 59]],
    [[34, 167, 216], [30, 95, 216]],
    [[124, 142, 168], [60, 74, 99]]
  ];
  palettes.forEach((p, i) => {
    const cv = new Canvas(300, 200, 2);
    cv.paint(() => true, vGrad2(200, p[0], p[1]));
    cv.circle(240, -20, 90, [255, 255, 255, 30]);
    cv.circle(40, 220, 70, [255, 255, 255, 18]);
    cv.roundRect(24, 148, 90, 14, 7, [255, 255, 255, 60]);
    cv.roundRect(24, 168, 56, 10, 5, [255, 255, 255, 40]);
    cv.save("cover-" + (i + 1) + ".png");
  });
}

function vGrad2(h, c1, c2) {
  return (x, y) => {
    const t = Math.min(1, Math.max(0, y / h));
    return [
      Math.round(c1[0] + (c2[0] - c1[0]) * t),
      Math.round(c1[1] + (c2[1] - c1[1]) * t),
      Math.round(c1[2] + (c2[2] - c1[2]) * t),
      255
    ];
  };
}

function drawAvatar() {
  const cv = new Canvas(120, 120, 3);
  cv.paint(
    (x, y) => (x - 60) * (x - 60) + (y - 60) * (y - 60) <= 59 * 59,
    vGrad(120, [143, 176, 255], C.primary)
  );
  cv.circle(60, 48, 15, C.white);
  cv.paint(
    (x, y) =>
      y <= 92 &&
      (x - 60) * (x - 60) + (y - 96) * (y - 96) <= 26 * 26 &&
      (x - 60) * (x - 60) + (y - 60) * (y - 60) <= 57 * 57,
    () => C.white
  );
  cv.save("avatar.png");
}

function drawEmpty() {
  const cv = new Canvas(160, 160, 3);
  cv.ring(80, 80, 60, 55, [228, 234, 244, 255]);
  cv.circle(80, 88, 30, [213, 220, 234, 255]);
  cv.circle(80, 72, 22, [174, 185, 204, 255]);
  cv.rect(58, 84, 44, 6, C.white);
  cv.rect(58, 96, 32, 6, [255, 255, 255, 200]);
  cv.save("empty.png");
}

function drawTabs() {
  const mk = (kind, color) => {
    const cv = new Canvas(81, 81, 4);
    if (kind === "home") {
      cv.polygon([[40.5, 10], [72, 40], [9, 40]], color);
      cv.rect(19, 40, 43, 26, color);
      cv.clearRect(34, 48, 13, 18);
    } else if (kind === "rooms") {
      cv.roundRect(16, 20, 48, 9, 4.5, color);
      cv.roundRect(16, 37, 48, 9, 4.5, color);
      cv.roundRect(16, 54, 34, 9, 4.5, color);
    } else if (kind === "orders") {
      cv.roundRect(18, 12, 45, 58, 8, color);
      const erase = [0, 0, 0, 0];
      cv.circle(18, 41, 8, erase);
      cv.circle(63, 41, 8, erase);
      cv.clearRect(27, 24, 27, 5);
      cv.clearRect(27, 46, 21, 5);
    } else if (kind === "profile") {
      cv.circle(40.5, 27, 12, color);
      cv.paint(
        (x, y) => y <= 60 && (x - 40.5) * (x - 40.5) + (y - 70) * (y - 70) <= 23 * 23,
        () => color
      );
    }
    return cv;
  };
  ["home", "rooms", "orders", "profile"].forEach((kind) => {
    mk(kind, C.tabNormal).save("tab-" + kind + ".png");
    mk(kind, C.tabActive).save("tab-" + kind + "-active.png");
  });
}

/* ============ 主流程 ============ */

console.log("生成自制图片资源 →", OUT);
drawLogo();
// 首页轮播图（banner-*.jpg）与自习室封面（cover-*.jpg）现在由 scripts/compose-covers.ps1
// 从真实配图合成，这里的旧版扁平占位图不再生成，避免产出无人引用的孤儿文件
if (process.argv.includes("--legacy")) {
  drawBanners();
  drawCovers();
} else {
  console.log("  = 跳过 banner-*/cover-*（现由 scripts/compose-covers.ps1 生成，需要旧占位图请加 --legacy）");
}
drawAvatar();
drawEmpty();
drawTabs();
console.log("完成（已存在的文件默认跳过，加 --force 覆盖）。");
