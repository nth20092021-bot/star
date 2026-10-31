import * as THREE from 'three';
import type { StarNode } from '../shared/CosmicTypes';
import { createGlowTexture, createNamePlaqueTexture } from './VisualTextures';
import {
  clamp,
  createSeededRandom,
  disposeObjectTree,
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
} from './GraphicsUtils';

interface ShockwaveRing {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  delay: number;
  duration: number;
  intensity: number;
}

/**
 * Vụ nổ Siêu Tân Tinh dịu nhẹ & huyền ảo.
 *
 * - Ngôi sao chiến thắng co lại một nhịp (flash co) rồi bung tỏa.
 * - 3 vành sóng xung kích (shockwave ring shader) giãn nở.
 * - Hàng trăm hạt bụi tinh tú bay chậm (GPU points).
 * - Bảng tên học sinh 2048x1024 phóng to từ tâm nổ ra giữa bầu trời.
 *
 * Bảng tên được vẽ trong một overlay pass SAU UnrealBloomPass, nhờ đó chữ
 * giữ độ sắc nét tuyệt đối dù các vì sao xung quanh rực sáng bloom.
 */
export class SupernovaEffect {
  private readonly scene: THREE.Scene;
  private readonly root = new THREE.Group();
  private readonly glowTexture: THREE.CanvasTexture;
  private readonly flashSprite: THREE.Sprite;
  private readonly flashMaterial: THREE.SpriteMaterial;
  private readonly winnerHalo: THREE.Sprite;
  private readonly haloMaterial: THREE.SpriteMaterial;

  private readonly shockwaves: ShockwaveRing[] = [];
  private readonly particles: THREE.Points;
  private readonly particleUniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
  };

  private readonly overlayScene = new THREE.Scene();
  private readonly overlayCamera: THREE.OrthographicCamera;
  private readonly plaqueMesh: THREE.Mesh;
  private readonly plaqueMaterial: THREE.MeshBasicMaterial;
  private plaqueTexture: THREE.CanvasTexture | null = null;

  private readonly maxAnisotropy: number;
  private viewportWidth: number;
  private viewportHeight: number;

  private active = false;
  private time = 0;
  private bloomBoost = 0;
  private readonly projected = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    maxAnisotropy: number,
    viewportWidth: number,
    viewportHeight: number
  ) {
    this.scene = scene;
    this.maxAnisotropy = maxAnisotropy;
    this.viewportWidth = Math.max(1, viewportWidth);
    this.viewportHeight = Math.max(1, viewportHeight);

    this.root.name = 'SupernovaEffectRoot';
    this.root.visible = false;
    scene.add(this.root);

    this.glowTexture = createGlowTexture(256);

    /* --------------------- Flash co & bung nổ ------------------- */
    this.flashMaterial = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: new THREE.Color(2.2, 1.85, 1.3),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.flashSprite = new THREE.Sprite(this.flashMaterial);
    this.flashSprite.visible = false;
    this.flashSprite.renderOrder = 30;
    this.root.add(this.flashSprite);

    this.haloMaterial = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: new THREE.Color(1.45, 1.02, 0.58),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.winnerHalo = new THREE.Sprite(this.haloMaterial);
    this.winnerHalo.visible = false;
    this.winnerHalo.renderOrder = 26;
    this.root.add(this.winnerHalo);

    /* --------------------- Vành xung kích ----------------------- */
    this.shockwaves.push(
      this.createShockwave(21, new THREE.Color(1.35, 0.95, 0.45), 0.08, 2.3, 1.15)
    );
    this.shockwaves.push(
      this.createShockwave(32, new THREE.Color(0.5, 0.95, 1.25), 0.26, 2.7, 0.95)
    );
    this.shockwaves.push(
      this.createShockwave(43, new THREE.Color(0.85, 0.58, 1.45), 0.5, 3.1, 0.75)
    );

    /* ------------------------ Bụi tinh tú ------------------------ */
    this.particles = this.createDustBurst();
    this.root.add(this.particles);

    /* ------------------------ Bảng tên -------------------------- */
    this.overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
    this.overlayCamera.position.z = 5;
    this.applyOverlayViewport();

    this.plaqueMaterial = new THREE.MeshBasicMaterial({
      name: 'WinnerNamePlaque',
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.plaqueMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.plaqueMaterial);
    this.plaqueMesh.visible = false;
    this.plaqueMesh.frustumCulled = false;
    this.plaqueMesh.renderOrder = 2;
    this.overlayScene.add(this.plaqueMesh);
  }

  /* ------------------------------------------------------------------ */
  /* Dựng vành xung kích                                                */
  /* ------------------------------------------------------------------ */

  private createShockwave(
    maxRadius: number,
    color: THREE.Color,
    delay: number,
    duration: number,
    intensity: number
  ): ShockwaveRing {
    const material = new THREE.ShaderMaterial({
      name: 'SupernovaShockwave',
      uniforms: {
        uProgress: { value: 0 },
        uAlpha: { value: 0 },
        uColor: { value: color },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: SHOCKWAVE_VERTEX,
      fragmentShader: SHOCKWAVE_FRAGMENT,
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.scale.setScalar(maxRadius * 2);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 24;
    this.root.add(mesh);

    return { mesh, material, delay, duration, intensity };
  }

  /* ------------------------------------------------------------------ */
  /* Dựng bụi tinh tú                                                   */
  /* ------------------------------------------------------------------ */

  private createDustBurst(): THREE.Points {
    const count = 760;
    const rand = createSeededRandom(0x5b0b0b);
    const directions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    const seeds = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    const palette = [
      new THREE.Color(2.3, 1.55, 0.62),
      new THREE.Color(0.62, 1.7, 2.2),
      new THREE.Color(1.35, 0.68, 2.2),
      new THREE.Color(2.3, 2.15, 1.9),
    ];

    for (let i = 0; i < count; i += 1) {
      const y = rand() * 2 - 1;
      const theta = rand() * Math.PI * 2;
      const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
      const direction = new THREE.Vector3(
        Math.cos(theta) * ringRadius,
        y * 0.82,
        Math.sin(theta) * ringRadius
      ).normalize();

      directions[i * 3] = direction.x;
      directions[i * 3 + 1] = direction.y;
      directions[i * 3 + 2] = direction.z;

      speeds[i] = 2.4 + Math.pow(rand(), 1.6) * 11.5;
      sizes[i] = 0.75 + Math.pow(rand(), 2.2) * 2.4;
      seeds[i] = rand();

      const tint = palette[Math.floor(rand() * palette.length)];
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aDir', new THREE.BufferAttribute(directions, 3));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.ShaderMaterial({
      name: 'SupernovaDustBurst',
      uniforms: this.particleUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexShader: DUST_VERTEX,
      fragmentShader: DUST_FRAGMENT,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 22;
    points.visible = false;
    return points;
  }

  /* ------------------------------------------------------------------ */
  /* Kích hoạt                                                          */
  /* ------------------------------------------------------------------ */

  public trigger(winnerStar: StarNode): void {
    const position = winnerStar.currentPosition;
    const base = winnerStar.basePosition;
    const valid =
      position && Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
    this.root.position.copy(valid ? position : base);

    this.active = true;
    this.time = 0;
    this.bloomBoost = 0;

    this.flashSprite.visible = true;
    this.flashSprite.scale.setScalar(10.5);
    this.flashMaterial.opacity = 0.55;

    this.winnerHalo.visible = false;
    this.haloMaterial.opacity = 0;

    for (const ring of this.shockwaves) {
      ring.mesh.visible = false;
      ring.material.uniforms.uProgress.value = 0;
      ring.material.uniforms.uAlpha.value = 0;
    }

    this.particles.visible = false;
    this.particleUniforms.uTime.value = 0;

    this.root.visible = true;

    if (this.plaqueTexture) {
      this.plaqueTexture.dispose();
      this.plaqueTexture = null;
    }
    this.plaqueTexture = createNamePlaqueTexture(
      winnerStar.studentName || 'Ngôi Sao Định Mệnh',
      this.maxAnisotropy
    );
    this.plaqueMaterial.map = this.plaqueTexture;
    this.plaqueMaterial.opacity = 0;
    this.plaqueMaterial.needsUpdate = true;
    this.plaqueMesh.visible = true;
    this.plaqueMesh.scale.set(1, 1, 1);
    this.plaqueMesh.position.set(0, 0, 0);
  }

  /* ------------------------------------------------------------------ */
  /* Cập nhật mỗi frame                                                 */
  /* ------------------------------------------------------------------ */

  public update(dt: number, camera: THREE.Camera): void {
    if (!this.active) return;

    this.time += dt;
    const t = this.time;

    // Ngôi sao co lại rồi bung flash
    if (t < 0.24) {
      const p = clamp(t / 0.24, 0, 1);
      const scale = THREE.MathUtils.lerp(7.5, 1.7, easeInOutCubic(p));
      this.flashSprite.scale.setScalar(scale);
      this.flashMaterial.opacity = 0.5 + 0.3 * p;
    } else {
      const q = clamp((t - 0.24) / 1.6, 0, 1);
      if (q < 1) {
        this.flashSprite.visible = true;
        const scale = THREE.MathUtils.lerp(1.7, 30, easeOutCubic(q));
        this.flashSprite.scale.setScalar(scale);
        this.flashMaterial.opacity = Math.pow(1 - q, 1.7) * 0.55;
      } else {
        this.flashSprite.visible = false;
        this.flashMaterial.opacity = 0;
      }
    }

    // Quầng sáng vinh danh tồn tại cùng bảng tên
    if (t > 0.18) {
      const q = clamp((t - 0.18) / 1.1, 0, 1);
      this.winnerHalo.visible = true;
      const haloScale = 5.4 + 2.0 * easeOutCubic(q) + Math.sin(t * 0.9) * 0.7;
      this.winnerHalo.scale.setScalar(haloScale);
      this.haloMaterial.opacity =
        (0.12 + 0.08 * Math.sin(t * 1.3)) * q + Math.max(0, 0.12 * Math.exp(-(t - 0.3) * 0.5));
    }

    // Sóng xung kích
    for (const ring of this.shockwaves) {
      const progress = (t - ring.delay) / ring.duration;
      if (progress <= 0 || progress >= 1) {
        ring.mesh.visible = false;
        continue;
      }

      ring.mesh.visible = true;
      ring.mesh.quaternion.copy(camera.quaternion);

      const fadeIn = clamp(progress / 0.05, 0, 1);
      const fadeOut = Math.pow(1 - progress, 1.65);
      ring.material.uniforms.uProgress.value = progress;
      ring.material.uniforms.uAlpha.value = fadeIn * fadeOut * ring.intensity;
    }

    // Bụi tinh tú
    this.particles.visible = t > 0.2 && t < 8.6;
    this.particleUniforms.uTime.value = Math.max(0, t - 0.22);

    // Bloom dâng lên rồi lắng xuống
    const rise = clamp((t - 0.16) / 0.22, 0, 1);
    this.bloomBoost = clamp(rise * Math.exp(-Math.max(0, t - 0.38) * 0.72), 0, 1);
  }

  /* ------------------------------------------------------------------ */
  /* Bảng tên overlay (sau bloom)                                       */
  /* ------------------------------------------------------------------ */

  public renderOverlay(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    if (!this.active || !this.plaqueTexture || this.time < 0.55) return;

    this.updatePlaqueTransform(camera);

    renderer.setRenderTarget(null);
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.overlayScene, this.overlayCamera);
    renderer.autoClear = previousAutoClear;
  }

  private updatePlaqueTransform(camera: THREE.Camera): void {
    const width = this.viewportWidth;
    const height = this.viewportHeight;
    const t = this.time;

    const baseWidth = Math.min(width * 0.86, height * 1.25, 900);
    const baseHeight = baseWidth * 0.5;

    const appear = clamp((t - 0.55) / 2.1, 0, 1);
    const pop = Math.min(1.035, easeOutBack(appear));
    const scaleMultiplier = 0.08 + 0.92 * pop;

    this.projected.copy(this.root.position).project(camera);
    let screenX = (this.projected.x * 0.5 + 0.5) * width;
    let screenY = (-this.projected.y * 0.5 + 0.5) * height;
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) {
      screenX = width * 0.5;
      screenY = height * 0.5;
    }

    const startX = screenX - width * 0.5;
    const startY = height * 0.5 - screenY;
    const targetX = 0;
    const targetY = height * 0.035;

    const move = easeInOutCubic(clamp((t - 0.55) / 1.55, 0, 1));
    const float = Math.sin(t * 0.55) * 1.6 * move;
    const x = THREE.MathUtils.lerp(startX, targetX, move);
    const y = THREE.MathUtils.lerp(startY, targetY, move) + float;

    this.plaqueMesh.position.set(x, y, 0);
    this.plaqueMesh.scale.set(baseWidth * scaleMultiplier, baseHeight * scaleMultiplier, 1);
    this.plaqueMaterial.opacity = clamp((t - 0.55) / 0.85, 0, 1) * 0.98;
  }

  private applyOverlayViewport(): void {
    const halfWidth = this.viewportWidth * 0.5;
    const halfHeight = this.viewportHeight * 0.5;
    this.overlayCamera.left = -halfWidth;
    this.overlayCamera.right = halfWidth;
    this.overlayCamera.top = halfHeight;
    this.overlayCamera.bottom = -halfHeight;
    this.overlayCamera.updateProjectionMatrix();
  }

  /* ------------------------------------------------------------------ */
  /* API phụ                                                            */
  /* ------------------------------------------------------------------ */

  public setPixelRatio(pixelRatio: number): void {
    this.particleUniforms.uPixelRatio.value = Math.max(1, pixelRatio);
  }

  public resize(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    this.applyOverlayViewport();
  }

  public getBloomBoost(): number {
    return this.active ? this.bloomBoost : 0;
  }

  public reset(): void {
    this.active = false;
    this.time = 0;
    this.bloomBoost = 0;
    this.root.visible = false;
    this.flashSprite.visible = false;
    this.winnerHalo.visible = false;
    this.particles.visible = false;
    for (const ring of this.shockwaves) {
      ring.mesh.visible = false;
    }

    this.plaqueMesh.visible = false;
    this.plaqueMaterial.opacity = 0;
    if (this.plaqueTexture) {
      this.plaqueTexture.dispose();
      this.plaqueTexture = null;
    }
    this.plaqueMaterial.map = null;
    this.plaqueMaterial.needsUpdate = true;
  }

  public dispose(): void {
    disposeObjectTree(this.root);
    disposeObjectTree(this.overlayScene);
    this.scene.remove(this.root);
    this.plaqueTexture = null;
  }
}

/* ====================================================================== */
/* Shader: vành sóng xung kích                                            */
/* ====================================================================== */

const SHOCKWAVE_VERTEX = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SHOCKWAVE_FRAGMENT = /* glsl */ `
  uniform float uProgress;
  uniform float uAlpha;
  uniform vec3 uColor;

  varying vec2 vUv;

  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;

    float ringRadius = uProgress * 0.94;
    float ringWidth = 0.01 + 0.034 * (1.0 - uProgress);
    float ring = smoothstep(ringWidth, 0.0, abs(r - ringRadius));

    float innerHalo = smoothstep(ringRadius, max(ringRadius - 0.32, 0.0), r) * 0.1;

    float angle = atan(p.y, p.x);
    float shimmer = 0.75 + 0.25 * sin(angle * 9.0 + uProgress * 12.0);
    ring *= shimmer;

    float alpha = (ring + innerHalo) * uAlpha;
    vec3 color = uColor * (1.2 + ring * 2.6);

    gl_FragColor = vec4(color, alpha);
  }
`;

/* ====================================================================== */
/* Shader: bụi tinh tú nổ chậm                                           */
/* ====================================================================== */

const DUST_VERTEX = /* glsl */ `
  attribute vec3 aDir;
  attribute float aSpeed;
  attribute float aSize;
  attribute float aSeed;
  attribute vec3 aColor;

  uniform float uTime;
  uniform float uPixelRatio;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float t = uTime;

    float drift = (1.0 - exp(-0.55 * t)) / 0.55;
    vec3 pos = aDir * aSpeed * drift;

    float swirl = t * (0.08 + aSeed * 0.22);
    float c = cos(swirl);
    float s = sin(swirl);
    pos.xz = mat2(c, -s, s, c) * pos.xz;

    pos += vec3(
      sin(t * 0.6 + aSeed * 12.0),
      cos(t * 0.5 + aSeed * 9.0),
      sin(t * 0.45 + aSeed * 15.0)
    ) * (0.3 + aSeed * 0.55);

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float size = aSize * uPixelRatio * (260.0 / max(-mvPosition.z, 1.0));
    size *= 0.7 + 0.3 * sin(t * 2.2 + aSeed * 20.0);
    gl_PointSize = clamp(size, 1.0, 24.0);

    float fadeIn = smoothstep(0.0, 0.22, t);
    float fadeOut = 1.0 - smoothstep(4.6, 8.4, t);
    vAlpha = fadeIn * fadeOut * (0.45 + 0.55 * abs(sin(t * 1.7 + aSeed * 30.0)));
    vColor = aColor;
  }
`;

const DUST_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    float core = smoothstep(0.5, 0.0, d);
    float spikes =
      max(0.0, 1.0 - abs(p.x) * 11.0) * core +
      max(0.0, 1.0 - abs(p.y) * 11.0) * core;

    float alpha = (core * core + spikes * 0.22) * vAlpha;
    gl_FragColor = vec4(vColor * 1.55, alpha);
  }
`;
