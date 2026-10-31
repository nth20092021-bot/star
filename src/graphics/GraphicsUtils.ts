import * as THREE from 'three';

/**
 * Các tiện ích dùng chung cho lớp đồ họa (/src/graphics).
 * Không phụ thuộc vào vật lý hay trạng thái của Core.
 */

/** Kẹp giá trị trong khoảng [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Nội suy mượt theo thời gian thực (frame-rate independent damping). */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * Math.max(0, dt)));
}

/** Easing cubic mềm dùng cho camera / plaque. */
export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Easing nảy nhẹ khi bảng tên bung ra. */
export function easeOutBack(t: number): number {
  const c1 = 1.402;
  const c3 = c1 + 1;
  const x = clamp(t, 0, 1);
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

export function easeOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return 1 - Math.pow(1 - x, 3);
}

/** Hash 1 chiều ổn định, dùng cho pha nhấp nháy của sao. */
export function hash01(seed: number): number {
  let x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  x -= Math.floor(x);
  return x;
}

/** Bộ sinh số giả ngẫu nhiên có seed, tái lập được giữa các lần render. */
export function createSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Giải phóng toàn bộ geometry / material / texture trong một cây Object3D.
 * Dùng Set để tránh dispose trùng các tài nguyên chia sẻ.
 */
export function disposeObjectTree(root: THREE.Object3D | null | undefined): void {
  if (!root) return;

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((object) => {
    const renderable = object as THREE.Mesh;
    if (renderable.geometry) {
      geometries.add(renderable.geometry);
    }

    const material = (object as THREE.Mesh).material as
      | THREE.Material
      | THREE.Material[]
      | undefined;

    if (material) {
      const list = Array.isArray(material) ? material : [material];
      for (const item of list) {
        materials.add(item);
        for (const value of Object.values(item)) {
          if (value instanceof THREE.Texture) {
            textures.add(value);
          }
        }
      }
    }
  });

  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

/** Tạo một texture canvas rỗng với ngữ cảnh 2D đã sẵn sàng. */
export function createCanvas(
  width: number,
  height: number
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('[Graphics] CanvasRenderingContext2D không khả dụng.');
  }
  return { canvas, ctx };
}
