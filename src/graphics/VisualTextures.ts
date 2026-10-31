import * as THREE from 'three';
import { createCanvas, createSeededRandom } from './GraphicsUtils';

/**
 * Bộ sinh texture Canvas thủ công cho Đài Thiên Văn:
 * đá cẩm thạch, vòng cổ ngữ chiêm tinh, dải đồng khắc chữ, quầng sáng
 * và bảng vinh danh tên học sinh (2048 x 1024).
 */

function drawSparkle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha = 1
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.quadraticCurveTo(x + radius * 0.1, y - radius * 0.1, x + radius, y);
  ctx.quadraticCurveTo(x + radius * 0.1, y + radius * 0.1, x, y + radius);
  ctx.quadraticCurveTo(x - radius * 0.1, y + radius * 0.1, x - radius, y);
  ctx.quadraticCurveTo(x - radius * 0.1, y - radius * 0.1, x, y - radius);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function setLetterSpacing(ctx: CanvasRenderingContext2D, value: string): void {
  const withSpacing = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in withSpacing) {
    withSpacing.letterSpacing = value;
  }
}

/* ------------------------------------------------------------------ */
/* Đá cẩm thạch tối màu cho sàn đài và thân cột                        */
/* ------------------------------------------------------------------ */

export function createMarbleTexture(anisotropy: number, size = 1024): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(size, size);
  const rand = createSeededRandom(0x51a7c0de);

  const base = ctx.createRadialGradient(
    size * 0.46,
    size * 0.42,
    size * 0.04,
    size * 0.5,
    size * 0.5,
    size * 0.74
  );
  base.addColorStop(0, '#252a3d');
  base.addColorStop(0.45, '#161a28');
  base.addColorStop(0.78, '#0e111b');
  base.addColorStop(1, '#080a11');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Những đám mây mờ tạo chiều sâu cho mặt đá
  for (let i = 0; i < 30; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (0.05 + rand() * 0.2);
    const cloud = ctx.createRadialGradient(x, y, 0, x, y, r);
    const cool = rand() > 0.35;
    cloud.addColorStop(0, cool ? 'rgba(120, 145, 205, 0.045)' : 'rgba(195, 165, 110, 0.03)');
    cloud.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = cloud;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  ctx.lineCap = 'round';
  // Các đường vân chính uốn lượn như mạch đá
  for (let layer = 0; layer < 3; layer += 1) {
    const veins = layer === 0 ? 18 : 30;
    for (let i = 0; i < veins; i += 1) {
      let x = rand() * size;
      let y = rand() * size;
      ctx.beginPath();
      ctx.moveTo(x, y);

      const segments = 3 + Math.floor(rand() * 3);
      for (let s = 0; s < segments; s += 1) {
        const cx = x + (rand() - 0.5) * size * 0.34;
        const cy = y + (rand() - 0.5) * size * 0.34;
        x += (rand() - 0.5) * size * 0.42;
        y += (rand() - 0.5) * size * 0.42;
        ctx.quadraticCurveTo(cx, cy, x, y);
      }

      const goldenVein = rand() < 0.16;
      const alpha = 0.018 + rand() * 0.055;
      ctx.strokeStyle = goldenVein
        ? `rgba(214, 184, 128, ${alpha * 1.2})`
        : `rgba(142, 168, 226, ${alpha})`;
      ctx.lineWidth = 0.6 + rand() * (layer === 0 ? 3.4 : 1.4);
      if (layer === 1) {
        ctx.shadowColor = 'rgba(150, 178, 255, 0.28)';
        ctx.shadowBlur = 14;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  // Vệt xước mảnh trên bề mặt
  for (let i = 0; i < 240; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const length = 4 + rand() * 36;
    const angle = rand() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    ctx.strokeStyle =
      rand() < 0.2
        ? `rgba(224, 197, 141, ${0.02 + rand() * 0.03})`
        : `rgba(190, 205, 240, ${0.01 + rand() * 0.022})`;
    ctx.lineWidth = 0.5 + rand() * 0.8;
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

/* ------------------------------------------------------------------ */
/* Vòng hoàng đạo / cổ ngữ phát sáng khắc trên sàn                     */
/* ------------------------------------------------------------------ */

export function createZodiacRingTexture(anisotropy: number, size = 2048): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(size, size);
  const c = size / 2;
  const rand = createSeededRandom(0x0ddba11);
  const zodiac = ['♈\uFE0E', '♉\uFE0E', '♊\uFE0E', '♋\uFE0E', '♌\uFE0E', '♍\uFE0E', '♎\uFE0E', '♏\uFE0E', '♐\uFE0E', '♑\uFE0E', '♒\uFE0E', '♓\uFE0E'];

  const gold = ctx.createRadialGradient(c, c, size * 0.16, c, c, size * 0.5);
  gold.addColorStop(0, 'rgba(255, 232, 178, 0.9)');
  gold.addColorStop(0.55, 'rgba(244, 203, 128, 0.75)');
  gold.addColorStop(1, 'rgba(196, 144, 62, 0.5)');

  ctx.strokeStyle = gold;
  ctx.fillStyle = gold;
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(255, 201, 118, 0.55)';
  ctx.shadowBlur = size * 0.012;

  // Vành ngoài và vành trong của dải hoàng đạo
  const outer = c * 0.93;
  const inner = c * 0.7;
  const glyphRadius = c * 0.815;

  ctx.lineWidth = size * 0.0035;
  ctx.beginPath();
  ctx.arc(c, c, outer, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = size * 0.002;
  ctx.beginPath();
  ctx.arc(c, c, outer * 0.972, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = size * 0.0025;
  ctx.beginPath();
  ctx.arc(c, c, inner, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.55;
  ctx.lineWidth = size * 0.0012;
  ctx.beginPath();
  ctx.arc(c, c, inner * 0.93, 0, Math.PI * 2);
  ctx.stroke();

  // Vạch chia độ
  for (let i = 0; i < 144; i += 1) {
    const angle = (i / 144) * Math.PI * 2;
    const major = i % 12 === 0;
    const r1 = outer * (major ? 0.955 : 0.972);
    const r2 = outer * 0.99;
    ctx.globalAlpha = major ? 0.85 : 0.28;
    ctx.lineWidth = major ? size * 0.0022 : size * 0.001;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(angle) * r1, c + Math.sin(angle) * r1);
    ctx.lineTo(c + Math.cos(angle) * r2, c + Math.sin(angle) * r2);
    ctx.stroke();
  }

  // 12 cung hoàng đạo, xoay hướng ra ngoài
  ctx.globalAlpha = 0.92;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(size * 0.053)}px "Cormorant Garamond", "Times New Roman", serif`;
  for (let i = 0; i < zodiac.length; i += 1) {
    const angle = (i / zodiac.length) * Math.PI * 2 - Math.PI / 2;
    const x = c + Math.cos(angle) * glyphRadius;
    const y = c + Math.sin(angle) * glyphRadius;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillStyle = gold;
    ctx.fillText(zodiac[i], 0, 0);
    ctx.restore();
  }

  // Các ngôi sao nhỏ nối nhau thành mạng lưới 28 điểm bên trong
  const webRadius = c * 0.575;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = size * 0.0009;
  ctx.strokeStyle = 'rgba(156, 199, 255, 0.55)';
  ctx.beginPath();
  for (let i = 0; i < 28; i += 1) {
    const angle = (i / 28) * Math.PI * 2 - Math.PI / 2;
    const jitter = 0.94 + rand() * 0.12;
    const x = c + Math.cos(angle) * webRadius * jitter;
    const y = c + Math.sin(angle) * webRadius * jitter;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();

  for (let i = 0; i < 28; i += 1) {
    const angle = (i / 28) * Math.PI * 2 - Math.PI / 2;
    const jitter = 0.94 + hash(i) * 0.12;
    const x = c + Math.cos(angle) * webRadius * jitter;
    const y = c + Math.sin(angle) * webRadius * jitter;
    drawSparkle(ctx, x, y, size * (0.004 + hash(i + 9) * 0.004), '#d8ecff', 0.8);
  }

  // La bàn trung tâm
  ctx.globalAlpha = 0.42;
  ctx.strokeStyle = gold;
  ctx.lineWidth = size * 0.0016;
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(angle) * c * 0.06, c + Math.sin(angle) * c * 0.06);
    ctx.lineTo(c + Math.cos(angle) * c * 0.38, c + Math.sin(angle) * c * 0.38);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.4, 0, Math.PI * 2);
  ctx.stroke();
  drawSparkle(ctx, c, c, size * 0.036, '#ffe7b0', 0.9);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

function hash(seed: number): number {
  const x = Math.sin(seed * 91.7 + 12.3) * 43758.5453;
  return x - Math.floor(x);
}

/* ------------------------------------------------------------------ */
/* Dải đồng cổ có vạch khắc phát sáng                                  */
/* ------------------------------------------------------------------ */

export interface BrassTextures {
  map: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
}

export function createBrassTextures(anisotropy: number): BrassTextures {
  const width = 1024;
  const height = 128;
  const rand = createSeededRandom(0xb7a55);

  /* --- Albedo đồng cổ --- */
  const { canvas, ctx } = createCanvas(width, height);
  const brass = ctx.createLinearGradient(0, 0, 0, height);
  brass.addColorStop(0, '#3b2a12');
  brass.addColorStop(0.18, '#8d6a2e');
  brass.addColorStop(0.42, '#e0bb77');
  brass.addColorStop(0.58, '#caa25c');
  brass.addColorStop(0.82, '#6e4f20');
  brass.addColorStop(1, '#2a1d0a');
  ctx.fillStyle = brass;
  ctx.fillRect(0, 0, width, height);

  // Vệt xước kim loại dọc theo chu vi
  for (let i = 0; i < 80; i += 1) {
    const x = rand() * width;
    const w = 1 + rand() * 18;
    ctx.fillStyle =
      rand() > 0.5
        ? `rgba(255, 236, 186, ${0.02 + rand() * 0.05})`
        : `rgba(40, 28, 10, ${0.03 + rand() * 0.06})`;
    ctx.fillRect(x, 0, w, height);
  }

  // Đốm patina xanh rêu
  for (let i = 0; i < 22; i += 1) {
    const x = rand() * width;
    const y = rand() * height;
    const r = 6 + rand() * 26;
    const patina = ctx.createRadialGradient(x, y, 0, x, y, r);
    patina.addColorStop(0, 'rgba(74, 112, 92, 0.18)');
    patina.addColorStop(1, 'rgba(74, 112, 92, 0)');
    ctx.fillStyle = patina;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Rãnh khắc ngang + vạch chia dọc
  ctx.strokeStyle = 'rgba(38, 25, 8, 0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.27);
  ctx.lineTo(width, height * 0.27);
  ctx.moveTo(0, height * 0.73);
  ctx.lineTo(width, height * 0.73);
  ctx.stroke();

  const tickXs: number[] = [];
  for (let x = 16; x < width; x += 32) {
    tickXs.push(x);
    ctx.strokeStyle = 'rgba(45, 30, 10, 0.55)';
    ctx.lineWidth = x % 128 === 16 ? 2.4 : 1.1;
    ctx.beginPath();
    ctx.moveTo(x, height * 0.3);
    ctx.lineTo(x, height * 0.7);
    ctx.stroke();

    if (x % 128 === 16) {
      drawSparkle(ctx, x, height * 0.5, 5, 'rgba(58, 40, 14, 0.75)', 0.9);
    }
  }

  /* --- Kênh phát sáng của vạch khắc --- */
  const glow = createCanvas(width, height);
  glow.ctx.fillStyle = '#000000';
  glow.ctx.fillRect(0, 0, width, height);
  glow.ctx.lineCap = 'round';

  glow.ctx.strokeStyle = 'rgba(255, 178, 82, 0.65)';
  glow.ctx.lineWidth = 1.2;
  glow.ctx.beginPath();
  glow.ctx.moveTo(0, height * 0.27);
  glow.ctx.lineTo(width, height * 0.27);
  glow.ctx.moveTo(0, height * 0.73);
  glow.ctx.lineTo(width, height * 0.73);
  glow.ctx.stroke();

  for (const x of tickXs) {
    const major = x % 128 === 16;
    glow.ctx.strokeStyle = major ? 'rgba(255, 206, 130, 0.95)' : 'rgba(255, 170, 76, 0.5)';
    glow.ctx.lineWidth = major ? 3 : 1.2;
    glow.ctx.beginPath();
    glow.ctx.moveTo(x, height * (major ? 0.22 : 0.3));
    glow.ctx.lineTo(x, height * (major ? 0.78 : 0.7));
    glow.ctx.stroke();
  }

  // Điểm sáng lấp lánh chạy dọc dải đồng
  for (let i = 0; i < 10; i += 1) {
    const x = rand() * width;
    const y = height * (0.38 + rand() * 0.24);
    const spark = glow.ctx.createRadialGradient(x, y, 0, x, y, 7);
    spark.addColorStop(0, 'rgba(255, 235, 190, 0.9)');
    spark.addColorStop(1, 'rgba(255, 200, 120, 0)');
    glow.ctx.fillStyle = spark;
    glow.ctx.fillRect(x - 7, y - 7, 14, 14);
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(6, 1);
  map.anisotropy = anisotropy;
  map.needsUpdate = true;

  const emissiveMap = new THREE.CanvasTexture(glow.canvas);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.wrapS = THREE.RepeatWrapping;
  emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.repeat.set(6, 1);
  emissiveMap.anisotropy = anisotropy;
  emissiveMap.needsUpdate = true;

  return { map, emissiveMap };
}

/* ------------------------------------------------------------------ */
/* Quầng sáng radial dùng cho flash sprite                             */
/* ------------------------------------------------------------------ */

export function createGlowTexture(size = 256): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(size, size);
  const c = size / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.12, 'rgba(255, 252, 240, 0.95)');
  gradient.addColorStop(0.3, 'rgba(200, 226, 255, 0.42)');
  gradient.addColorStop(0.6, 'rgba(120, 170, 255, 0.12)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/* ------------------------------------------------------------------ */
/* Hologram tên học sinh (mờ, phát sáng) khi tia sáng chạm sao         */
/* ------------------------------------------------------------------ */

export function createHologramNameTexture(studentName: string): THREE.CanvasTexture {
  const cleanName = (studentName || '').normalize('NFC');
  const width = 768;
  const height = 192;
  const { canvas, ctx } = createCanvas(width, height);
  const cx = width / 2;
  const cy = height * 0.47;

  const font = (px: number) =>
    `600 ${px}px "Be Vietnam Pro", "Segoe UI", "Times New Roman", sans-serif`;

  let fontSize = 76;
  ctx.font = font(fontSize);
  while (ctx.measureText(cleanName).width > width * 0.78 && fontSize > 34) {
    fontSize -= 2;
    ctx.font = font(fontSize);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Quầng xanh lạnh phía sau chữ
  ctx.save();
  ctx.filter = 'blur(12px)';
  ctx.fillStyle = 'rgba(86, 198, 255, 0.55)';
  ctx.fillText(cleanName, cx, cy);
  ctx.restore();

  // Lớp chữ hologram hơi nhòe
  ctx.save();
  ctx.filter = 'blur(2.6px)';
  ctx.fillStyle = 'rgba(205, 246, 255, 0.92)';
  ctx.shadowColor = 'rgba(120, 220, 255, 0.85)';
  ctx.shadowBlur = 20;
  ctx.fillText(cleanName, cx, cy);
  ctx.restore();

  // Vạch quét và vạch chia hai bên
  const lineY = cy + fontSize * 0.72;
  ctx.strokeStyle = 'rgba(150, 225, 255, 0.32)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(width * 0.2, lineY);
  ctx.lineTo(width * 0.8, lineY);
  ctx.stroke();

  for (let i = 0; i < 16; i += 1) {
    const x = width * 0.2 + (i / 15) * width * 0.6;
    const length = i % 4 === 0 ? 8 : 4;
    ctx.beginPath();
    ctx.moveTo(x, lineY);
    ctx.lineTo(x, lineY + length);
    ctx.stroke();
  }

  drawSparkle(ctx, width * 0.12, cy, 5, '#ffe4a3', 0.8);
  drawSparkle(ctx, width * 0.88, cy, 5, '#ffe4a3', 0.8);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/* ------------------------------------------------------------------ */
/* Bảng vinh danh tên học sinh 2048 x 1024                             */
/* ------------------------------------------------------------------ */

export function createNamePlaqueTexture(studentName: string, anisotropy: number): THREE.CanvasTexture {
  const cleanName = (studentName || '').normalize('NFC');
  const width = 2048;
  const height = 1024;
  const { canvas, ctx } = createCanvas(width, height);
  const rand = createSeededRandom(0x7e5a11);
  const cx = width / 2;

  // Hào quang vàng dịu phía sau khung
  const aura = ctx.createRadialGradient(cx, height * 0.48, 40, cx, height * 0.48, width * 0.46);
  aura.addColorStop(0, 'rgba(255, 203, 118, 0.2)');
  aura.addColorStop(0.42, 'rgba(255, 178, 86, 0.08)');
  aura.addColorStop(1, 'rgba(255, 160, 60, 0)');
  ctx.fillStyle = aura;
  ctx.fillRect(0, 0, width, height);

  const frameX = 96;
  const frameY = 88;
  const frameW = width - frameX * 2;
  const frameH = height - frameY * 2;
  const radius = 68;

  // Nền khung thiên văn
  const panel = ctx.createLinearGradient(0, frameY, 0, frameY + frameH);
  panel.addColorStop(0, 'rgba(9, 13, 27, 0.9)');
  panel.addColorStop(0.55, 'rgba(14, 18, 35, 0.86)');
  panel.addColorStop(1, 'rgba(8, 10, 21, 0.93)');
  roundedRectPath(ctx, frameX, frameY, frameW, frameH, radius);
  ctx.fillStyle = panel;
  ctx.fill();

  // Chòm sao mờ điểm xuyết trong nền
  ctx.save();
  roundedRectPath(ctx, frameX, frameY, frameW, frameH, radius);
  ctx.clip();
  const bgStars: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 64; i += 1) {
    const x = frameX + 60 + rand() * (frameW - 120);
    const y = frameY + 50 + rand() * (frameH - 100);
    const r = 1 + rand() * 2.6;
    bgStars.push({ x, y });
    ctx.globalAlpha = 0.15 + rand() * 0.4;
    ctx.fillStyle = rand() > 0.75 ? 'rgba(255, 220, 160, 0.9)' : 'rgba(180, 210, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.1;
  ctx.strokeStyle = 'rgba(175, 205, 255, 0.8)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 16; i += 1) {
    const a = bgStars[(i * 3) % bgStars.length];
    const b = bgStars[(i * 5 + 7) % bgStars.length];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();

  // Khung viền đồng-kim hai lớp
  const borderGradient = ctx.createLinearGradient(frameX, frameY, frameX + frameW, frameY + frameH);
  borderGradient.addColorStop(0, 'rgba(255, 239, 197, 0.95)');
  borderGradient.addColorStop(0.22, 'rgba(214, 172, 98, 0.9)');
  borderGradient.addColorStop(0.5, 'rgba(255, 228, 168, 0.85)');
  borderGradient.addColorStop(0.78, 'rgba(188, 138, 66, 0.9)');
  borderGradient.addColorStop(1, 'rgba(255, 240, 202, 0.95)');

  ctx.shadowColor = 'rgba(255, 198, 110, 0.55)';
  ctx.shadowBlur = 34;
  roundedRectPath(ctx, frameX, frameY, frameW, frameH, radius);
  ctx.strokeStyle = borderGradient;
  ctx.lineWidth = 7;
  ctx.stroke();

  ctx.shadowBlur = 0;
  roundedRectPath(ctx, frameX + 20, frameY + 20, frameW - 40, frameH - 40, radius - 14);
  ctx.strokeStyle = 'rgba(255, 235, 188, 0.34)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Hoa văn góc khung
  const corners: Array<[number, number, number]> = [
    [frameX + 54, frameY + 54, 1],
    [frameX + frameW - 54, frameY + 54, -1],
    [frameX + 54, frameY + frameH - 54, 1],
    [frameX + frameW - 54, frameY + frameH - 54, -1],
  ];
  for (const [x, y, dir] of corners) {
    drawSparkle(ctx, x, y, 20, '#f3d99b', 0.85);
    ctx.strokeStyle = 'rgba(238, 204, 138, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + dir * 24, y);
    ctx.lineTo(x + dir * 92, y);
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Biểu tượng ngôi sao định mệnh
  drawSparkle(ctx, cx, frameY + 116, 32, '#ffe8b5', 0.95);
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = 'rgba(255, 219, 154, 0.75)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 190, frameY + 116);
  ctx.lineTo(cx - 46, frameY + 116);
  ctx.moveTo(cx + 46, frameY + 116);
  ctx.lineTo(cx + 190, frameY + 116);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Tiêu đề
  setLetterSpacing(ctx, '12px');
  ctx.font = '700 46px "Playfair Display", "Be Vietnam Pro", "Times New Roman", "Segoe UI", serif';
  ctx.fillStyle = '#e8cfa0';
  ctx.shadowColor = 'rgba(255, 193, 92, 0.5)';
  ctx.shadowBlur = 22;
  ctx.fillText('VINH DANH NGÔI SAO ĐỊNH MỆNH', cx, frameY + 212);
  ctx.shadowBlur = 0;
  setLetterSpacing(ctx, '0px');

  // Đường phân cách dưới tiêu đề
  const dividerY = frameY + 268;
  const divider = ctx.createLinearGradient(cx - 620, 0, cx + 620, 0);
  divider.addColorStop(0, 'rgba(255, 228, 170, 0)');
  divider.addColorStop(0.5, 'rgba(255, 228, 170, 0.75)');
  divider.addColorStop(1, 'rgba(255, 228, 170, 0)');
  ctx.strokeStyle = divider;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 620, dividerY);
  ctx.lineTo(cx - 20, dividerY);
  ctx.moveTo(cx + 20, dividerY);
  ctx.lineTo(cx + 620, dividerY);
  ctx.stroke();
  drawSparkle(ctx, cx, dividerY, 11, '#ffe5ae', 0.9);

  // Tên học sinh — sử dụng font hỗ trợ tiếng Việt chuẩn xác và co chữ vừa khung
  let nameSize = 180;
  const nameFont = (px: number) =>
    `700 ${px}px "Playfair Display", "Be Vietnam Pro", "Times New Roman", "Segoe UI", serif`;
  ctx.font = nameFont(nameSize);
  while (ctx.measureText(cleanName).width > frameW - 280 && nameSize > 72) {
    nameSize -= 4;
    ctx.font = nameFont(nameSize);
  }

  const nameY = frameY + frameH * 0.54;
  const nameGradient = ctx.createLinearGradient(0, nameY - nameSize * 0.7, 0, nameY + nameSize * 0.5);
  nameGradient.addColorStop(0, '#fff9e8');
  nameGradient.addColorStop(0.42, '#f5ddA4');
  nameGradient.addColorStop(0.74, '#d8ae62');
  nameGradient.addColorStop(1, '#f9ecc8');
  ctx.fillStyle = nameGradient;
  ctx.strokeStyle = 'rgba(84, 56, 18, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.shadowColor = 'rgba(255, 198, 96, 0.62)';
  ctx.shadowBlur = 46;
  ctx.fillText(cleanName, cx, nameY);
  ctx.shadowBlur = 0;
  ctx.strokeText(cleanName, cx, nameY);

  // Chòm sao trang trí cuối khung
  const ornamentY = frameY + frameH - 104;
  const ornamentPoints: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 7; i += 1) {
    ornamentPoints.push({
      x: cx - 330 + i * 110,
      y: ornamentY + Math.sin(i * 1.7) * 16,
    });
  }
  ctx.strokeStyle = 'rgba(255, 227, 170, 0.35)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ornamentPoints.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  for (let i = 0; i < ornamentPoints.length; i += 1) {
    const point = ornamentPoints[i];
    drawSparkle(ctx, point.x, point.y, i === 3 ? 13 : 7, i === 3 ? '#ffeec4' : '#d6e7ff', 0.85);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}
