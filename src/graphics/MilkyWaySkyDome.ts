import * as THREE from 'three';
import { createSeededRandom } from './GraphicsUtils';

/**
 * Vòm trời đêm Milky Way.
 *
 * Custom GLSL: Simplex noise đa tầng (FBM) tái hiện dải ngân hà với tinh vân
 * tím thẫm, xanh lam vũ trụ và vàng kim. Hàng ngàn ngôi sao nền li ti được
 * render bằng point sprite shader tròn, sắc nét, lấp lánh theo pha riêng và
 * dồn dày hơn dọc dải Ngân Hà.
 */

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vDir;

  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uOpacity;

  varying vec3 vDir;

  // ------------------------------------------------------------------
  // Simplex noise 3D (Ashima Arts / Stefan Gustavson)
  // ------------------------------------------------------------------
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(
      permute(
        permute(
          i.z + vec4(0.0, i1.z, i2.z, 1.0)
        ) + i.y + vec4(0.0, i1.y, i2.y, 1.0)
      ) + i.x + vec4(0.0, i1.x, i2.x, 1.0)
    );

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  float fbm(vec3 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      if (i >= octaves) break;
      value += amplitude * snoise(p);
      p = p * 2.03 + vec3(11.3, 7.7, 5.1);
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec3 d = normalize(vDir);

    // Dải ngân hà nghiêng trên vòm trời
    vec3 galaxyAxis = normalize(vec3(0.32, 0.76, -0.56));
    float axisDot = dot(d, galaxyAxis);

    float warp = fbm(d * 1.7 + vec3(3.1, 0.0, 1.7) + uTime * 0.0035, 4);
    float bandCoord = (axisDot + warp * 0.14) / 0.115;
    float band = exp(-bandCoord * bandCoord);

    float clouds = fbm(d * 3.4 + warp * 0.65 + vec3(-2.0, 5.0, 1.0), 4);
    float fine = fbm(d * 7.2 + vec3(9.1, -3.0, 4.4), 3);
    float density = smoothstep(-0.52, 0.55, clouds);

    vec3 deep = vec3(0.004, 0.006, 0.015);
    vec3 cosmicBlue = vec3(0.06, 0.16, 0.4);
    vec3 violetNebula = vec3(0.19, 0.06, 0.34);
    vec3 goldenDust = vec3(0.68, 0.44, 0.16);

    vec3 nebula = mix(cosmicBlue, violetNebula, smoothstep(-0.25, 0.85, fine));
    nebula = mix(nebula, goldenDust, smoothstep(0.30, 0.95, clouds) * 0.6);

    vec3 col = deep;
    col += nebula * band * density * 1.25;

    // Lõi ngân hà ấm, sáng hơn về một phía
    vec3 coreDir = normalize(vec3(-0.62, 0.14, 0.77));
    float coreAlign = max(dot(d, coreDir), 0.0);
    float core = pow(coreAlign, 10.0);
    col += vec3(0.34, 0.25, 0.12) * band * core * (1.4 + 0.35 * sin(uTime * 0.07));
    col += vec3(0.10, 0.08, 0.16) * pow(coreAlign, 3.0) * band;

    // Các dải bụi tối cắt ngang tinh vân
    float dust = smoothstep(0.18, 0.88, fine);
    col *= 1.0 - 0.5 * dust * band;

    // Nhịp thở rất chậm của tinh vân
    col *= 0.94 + 0.06 * sin(uTime * 0.05);

    gl_FragColor = vec4(max(col, 0.0) * uOpacity, 1.0);
  }
`;

const SKY_STAR_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  attribute float aBrightness;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uOpacity;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vSeed;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float twinkle = 0.55 + 0.45 * sin(uTime * (0.45 + aPhase * 1.6) + aPhase * 6.2831);
    gl_PointSize = clamp(aSize * uPixelRatio, 1.0, 5.0);

    vColor = aColor;
    vAlpha = aBrightness * twinkle * uOpacity;
    vSeed = aPhase;
  }
`;

const SKY_STAR_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSeed;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    float core = smoothstep(0.55, 0.0, d);

    float spike = 0.0;
    if (vSeed > 0.962) {
      spike = max(0.0, 1.0 - abs(p.x) * 16.0) + max(0.0, 1.0 - abs(p.y) * 16.0);
      spike *= core * 0.5;
    }

    float alpha = (core + spike) * vAlpha;
    gl_FragColor = vec4(vColor * 1.25, alpha);
  }
`;

export class MilkyWaySkyDome {
  public readonly group = new THREE.Group();
  public readonly mesh: THREE.Mesh;

  private readonly material: THREE.ShaderMaterial;
  private readonly uniforms = {
    uTime: { value: 0 },
    uOpacity: { value: 0 },
  };
  private readonly starPoints: THREE.Points;
  private readonly starMaterial: THREE.ShaderMaterial;
  private readonly starUniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
    uOpacity: { value: 0 },
  };
  private opacity = 0;

  constructor(radius = 900) {
    this.group.name = 'MilkyWaySky';

    const geometry = new THREE.SphereGeometry(radius, 96, 64);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
      transparent: false,
      fog: false,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'MilkyWaySkyDome';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.group.add(this.mesh);

    const starField = this.createStarField(radius * 0.955, 8500);
    this.starPoints = starField.points;
    this.starMaterial = starField.material;
    this.group.add(this.starPoints);
  }

  /**
   * Hàng ngàn ngôi sao nền dạng point sprite tròn, sắc nét,
   * phân bố đều trên vòm trời và dày hơn dọc dải Ngân Hà.
   */
  private createStarField(
    radius: number,
    count: number
  ): { points: THREE.Points; material: THREE.ShaderMaterial } {
    const rand = createSeededRandom(0x57a251);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const brightness = new Float32Array(count);

    const galaxyAxis = new THREE.Vector3(0.32, 0.76, -0.56).normalize();
    const direction = new THREE.Vector3();
    const palette = [
      new THREE.Color(0.72, 0.84, 1.0),
      new THREE.Color(1.0, 0.88, 0.7),
      new THREE.Color(0.86, 0.8, 1.0),
      new THREE.Color(1.0, 1.0, 1.0),
    ];

    for (let i = 0; i < count; i += 1) {
      const y = rand() * 2 - 1;
      const theta = rand() * Math.PI * 2;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      direction.set(Math.cos(theta) * ring, y, Math.sin(theta) * ring);

      // 38% số sao dồn về dải Ngân Hà
      if (rand() < 0.38) {
        const axisDot = direction.dot(galaxyAxis);
        direction.addScaledVector(galaxyAxis, -axisDot * 0.82).normalize();
      }

      positions[i * 3] = direction.x * radius;
      positions[i * 3 + 1] = direction.y * radius;
      positions[i * 3 + 2] = direction.z * radius;

      const rare = rand() < 0.035;
      sizes[i] = rare ? 2.2 + rand() * 1.3 : 0.8 + Math.pow(rand(), 1.8) * 1.2;
      phases[i] = rand();
      brightness[i] = rare ? 1.15 + rand() * 0.45 : 0.32 + rand() * 0.62;

      const tint = palette[Math.floor(rand() * palette.length)];
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

    const material = new THREE.ShaderMaterial({
      name: 'SkyStarField',
      uniforms: this.starUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: SKY_STAR_VERTEX,
      fragmentShader: SKY_STAR_FRAGMENT,
    });

    const points = new THREE.Points(geometry, material);
    points.name = 'SkyStarField';
    points.frustumCulled = false;
    points.renderOrder = -999;

    return { points, material };
  }

  public setPixelRatio(pixelRatio: number): void {
    this.starUniforms.uPixelRatio.value = Math.max(1, pixelRatio);
  }

  public update(elapsed: number, dt: number): void {
    this.opacity = Math.min(1, this.opacity + dt * 0.55);
    this.uniforms.uTime.value = elapsed;
    this.uniforms.uOpacity.value = this.opacity;
    this.starUniforms.uTime.value = elapsed;
    this.starUniforms.uOpacity.value = this.opacity;
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.starPoints.geometry.dispose();
    this.starMaterial.dispose();
  }
}
