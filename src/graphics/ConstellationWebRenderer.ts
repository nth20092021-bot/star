import * as THREE from 'three';
import type { StarNode, CometPhysicsState, ConstellationEdge } from '../shared/CosmicTypes';
import { CELESTIAL_CONSTANTS } from '../shared/CosmicTypes';
import { clamp, damp, hash01, disposeObjectTree } from './GraphicsUtils';
import { createHologramNameTexture } from './VisualTextures';

const MAX_STARS = CELESTIAL_CONSTANTS.TOTAL_STARS;
const MAX_EDGES = 128;
const TAIL_MAX = CELESTIAL_CONSTANTS.MAX_TAIL_LENGTH;
const MAX_RENDERED_TAIL = 6.5;
const PULSE_POOL_SIZE = 12;
const HOLOGRAM_POOL_SIZE = 6;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function smoothStep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(1e-5, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

interface StarPulseEffect {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  startedAt: number;
  duration: number;
  active: boolean;
}

interface NameHologram {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  startedAt: number;
  duration: number;
  active: boolean;
  basePosition: THREE.Vector3;
}

interface StarSystem {
  points: THREE.Points;
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  positionAttr: THREE.BufferAttribute;
  sizeAttr: THREE.BufferAttribute;
  phaseAttr: THREE.BufferAttribute;
  glowAttr: THREE.BufferAttribute;
  visitedAttr: THREE.BufferAttribute;
  winnerAttr: THREE.BufferAttribute;
  glowValues: Float32Array;
  visitedValues: Float32Array;
  winnerValues: Float32Array;
  capacity: number;
}

interface EdgeSystem {
  lines: THREE.LineSegments;
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  positionAttr: THREE.BufferAttribute;
  intensityAttr: THREE.BufferAttribute;
  seedAttr: THREE.BufferAttribute;
  flowDirAttr: THREE.BufferAttribute;
}

/**
 * Mạng lưới chòm sao:
 * - 28 ngôi sao với lõi sáng + hào quang chữ thập 4 cánh (point sprite shader).
 * - THREE.LineSegments động vẽ các tia năng lượng giữa 28 ngôi sao.
 * - Sao chổi đầu sáng + dải đuôi ribbon hướng camera + bụi sao lấp lánh.
 */
export class ConstellationWebRenderer {
  public readonly group = new THREE.Group();

  private starSystem: StarSystem;
  private edgeSystem: EdgeSystem;

  private readonly edgeStartedAt = new Map<string, number>();
  private lastStarCount = 0;

  private readonly pulseEffects: StarPulseEffect[] = [];
  private pulseCursor = 0;
  private readonly holograms: NameHologram[] = [];
  private hologramCursor = 0;
  private readonly hologramTextures = new Map<string, THREE.CanvasTexture>();
  private surgeActive = false;
  private surgeAge = 0;
  private readonly surgeWinnerPosition = new THREE.Vector3();

  private readonly cometGroup = new THREE.Group();
  private readonly cometHeadMaterial: THREE.ShaderMaterial;
  private readonly headPositionAttr: THREE.BufferAttribute;
  private readonly tailMesh: THREE.Mesh;
  private readonly tailGeometry: THREE.BufferGeometry;
  private readonly tailMaterial: THREE.ShaderMaterial;
  private readonly tailPositionAttr: THREE.BufferAttribute;
  private readonly sparkles: THREE.Points;
  private readonly sparkleMaterial: THREE.ShaderMaterial;
  private readonly sparklePositionAttr: THREE.BufferAttribute;
  private readonly cometLight: THREE.PointLight;

  private readonly tailSource: THREE.Vector3[] = [];
  private readonly tailSamples: THREE.Vector3[] = [];
  private readonly tailCurve = new THREE.CatmullRomCurve3([], false, 'centripetal');
  private readonly fallbackTailPoint = new THREE.Vector3();
  private readonly tailCapPoint = new THREE.Vector3();

  // Scratch vectors tái sử dụng mỗi frame (không cấp phát trong vòng lặp nóng)
  private readonly tmpTangent = new THREE.Vector3();
  private readonly tmpView = new THREE.Vector3();
  private readonly tmpSide = new THREE.Vector3();

  private cometVisibility = 0;
  private forceHideComet = true;
  private lastCometActiveAt = Number.NEGATIVE_INFINITY;
  private pixelRatio = 1;

  constructor(initialStars: StarNode[] = []) {
    this.group.name = 'ConstellationWeb';

    this.starSystem = this.createStarSystem(Math.max(MAX_STARS, initialStars.length));
    this.edgeSystem = this.createEdgeSystem();

    /* ------------------------- Sao chổi ------------------------- */
    const headGeometry = new THREE.BufferGeometry();
    const headPosition = new THREE.BufferAttribute(new Float32Array(3), 3);
    headPosition.setUsage(THREE.DynamicDrawUsage);
    headGeometry.setAttribute('position', headPosition);
    headGeometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array([9.0]), 1));
    headGeometry.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array([0.37]), 1));

    this.cometHeadMaterial = new THREE.ShaderMaterial({
      name: 'CometHeadFlare',
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: this.pixelRatio },
        uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: COMET_HEAD_VERTEX,
      fragmentShader: COMET_HEAD_FRAGMENT,
    });

    const cometHead = new THREE.Points(headGeometry, this.cometHeadMaterial);
    cometHead.frustumCulled = false;
    cometHead.renderOrder = 12;
    this.headPositionAttr = headPosition;
    this.cometGroup.add(cometHead);

    /* ---------------------- Đuôi ribbon ------------------------- */
    this.tailGeometry = new THREE.BufferGeometry();
    const tailPositions = new Float32Array(TAIL_MAX * 2 * 3);
    const tailT = new Float32Array(TAIL_MAX * 2);
    const tailSide = new Float32Array(TAIL_MAX * 2);
    for (let i = 0; i < TAIL_MAX; i += 1) {
      const t = i / (TAIL_MAX - 1);
      tailT[i * 2] = t;
      tailT[i * 2 + 1] = t;
      tailSide[i * 2] = 1;
      tailSide[i * 2 + 1] = -1;
      this.tailSamples.push(new THREE.Vector3());
    }

    this.tailPositionAttr = new THREE.BufferAttribute(tailPositions, 3);
    this.tailPositionAttr.setUsage(THREE.DynamicDrawUsage);
    this.tailGeometry.setAttribute('position', this.tailPositionAttr);
    this.tailGeometry.setAttribute('aT', new THREE.BufferAttribute(tailT, 1));
    this.tailGeometry.setAttribute('aSide', new THREE.BufferAttribute(tailSide, 1));

    const tailIndices = new Uint16Array((TAIL_MAX - 1) * 6);
    for (let i = 0; i < TAIL_MAX - 1; i += 1) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = i * 2 + 2;
      const d = i * 2 + 3;
      tailIndices[i * 6 + 0] = a;
      tailIndices[i * 6 + 1] = b;
      tailIndices[i * 6 + 2] = c;
      tailIndices[i * 6 + 3] = b;
      tailIndices[i * 6 + 4] = d;
      tailIndices[i * 6 + 5] = c;
    }
    this.tailGeometry.setIndex(new THREE.BufferAttribute(tailIndices, 1));
    this.tailGeometry.setDrawRange(0, 0);

    this.tailMaterial = new THREE.ShaderMaterial({
      name: 'CometTailRibbon',
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: TAIL_VERTEX,
      fragmentShader: TAIL_FRAGMENT,
    });

    this.tailMesh = new THREE.Mesh(this.tailGeometry, this.tailMaterial);
    this.tailMesh.frustumCulled = false;
    this.tailMesh.renderOrder = 10;
    this.cometGroup.add(this.tailMesh);

    /* --------------------- Bụi đuôi sao chổi -------------------- */
    const sparkleGeometry = new THREE.BufferGeometry();
    const sparklePositions = new Float32Array(TAIL_MAX * 3);
    const sparkleT = new Float32Array(TAIL_MAX);
    const sparkleSeed = new Float32Array(TAIL_MAX);
    for (let i = 0; i < TAIL_MAX; i += 1) {
      sparkleT[i] = i / (TAIL_MAX - 1);
      sparkleSeed[i] = hash01(i * 7.13 + 2.4);
    }

    this.sparklePositionAttr = new THREE.BufferAttribute(sparklePositions, 3);
    this.sparklePositionAttr.setUsage(THREE.DynamicDrawUsage);
    sparkleGeometry.setAttribute('position', this.sparklePositionAttr);
    sparkleGeometry.setAttribute('aT', new THREE.BufferAttribute(sparkleT, 1));
    sparkleGeometry.setAttribute('aSeed', new THREE.BufferAttribute(sparkleSeed, 1));
    sparkleGeometry.setDrawRange(0, 0);

    this.sparkleMaterial = new THREE.ShaderMaterial({
      name: 'CometTailSparkles',
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: this.pixelRatio },
        uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: COMET_SPARKLE_VERTEX,
      fragmentShader: COMET_SPARKLE_FRAGMENT,
    });

    this.sparkles = new THREE.Points(sparkleGeometry, this.sparkleMaterial);
    this.sparkles.frustumCulled = false;
    this.sparkles.renderOrder = 11;
    this.cometGroup.add(this.sparkles);

    this.cometLight = new THREE.PointLight(0x9fdcff, 0, 90, 2);
    this.cometLight.name = 'CometLight';
    this.cometGroup.add(this.cometLight);

    this.cometGroup.visible = false;
    this.group.add(this.cometGroup);

    this.createStarPulsePool();
    this.createNameHologramPool();
  }

  /* ------------------------------------------------------------------ */
  /* Pool hiệu ứng va chạm sao                                           */
  /* ------------------------------------------------------------------ */

  private createStarPulsePool(): void {
    for (let i = 0; i < PULSE_POOL_SIZE; i += 1) {
      const material = new THREE.ShaderMaterial({
        name: 'StarHitPulse',
        uniforms: {
          uProgress: { value: 0 },
          uAlpha: { value: 0 },
          uColor: { value: new THREE.Color(1.2, 0.9, 0.48) },
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        vertexShader: STAR_PULSE_VERTEX,
        fragmentShader: STAR_PULSE_FRAGMENT,
      });

      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      mesh.name = `StarHitPulse_${i}`;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 9;
      this.group.add(mesh);

      this.pulseEffects.push({
        mesh,
        material,
        startedAt: 0,
        duration: 0.9,
        active: false,
      });
    }
  }

  private createNameHologramPool(): void {
    for (let i = 0; i < HOLOGRAM_POOL_SIZE; i += 1) {
      const material = new THREE.SpriteMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      });

      const sprite = new THREE.Sprite(material);
      sprite.name = `StudentNameHologram_${i}`;
      sprite.visible = false;
      sprite.frustumCulled = false;
      sprite.renderOrder = 14;
      this.group.add(sprite);

      this.holograms.push({
        sprite,
        material,
        startedAt: 0,
        duration: 1.15,
        active: false,
        basePosition: new THREE.Vector3(),
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Dựng hệ 28 ngôi sao                                                 */
  /* ------------------------------------------------------------------ */

  private createStarSystem(capacity: number): StarSystem {
    const safeCapacity = Math.max(1, capacity);
    const geometry = new THREE.BufferGeometry();
    const positionAttr = new THREE.BufferAttribute(new Float32Array(safeCapacity * 3), 3);
    positionAttr.setUsage(THREE.DynamicDrawUsage);

    const sizeAttr = new THREE.BufferAttribute(new Float32Array(safeCapacity), 1);
    sizeAttr.setUsage(THREE.DynamicDrawUsage);
    const phaseAttr = new THREE.BufferAttribute(new Float32Array(safeCapacity), 1);
    const glowAttr = new THREE.BufferAttribute(new Float32Array(safeCapacity), 1);
    glowAttr.setUsage(THREE.DynamicDrawUsage);
    const visitedAttr = new THREE.BufferAttribute(new Float32Array(safeCapacity), 1);
    visitedAttr.setUsage(THREE.DynamicDrawUsage);
    const winnerAttr = new THREE.BufferAttribute(new Float32Array(safeCapacity), 1);
    winnerAttr.setUsage(THREE.DynamicDrawUsage);

    geometry.setAttribute('position', positionAttr);
    geometry.setAttribute('aSize', sizeAttr);
    geometry.setAttribute('aPhase', phaseAttr);
    geometry.setAttribute('aGlow', glowAttr);
    geometry.setAttribute('aVisited', visitedAttr);
    geometry.setAttribute('aWinner', winnerAttr);
    geometry.setDrawRange(0, 0);

    const material = new THREE.ShaderMaterial({
      name: 'ConstellationStarFlare',
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: this.pixelRatio },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
    });

    const points = new THREE.Points(geometry, material);
    points.name = 'StudentStars';
    points.frustumCulled = false;
    points.renderOrder = 6;
    this.group.add(points);

    return {
      points,
      geometry,
      material,
      positionAttr,
      sizeAttr,
      phaseAttr,
      glowAttr,
      visitedAttr,
      winnerAttr,
      glowValues: glowAttr.array as Float32Array,
      visitedValues: visitedAttr.array as Float32Array,
      winnerValues: winnerAttr.array as Float32Array,
      capacity: safeCapacity,
    };
  }

  private rebuildStarSystemIfNeeded(starCount: number): void {
    if (starCount <= this.starSystem.capacity) return;

    this.group.remove(this.starSystem.points);
    this.starSystem.geometry.dispose();
    this.starSystem.material.dispose();
    this.starSystem = this.createStarSystem(Math.max(starCount, MAX_STARS));
  }

  private updateStars(dt: number, stars: StarNode[]): void {
    this.rebuildStarSystemIfNeeded(stars.length);

    const system = this.starSystem;
    const count = Math.min(stars.length, system.capacity);
    const positions = system.positionAttr.array as Float32Array;
    const sizes = system.sizeAttr.array as Float32Array;
    const phases = system.phaseAttr.array as Float32Array;

    for (let i = 0; i < count; i += 1) {
      const star = stars[i];
      const position = star.currentPosition;
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;

      sizes[i] = 4.3 + hash01(star.id * 3.71 + 1.3) * 2.9;
      phases[i] = hash01(star.id * 9.13 + 4.7);

      const glowTarget = clamp((star.brightness - 1) * 0.95, 0, 1);
      const visitedTarget = star.isVisited ? 1 : 0;
      const winnerTarget = star.isWinner ? 1 : 0;

      system.glowValues[i] = damp(system.glowValues[i], glowTarget, 4.5, dt);
      system.visitedValues[i] = damp(system.visitedValues[i], visitedTarget, 5.5, dt);
      system.winnerValues[i] = damp(system.winnerValues[i], winnerTarget, 3.2, dt);
    }

    system.positionAttr.needsUpdate = true;
    system.sizeAttr.needsUpdate = true;
    system.phaseAttr.needsUpdate = true;
    system.glowAttr.needsUpdate = true;
    system.visitedAttr.needsUpdate = true;
    system.winnerAttr.needsUpdate = true;
    system.geometry.setDrawRange(0, count);
    this.lastStarCount = count;
  }

  /* ------------------------------------------------------------------ */
  /* Mạng lưới LineSegments                                              */
  /* ------------------------------------------------------------------ */

  private createEdgeSystem(): EdgeSystem {
    const geometry = new THREE.BufferGeometry();
    const positionAttr = new THREE.BufferAttribute(new Float32Array(MAX_EDGES * 2 * 3), 3);
    positionAttr.setUsage(THREE.DynamicDrawUsage);

    const tValues = new Float32Array(MAX_EDGES * 2);
    for (let i = 0; i < MAX_EDGES; i += 1) {
      tValues[i * 2] = 0;
      tValues[i * 2 + 1] = 1;
    }

    const intensityAttr = new THREE.BufferAttribute(new Float32Array(MAX_EDGES * 2), 1);
    intensityAttr.setUsage(THREE.DynamicDrawUsage);
    const seedAttr = new THREE.BufferAttribute(new Float32Array(MAX_EDGES * 2), 1);
    seedAttr.setUsage(THREE.DynamicDrawUsage);
    const flowDirAttr = new THREE.BufferAttribute(new Float32Array(MAX_EDGES * 2), 1);
    flowDirAttr.setUsage(THREE.DynamicDrawUsage);

    geometry.setAttribute('position', positionAttr);
    geometry.setAttribute('aT', new THREE.BufferAttribute(tValues, 1));
    geometry.setAttribute('aIntensity', intensityAttr);
    geometry.setAttribute('aSeed', seedAttr);
    geometry.setAttribute('aFlowDir', flowDirAttr);
    geometry.setDrawRange(0, 0);

    const material = new THREE.ShaderMaterial({
      name: 'ConstellationEdgeEnergy',
      uniforms: {
        uTime: { value: 0 },
        uSurge: { value: 0 },
        uSurgeProgress: { value: 0 },
        uSurgeFlash: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: EDGE_VERTEX,
      fragmentShader: EDGE_FRAGMENT,
    });

    const lines = new THREE.LineSegments(geometry, material);
    lines.name = 'ConstellationLineSegments';
    lines.frustumCulled = false;
    lines.renderOrder = 5;
    this.group.add(lines);

    return {
      lines,
      geometry,
      material,
      positionAttr,
      intensityAttr,
      seedAttr,
      flowDirAttr,
    };
  }

  private updateEdges(elapsed: number, edges: ConstellationEdge[]): void {
    const system = this.edgeSystem;
    const count = Math.min(edges.length, MAX_EDGES);
    const positions = system.positionAttr.array as Float32Array;
    const intensities = system.intensityAttr.array as Float32Array;
    const seeds = system.seedAttr.array as Float32Array;
    const flowDirs = system.flowDirAttr.array as Float32Array;

    for (let i = 0; i < count; i += 1) {
      const edge = edges[i];
      const base = i * 6;

      positions[base] = edge.startPos.x;
      positions[base + 1] = edge.startPos.y;
      positions[base + 2] = edge.startPos.z;
      positions[base + 3] = edge.endPos.x;
      positions[base + 4] = edge.endPos.y;
      positions[base + 5] = edge.endPos.z;

      const key = `${edge.fromStarId}-${edge.toStarId}`;
      let startedAt = this.edgeStartedAt.get(key);
      if (startedAt === undefined) {
        startedAt = elapsed;
        this.edgeStartedAt.set(key, startedAt);
      }

      const fadeIn = clamp((elapsed - startedAt) / 0.5, 0, 1);
      const intensity = clamp(edge.intensity, 0, 1.4) * fadeIn;
      intensities[i * 2] = intensity;
      intensities[i * 2 + 1] = intensity;

      const seed = hash01(edge.fromStarId * 31.7 + edge.toStarId * 17.3);
      seeds[i * 2] = seed;
      seeds[i * 2 + 1] = seed;

      // +1: năng lượng chạy từ start → end; -1: ngược lại.
      // Hướng luôn quy về phía ngôi sao chiến thắng khi surge Act 4.
      let flow = 1;
      if (this.surgeActive) {
        flow =
          edge.startPos.distanceToSquared(this.surgeWinnerPosition) >
          edge.endPos.distanceToSquared(this.surgeWinnerPosition)
            ? 1
            : -1;
      }
      flowDirs[i * 2] = flow;
      flowDirs[i * 2 + 1] = flow;
    }

    system.lines.visible = count > 0;
    system.geometry.setDrawRange(0, count * 2);
    if (count > 0) {
      system.positionAttr.needsUpdate = true;
      system.intensityAttr.needsUpdate = true;
      system.seedAttr.needsUpdate = true;
      system.flowDirAttr.needsUpdate = true;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Sao chổi: đầu sáng, đuôi ribbon & bụi sao                           */
  /* ------------------------------------------------------------------ */

  private updateComet(
    dt: number,
    elapsed: number,
    comet: CometPhysicsState,
    camera: THREE.Camera
  ): void {
    const speed = clamp(comet.speedNormalized, 0, 1);

    if (speed > 0.02) {
      this.forceHideComet = false;
      this.lastCometActiveAt = elapsed;
    }

    const targetVisible =
      !this.forceHideComet && (speed > 0.002 || elapsed - this.lastCometActiveAt < 1.0)
        ? 1
        : 0;

    this.cometVisibility = damp(
      this.cometVisibility,
      targetVisible,
      targetVisible > this.cometVisibility ? 9 : 2.6,
      dt
    );

    const visible = this.cometVisibility > 0.006;
    this.cometGroup.visible = visible;
    if (!visible) {
      this.cometLight.intensity = 0;
      return;
    }

    // Đầu sao chổi
    const headPosition = comet.position;
    this.headPositionAttr.setXYZ(0, headPosition.x, headPosition.y, headPosition.z);
    this.headPositionAttr.needsUpdate = true;
    this.cometHeadMaterial.uniforms.uOpacity.value = this.cometVisibility;
    this.cometLight.position.copy(headPosition);
    this.cometLight.intensity = 380 * this.cometVisibility * (0.55 + speed * 0.8);

    // Dựng danh sách điểm đuôi: luôn bắt đầu từ đầu sao chổi,
    // rồi nối ra xa theo đầu gần nhất của tailHistory.
    this.tailSource.length = 0;
    this.tailSource.push(headPosition);

    const history = comet.tailHistory;
    if (history.length >= 2) {
      const first = history[0];
      const last = history[history.length - 1];
      const firstIsCloser = first.distanceToSquared(headPosition) <= last.distanceToSquared(headPosition);

      let tailDistance = 0;
      for (let i = 0; i < history.length; i += 1) {
        const source = history[firstIsCloser ? i : history.length - 1 - i];
        const previous = this.tailSource[this.tailSource.length - 1];
        const segmentLength = source.distanceTo(previous);
        if (segmentLength < 0.08) continue;

        // Giới hạn đuôi hiển thị ~7.5 đơn vị để camera bám đuôi (8–14)
        // không bao giờ bay xuyên qua dải ribbon.
        if (tailDistance + segmentLength >= MAX_RENDERED_TAIL) {
          const remaining = MAX_RENDERED_TAIL - tailDistance;
          if (remaining > 0.12) {
            this.tailCapPoint
              .copy(previous)
              .lerp(source, remaining / segmentLength);
            this.tailSource.push(this.tailCapPoint);
          }
          break;
        }

        this.tailSource.push(source);
        tailDistance += segmentLength;
      }
    }

    if (this.tailSource.length < 2) {
      if (comet.velocity.lengthSq() > 1e-6) {
        this.fallbackTailPoint
          .copy(headPosition)
          .addScaledVector(this.tmpTangent.copy(comet.velocity).normalize(), -7.5);
        this.tailSource.push(this.fallbackTailPoint);
      }
    }

    const hasTail = this.tailSource.length >= 2;
    this.tailMesh.visible = hasTail;
    this.sparkles.visible = hasTail;

    if (!hasTail) {
      this.tailGeometry.setDrawRange(0, 0);
      this.sparkles.geometry.setDrawRange(0, 0);
      return;
    }

    this.tailCurve.points = this.tailSource;
    for (let i = 0; i < TAIL_MAX; i += 1) {
      const t = i / (TAIL_MAX - 1);
      this.tailCurve.getPoint(t, this.tailSamples[i]);
    }

    const tailPositions = this.tailPositionAttr.array as Float32Array;
    const sparklePositions = this.sparklePositionAttr.array as Float32Array;

    for (let i = 0; i < TAIL_MAX; i += 1) {
      const center = this.tailSamples[i];
      const t = i / (TAIL_MAX - 1);

      const previous = this.tailSamples[Math.max(0, i - 1)];
      const next = this.tailSamples[Math.min(TAIL_MAX - 1, i + 1)];
      this.tmpTangent.subVectors(next, previous);
      if (this.tmpTangent.lengthSq() < 1e-8) {
        this.tmpTangent.copy(comet.velocity);
        if (this.tmpTangent.lengthSq() < 1e-8) this.tmpTangent.set(0, 1, 0);
      }
      this.tmpTangent.normalize();

      this.tmpView.subVectors(camera.position, center);
      this.tmpSide.crossVectors(this.tmpTangent, this.tmpView);
      if (this.tmpSide.lengthSq() < 1e-8) {
        this.tmpSide.set(1, 0, 0);
      } else {
        this.tmpSide.normalize();
      }

      const taper = Math.pow(1 - t, 1.5);
      const width = (0.44 * taper + 0.03) * (0.7 + speed * 0.5);
      const base = i * 6;

      tailPositions[base] = center.x + this.tmpSide.x * width;
      tailPositions[base + 1] = center.y + this.tmpSide.y * width;
      tailPositions[base + 2] = center.z + this.tmpSide.z * width;
      tailPositions[base + 3] = center.x - this.tmpSide.x * width;
      tailPositions[base + 4] = center.y - this.tmpSide.y * width;
      tailPositions[base + 5] = center.z - this.tmpSide.z * width;

      sparklePositions[i * 3] = center.x;
      sparklePositions[i * 3 + 1] = center.y;
      sparklePositions[i * 3 + 2] = center.z;
    }

    this.tailPositionAttr.needsUpdate = true;
    this.tailGeometry.setDrawRange(0, (TAIL_MAX - 1) * 6);

    this.sparklePositionAttr.needsUpdate = true;
    this.sparkles.geometry.setDrawRange(0, TAIL_MAX);

    this.tailMaterial.uniforms.uOpacity.value = this.cometVisibility;
    this.sparkleMaterial.uniforms.uOpacity.value = this.cometVisibility;
  }

  /* ------------------------------------------------------------------ */
  /* Hiệu ứng va chạm sao & luồng năng lượng                             */
  /* ------------------------------------------------------------------ */

  private updateStarPulses(camera: THREE.Camera): void {
    const now = performance.now();

    for (const pulse of this.pulseEffects) {
      if (!pulse.active) continue;

      const age = Math.max(0, (now - pulse.startedAt) / 1000);
      const progress = clamp(age / pulse.duration, 0, 1);

      pulse.mesh.quaternion.copy(camera.quaternion);
      pulse.mesh.scale.setScalar(2.2 + age * 9.0);
      pulse.material.uniforms.uProgress.value = progress;
      pulse.material.uniforms.uAlpha.value = Math.sin(progress * Math.PI) * 0.95;

      if (age >= pulse.duration) {
        pulse.active = false;
        pulse.mesh.visible = false;
      }
    }
  }

  private updateNameHolograms(camera: THREE.Camera): void {
    const now = performance.now();

    for (const holo of this.holograms) {
      if (!holo.active) continue;

      const age = Math.max(0, (now - holo.startedAt) / 1000);
      const fadeIn = smoothStep(0, 0.14, age);
      const fadeOut = 1 - smoothStep(holo.duration * 0.58, holo.duration, age);
      holo.material.opacity = fadeIn * fadeOut;

      holo.sprite.position
        .copy(holo.basePosition)
        .addScaledVector(WORLD_UP, 1.55 + age * 0.55);

      const distance = camera.position.distanceTo(holo.sprite.position);
      const width = clamp(distance * 0.27, 2.8, 8.0);
      holo.sprite.scale.set(width, width * 0.25, 1);

      if (age >= holo.duration) {
        holo.active = false;
        holo.sprite.visible = false;
        holo.material.opacity = 0;
      }
    }
  }

  private updateEnergySurge(dt: number): void {
    if (!this.surgeActive) return;

    this.surgeAge += dt;
    const uniforms = this.edgeSystem.material.uniforms;
    uniforms.uSurgeProgress.value = clamp(this.surgeAge / 0.78, 0, 1);
    uniforms.uSurgeFlash.value = Math.exp(-this.surgeAge * 2.2);
    uniforms.uSurge.value = 1 - smoothStep(2.2, 3.4, this.surgeAge);

    if (this.surgeAge > 3.4) {
      this.surgeActive = false;
      uniforms.uSurge.value = 0;
      uniforms.uSurgeFlash.value = 0;
    }
  }

  /* ------------------------------------------------------------------ */
  /* API công khai                                                       */
  /* ------------------------------------------------------------------ */

  public triggerStarPulse(position: THREE.Vector3, seed: number): void {
    if (this.pulseEffects.length === 0) return;

    const pulse = this.pulseEffects[this.pulseCursor % this.pulseEffects.length];
    this.pulseCursor += 1;

    const gold = Math.abs(Math.floor(seed)) % 2 === 0;
    pulse.active = true;
    pulse.startedAt = performance.now();
    pulse.mesh.visible = true;
    pulse.mesh.position.copy(position);
    pulse.material.uniforms.uProgress.value = 0;
    pulse.material.uniforms.uAlpha.value = 0;
    (pulse.material.uniforms.uColor.value as THREE.Color).setRGB(
      gold ? 1.3 : 0.42,
      gold ? 0.88 : 0.98,
      gold ? 0.46 : 1.25
    );
  }

  public showStudentHologram(
    studentName: string,
    position: THREE.Vector3,
    seed: number
  ): void {
    if (this.holograms.length === 0) return;

    const cleanName = (studentName || '').normalize('NFC');
    let texture = this.hologramTextures.get(cleanName);
    if (!texture) {
      texture = createHologramNameTexture(cleanName);
      this.hologramTextures.set(cleanName, texture);
    }

    const slot = this.holograms[this.hologramCursor % this.holograms.length];
    this.hologramCursor += 1;

    slot.active = true;
    slot.startedAt = performance.now();
    slot.duration = 1.15;
    slot.basePosition.copy(position);
    slot.sprite.position.copy(position);
    slot.sprite.visible = true;
    slot.material.map = texture;
    slot.material.opacity = 0;
    slot.material.color.setRGB(
      Math.abs(Math.floor(seed)) % 3 === 0 ? 1.02 : 0.78,
      0.94,
      1.02
    );
    slot.material.needsUpdate = true;
  }

  public triggerEnergySurge(winnerPosition: THREE.Vector3): void {
    this.surgeActive = true;
    this.surgeAge = 0;
    this.surgeWinnerPosition.copy(winnerPosition);

    const uniforms = this.edgeSystem.material.uniforms;
    uniforms.uSurge.value = 1;
    uniforms.uSurgeProgress.value = 0;
    uniforms.uSurgeFlash.value = 1;
  }

  public setPixelRatio(pixelRatio: number): void {
    const ratio = Math.max(1, pixelRatio);
    this.pixelRatio = ratio;
    this.starSystem.material.uniforms.uPixelRatio.value = ratio;
    this.cometHeadMaterial.uniforms.uPixelRatio.value = ratio;
    this.sparkleMaterial.uniforms.uPixelRatio.value = ratio;
  }

  public update(
    dt: number,
    elapsed: number,
    stars: StarNode[],
    comet: CometPhysicsState,
    edges: ConstellationEdge[],
    camera: THREE.Camera
  ): void {
    this.updateStars(dt, stars);
    this.updateEdges(elapsed, edges);
    this.updateComet(dt, elapsed, comet, camera);
    this.updateStarPulses(camera);
    this.updateNameHolograms(camera);
    this.updateEnergySurge(dt);

    this.starSystem.material.uniforms.uTime.value = elapsed;
    this.edgeSystem.material.uniforms.uTime.value = elapsed;
    this.cometHeadMaterial.uniforms.uTime.value = elapsed;
    this.tailMaterial.uniforms.uTime.value = elapsed;
    this.sparkleMaterial.uniforms.uTime.value = elapsed;
  }

  /** Cho sao chổi tan biến ngay khi vụ nổ Supernova bắt đầu. */
  public fadeOutComet(): void {
    this.forceHideComet = true;
    this.lastCometActiveAt = Number.NEGATIVE_INFINITY;
    this.cometVisibility = 0;
    this.cometGroup.visible = false;
    this.cometLight.intensity = 0;
    this.tailGeometry.setDrawRange(0, 0);
    this.sparkles.geometry.setDrawRange(0, 0);
  }

  public reset(): void {
    const system = this.starSystem;
    system.glowValues.fill(0);
    system.visitedValues.fill(0);
    system.winnerValues.fill(0);
    system.glowAttr.needsUpdate = true;
    system.visitedAttr.needsUpdate = true;
    system.winnerAttr.needsUpdate = true;
    system.geometry.setDrawRange(0, this.lastStarCount);

    const edge = this.edgeSystem;
    edge.geometry.setDrawRange(0, 0);
    edge.lines.visible = false;
    (edge.intensityAttr.array as Float32Array).fill(0);
    edge.intensityAttr.needsUpdate = true;
    this.edgeStartedAt.clear();

    this.cometVisibility = 0;
    this.forceHideComet = true;
    this.lastCometActiveAt = Number.NEGATIVE_INFINITY;
    this.cometGroup.visible = false;
    this.cometLight.intensity = 0;
    this.tailGeometry.setDrawRange(0, 0);
    this.sparkles.geometry.setDrawRange(0, 0);
    this.headPositionAttr.needsUpdate = true;

    for (const pulse of this.pulseEffects) {
      pulse.active = false;
      pulse.startedAt = 0;
      pulse.mesh.visible = false;
      pulse.material.uniforms.uAlpha.value = 0;
    }
    this.pulseCursor = 0;

    for (const holo of this.holograms) {
      holo.active = false;
      holo.startedAt = 0;
      holo.material.opacity = 0;
      holo.sprite.visible = false;
    }
    this.hologramCursor = 0;

    this.surgeActive = false;
    this.surgeAge = 0;
    const surgeUniforms = this.edgeSystem.material.uniforms;
    surgeUniforms.uSurge.value = 0;
    surgeUniforms.uSurgeProgress.value = 0;
    surgeUniforms.uSurgeFlash.value = 0;
  }

  public dispose(): void {
    for (const texture of this.hologramTextures.values()) {
      texture.dispose();
    }
    this.hologramTextures.clear();
    disposeObjectTree(this.group);
  }
}

/* ====================================================================== */
/* Shader: 28 ngôi sao — lõi sáng, hào quang 4 cánh, nhấp nháy theo pha    */
/* ====================================================================== */

const STAR_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute float aGlow;
  attribute float aVisited;
  attribute float aWinner;

  uniform float uTime;
  uniform float uPixelRatio;

  varying float vTwinkle;
  varying float vVisited;
  varying float vWinner;
  varying float vSeed;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float twinkle = 0.72 + 0.28 * sin(uTime * (1.15 + aPhase * 1.8) + aPhase * 6.2831);
    float sizeBoost = 1.0 + aGlow * 0.35 + aVisited * 0.4 + aWinner * 0.85;

    gl_PointSize = clamp(
      aSize * sizeBoost * uPixelRatio * (230.0 / max(-mvPosition.z, 1.0)),
      1.0,
      340.0
    );

    vTwinkle = twinkle * (1.0 + aGlow * 0.4 + aVisited * 0.65 + aWinner * 1.25);
    vVisited = aVisited;
    vWinner = aWinner;
    vSeed = aPhase;
  }
`;

const STAR_FRAGMENT = /* glsl */ `
  varying float vTwinkle;
  varying float vVisited;
  varying float vWinner;
  varying float vSeed;

  void main() {
    vec2 p = gl_PointCoord - 0.5;

    float rotation = vSeed * 6.2831;
    float cosR = cos(rotation);
    float sinR = sin(rotation);
    p = mat2(cosR, -sinR, sinR, cosR) * p;

    float radius = length(p);
    float core = exp(-radius * radius * 240.0);
    float halo = exp(-radius * 16.0) * 0.34;

    vec2 q = abs(p);
    float axisH = exp(-q.y * 85.0) * exp(-q.x * 5.0);
    float axisV = exp(-q.x * 85.0) * exp(-q.y * 5.0);
    float diagH = exp(-abs(p.x - p.y) * 65.0) * exp(-(q.x + q.y) * 5.5);
    float diagV = exp(-abs(p.x + p.y) * 65.0) * exp(-(q.x + q.y) * 5.5);

    float flare = core * 1.55 + halo + (axisH + axisV) * 0.85 + (diagH + diagV) * 0.26;
    float mask = smoothstep(0.5, 0.24, radius);
    float shape = flare * mask * vTwinkle;

    vec3 cold = vec3(0.68, 0.84, 1.0);
    vec3 warm = vec3(1.0, 0.76, 0.36);
    vec3 celestial = vec3(0.42, 1.0, 0.94);

    vec3 color = mix(cold, warm, vVisited);
    color = mix(color, celestial, vVisited * vWinner * 0.55);
    color = mix(color, vec3(1.0, 0.92, 0.68), vWinner * 0.5);

    float energy = 1.1 + vVisited * 0.75 + vWinner * 1.4;
    gl_FragColor = vec4(color * energy, min(shape, 1.0));
  }
`;

/* ====================================================================== */
/* Shader: tia năng lượng LineSegments                                    */
/* ====================================================================== */

const EDGE_VERTEX = /* glsl */ `
  attribute float aT;
  attribute float aIntensity;
  attribute float aSeed;
  attribute float aFlowDir;

  varying float vT;
  varying float vIntensity;
  varying float vSeed;
  varying float vFlowDir;

  void main() {
    vT = aT;
    vIntensity = aIntensity;
    vSeed = aSeed;
    vFlowDir = aFlowDir;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const EDGE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uSurge;
  uniform float uSurgeProgress;
  uniform float uSurgeFlash;

  varying float vT;
  varying float vIntensity;
  varying float vSeed;
  varying float vFlowDir;

  void main() {
    float pulse = 0.55 + 0.45 * sin(vT * 14.0 - uTime * 5.2 + vSeed * 6.2831);
    float travel = pow(0.5 + 0.5 * sin(vT * 6.2831 - uTime * 2.4 + vSeed * 6.2831), 6.0);

    vec3 cyan = vec3(0.32, 0.78, 1.0);
    vec3 gold = vec3(1.0, 0.78, 0.36);
    vec3 color = mix(cyan, gold, smoothstep(0.0, 1.0, vT));

    // Luồng năng lượng dồn về ngôi sao chiến thắng ở Act 4.
    float coord = vFlowDir >= 0.0 ? vT : 1.0 - vT;
    float crest = smoothstep(0.17, 0.0, abs(coord - uSurgeProgress));
    float trail = smoothstep(0.45, 0.0, abs(coord - uSurgeProgress)) * 0.28;
    float surge = (crest + trail) * uSurge;

    float brightness = vIntensity * (0.85 + 0.7 * pulse + 1.4 * travel)
      + surge * 2.5
      + uSurgeFlash * vIntensity * 1.5;

    color = mix(color, vec3(1.0, 0.88, 0.55), clamp(surge * 0.85 + uSurgeFlash * 0.35, 0.0, 1.0));

    gl_FragColor = vec4(color * (0.8 + brightness * 1.25), min(brightness * 0.85, 1.0));
  }
`;

/* ====================================================================== */
/* Shader: đầu sao chổi                                                   */
/* ====================================================================== */

const COMET_HEAD_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;

  uniform float uTime;
  uniform float uPixelRatio;

  varying float vTwinkle;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    gl_PointSize = clamp(
      aSize * uPixelRatio * (245.0 / max(-mvPosition.z, 1.0)),
      1.0,
      320.0
    );

    vTwinkle = 0.9 + 0.1 * sin(uTime * 5.0 + aPhase * 6.2831);
  }
`;

const COMET_HEAD_FRAGMENT = /* glsl */ `
  uniform float uOpacity;

  varying float vTwinkle;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float radius = length(p);

    float core = exp(-radius * radius * 150.0);
    float halo = exp(-radius * 8.5) * 0.6;

    vec2 q = abs(p);
    float axisH = exp(-q.y * 48.0) * exp(-q.x * 3.4);
    float axisV = exp(-q.x * 48.0) * exp(-q.y * 3.4);
    float diag = exp(-abs(p.x - p.y) * 40.0) * exp(-(q.x + q.y) * 5.0);
    float diag2 = exp(-abs(p.x + p.y) * 40.0) * exp(-(q.x + q.y) * 5.0);

    float shape = (core * 2.0 + halo + (axisH + axisV) * 0.9 + (diag + diag2) * 0.35)
      * smoothstep(0.5, 0.14, radius)
      * vTwinkle
      * uOpacity;

    vec3 color = mix(vec3(0.62, 0.9, 1.0), vec3(1.0, 0.95, 0.82), core);
    gl_FragColor = vec4(color * 1.45, min(shape, 1.0));
  }
`;

/* ====================================================================== */
/* Shader: đuôi ribbon                                                    */
/* ====================================================================== */

const TAIL_VERTEX = /* glsl */ `
  attribute float aT;
  attribute float aSide;

  varying float vT;
  varying float vSide;

  void main() {
    vT = aT;
    vSide = aSide;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TAIL_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;

  varying float vT;
  varying float vSide;

  void main() {
    vec3 head = vec3(0.92, 0.98, 1.0);
    vec3 middle = vec3(0.22, 0.75, 1.0);
    vec3 tail = vec3(0.55, 0.34, 1.0);

    vec3 color = mix(head, middle, smoothstep(0.0, 0.22, vT));
    color = mix(color, tail, smoothstep(0.24, 1.0, vT));

    float edge = smoothstep(1.0, 0.1, abs(vSide));
    float flow = 0.72 + 0.28 * sin(vT * 26.0 - uTime * 7.0 + vSide * 1.6);
    float alpha = pow(1.0 - vT, 1.25) * edge * flow * uOpacity * 1.1;

    gl_FragColor = vec4(color * (1.15 + 1.25 * pow(1.0 - vT, 2.0)), alpha * 0.8);
  }
`;

/* ====================================================================== */
/* Shader: bụi sao đuôi                                                    */
/* ====================================================================== */

const COMET_SPARKLE_VERTEX = /* glsl */ `
  attribute float aT;
  attribute float aSeed;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uOpacity;

  varying float vAlpha;
  varying float vSeed;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float size = (0.8 + 3.2 * pow(1.0 - aT, 2.2)) * uPixelRatio * (160.0 / max(-mvPosition.z, 1.0));
    gl_PointSize = clamp(size, 1.0, 22.0);

    float twinkle = 0.4 + 0.6 * abs(sin(uTime * 3.4 + aSeed * 24.0));
    vAlpha = pow(1.0 - aT, 1.7) * twinkle * uOpacity;
    vSeed = aSeed;
  }
`;

const COMET_SPARKLE_FRAGMENT = /* glsl */ `
  varying float vAlpha;
  varying float vSeed;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    float core = smoothstep(0.5, 0.0, d);
    float spike = max(0.0, 1.0 - abs(p.x) * 14.0) + max(0.0, 1.0 - abs(p.y) * 14.0);
    float alpha = (core + spike * 0.25 * core) * vAlpha;
    vec3 color = mix(vec3(0.7, 0.9, 1.0), vec3(1.0, 0.86, 0.6), vSeed);
    gl_FragColor = vec4(color * 1.6, alpha);
  }
`;

/* ====================================================================== */
/* Shader: vành xung kích nhỏ khi tia sáng chạm một ngôi sao              */
/* ====================================================================== */

const STAR_PULSE_VERTEX = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const STAR_PULSE_FRAGMENT = /* glsl */ `
  uniform float uProgress;
  uniform float uAlpha;
  uniform vec3 uColor;

  varying vec2 vUv;

  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;

    float ringRadius = 0.2 + uProgress * 0.72;
    float ringWidth = 0.026 + 0.03 * (1.0 - uProgress);
    float ring = smoothstep(ringWidth, 0.0, abs(r - ringRadius));
    float innerGlow = smoothstep(ringRadius, 0.0, r) * 0.1;

    float angle = atan(p.y, p.x);
    float shimmer = 0.72 + 0.28 * sin(angle * 8.0 + uProgress * 14.0);
    ring *= shimmer;

    float alpha = (ring + innerGlow) * uAlpha;
    vec3 color = uColor * (1.3 + ring * 2.4);

    gl_FragColor = vec4(color, alpha);
  }
`;
