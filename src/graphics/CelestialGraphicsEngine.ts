import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import type { ICelestialGraphics } from '../shared/ICelestialGraphics';
import type { StarNode, CometPhysicsState, ConstellationEdge } from '../shared/CosmicTypes';
import { ObservatoryEnvironment } from './ObservatoryEnvironment';
import { ConstellationWebRenderer } from './ConstellationWebRenderer';
import { SupernovaEffect } from './SupernovaEffect';
import { clamp, damp } from './GraphicsUtils';

const BLOOM_BASE_STRENGTH = 0.55;
const BASE_EXPOSURE = 0.98;
const BASE_CAMERA_POSITION = new THREE.Vector3(0, 13, 56);
const BASE_LOOK_TARGET = new THREE.Vector3(0, 0.4, 0);

/**
 * 🎨 CelestialGraphicsEngine — DeepSeek (/src/graphics)
 *
 * Hiện thực đầy đủ ICelestialGraphics:
 * - WebGLRenderer ACESFilmicToneMapping + EffectComposer (HalfFloat).
 * - UnrealBloomPass làm rực sáng 28 vì tinh tú, mạng LineSegments, sao chổi,
 *   siêu tân tinh; SMAA khử răng cưa viền đồng. Bảng tên học sinh được render
 *   ở overlay sau bloom nên sắc nét.
 * - Vòm trời Milky Way, Đài thiên văn Armillary Sphere, sao chổi ribbon,
 *   Supernova & bảng vinh danh.
 *
 * Engine tự chạy một vòng RAF dự phòng khi Core chưa/không còn gọi
 * updatePhysicsFrame, nhờ đó đài thiên văn vẫn "thở" và bảng tên vẫn hoàn tất
 * hiệu ứng phóng to ngay cả khi mô phỏng vật lý tạm dừng.
 */
export class CelestialGraphicsEngine implements ICelestialGraphics {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 4000);

  private container: HTMLElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private smaaPass: SMAAPass | null = null;
  private outputPass: OutputPass | null = null;
  private envRenderTarget: THREE.WebGLRenderTarget | null = null;
  private vignette: HTMLDivElement | null = null;

  private environment: ObservatoryEnvironment | null = null;
  private web: ConstellationWebRenderer | null = null;
  private supernova: SupernovaEffect | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private animationFrameId = 0;
  private loopRunning = false;
  private disposed = false;

  private stars: StarNode[] = [];
  private edges: ConstellationEdge[] = [];
  private comet: CometPhysicsState = {
    position: new THREE.Vector3(0, 0, 0),
    velocity: new THREE.Vector3(),
    targetStarId: -1,
    speedNormalized: 0,
    tailHistory: [],
  };

  private visualTime = 0;
  private weave = 0;
  private lastExternalFrameAt = Number.NEGATIVE_INFINITY;
  private lastLoopTimestamp = 0;

  private readonly lookTarget = new THREE.Vector3().copy(BASE_LOOK_TARGET);
  private readonly desiredCameraPosition = new THREE.Vector3();
  private readonly desiredLookTarget = new THREE.Vector3();

  private readonly onWindowResize = (): void => {
    if (!this.container) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.resize(width, height);
  };

  /* ================================================================== */
  /* Khởi tạo                                                           */
  /* ================================================================== */

  public init(container: HTMLElement, stars: StarNode[]): void {
    if (this.disposed || this.renderer) return;

    this.container = container;
    this.stars = stars;

    const width = Math.max(1, container.clientWidth || window.innerWidth);
    const height = Math.max(1, container.clientHeight || window.innerHeight);

    this.camera.aspect = width / height;
    this.camera.position.copy(BASE_CAMERA_POSITION);
    this.camera.lookAt(this.lookTarget);
    this.camera.updateProjectionMatrix();

    /* --------------------------- Renderer --------------------------- */
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = BASE_EXPOSURE;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const canvas = renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.zIndex = '0';

    if (window.getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }
    container.appendChild(canvas);
    this.renderer = renderer;

    // Vignette điện ảnh (không che HUD của Core ở #celestial-ui)
    const vignette = document.createElement('div');
    vignette.setAttribute('aria-hidden', 'true');
    vignette.style.position = 'absolute';
    vignette.style.inset = '0';
    vignette.style.pointerEvents = 'none';
    vignette.style.zIndex = '2';
    vignette.style.background =
      'radial-gradient(ellipse at 50% 46%, rgba(0,0,0,0) 36%, rgba(2,3,10,0.34) 70%, rgba(1,2,7,0.74) 100%)';
    container.appendChild(vignette);
    this.vignette = vignette;

    this.scene.background = new THREE.Color(0x02030a);

    /* --------------------- Môi trường phản chiếu -------------------- */
    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnvironment = new RoomEnvironment();
    this.envRenderTarget = pmrem.fromScene(roomEnvironment, 0.04);
    this.scene.environment = this.envRenderTarget.texture;
    this.scene.environmentIntensity = 0.22;
    roomEnvironment.dispose();
    pmrem.dispose();

    /* -------------------------- Thế giới ---------------------------- */
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

    this.environment = new ObservatoryEnvironment(maxAnisotropy);
    this.environment.setPixelRatio(renderer.getPixelRatio());
    this.scene.add(this.environment.group);

    this.web = new ConstellationWebRenderer(stars);
    this.web.setPixelRatio(renderer.getPixelRatio());
    this.scene.add(this.web.group);

    this.supernova = new SupernovaEffect(this.scene, maxAnisotropy, width, height);
    this.supernova.setPixelRatio(renderer.getPixelRatio());

    /* ----------------------- Post-processing ------------------------ */
    const composer = new EffectComposer(renderer);
    // Không dùng MSAA trên render target HalfFloat: một số driver/headless
    // resolve lỗi thành các vệt đen. SMAA ở cuối chuỗi thay thế an toàn hơn.
    composer.renderTarget1.samples = 0;
    composer.renderTarget2.samples = 0;

    composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      BLOOM_BASE_STRENGTH,
      0.5,
      0.9
    );
    composer.addPass(this.bloomPass);

    this.outputPass = new OutputPass();
    composer.addPass(this.outputPass);

    this.smaaPass = new SMAAPass(width, height);
    composer.addPass(this.smaaPass);

    this.composer = composer;

    this.resize(width, height);

    /* --------------------- Vòng lặp & resize ------------------------ */
    this.lastExternalFrameAt = Number.NEGATIVE_INFINITY;
    this.startAnimationLoop();

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.onWindowResize());
      this.resizeObserver.observe(container);
    }
    window.addEventListener('resize', this.onWindowResize);

    console.log('[CelestialGraphicsEngine] Đài Thiên Văn đã khởi tạo.');
  }

  /* ================================================================== */
  /* Vòng lặp                                                           */
  /* ================================================================== */

  private startAnimationLoop(): void {
    if (this.loopRunning) return;
    this.loopRunning = true;
    this.lastLoopTimestamp = performance.now();

    const tick = (now: number): void => {
      if (this.disposed) return;
      this.animationFrameId = requestAnimationFrame(tick);

      // Core đang chủ động gọi updatePhysicsFrame -> không render trùng.
      if (now - this.lastExternalFrameAt > 120) {
        const dt = clamp((now - this.lastLoopTimestamp) / 1000, 0, 0.05);
        this.step(dt);
      }
      this.lastLoopTimestamp = now;
    };

    this.animationFrameId = requestAnimationFrame(tick);
  }

  private step(dt: number): void {
    if (!this.renderer || !this.composer) return;

    const safeDt = clamp(dt, 0, 0.1);
    this.visualTime += safeDt;

    const cometSpeed = clamp(this.comet?.speedNormalized ?? 0, 0, 1);
    const weaveTarget = clamp(
      Math.max(cometSpeed, this.edges.length > 0 ? 0.45 : 0),
      0,
      1
    );
    this.weave = damp(this.weave, weaveTarget, 2.0, safeDt);

    this.updateCamera(safeDt);

    this.environment?.update(safeDt, this.visualTime, this.weave);
    this.web?.update(
      safeDt,
      this.visualTime,
      this.stars,
      this.comet,
      this.edges,
      this.camera
    );
    this.supernova?.update(safeDt, this.camera);

    const bloomBoost = this.supernova?.getBloomBoost() ?? 0;
    if (this.bloomPass) {
      this.bloomPass.strength = BLOOM_BASE_STRENGTH + bloomBoost * 0.45;
    }
    this.renderer.toneMappingExposure = BASE_EXPOSURE + bloomBoost * 0.08;

    this.composer.render(safeDt);

    // Bảng tên học sinh được vẽ sau bloom để giữ độ sắc nét tối đa.
    this.supernova?.renderOverlay(this.renderer, this.camera);
  }

  private updateCamera(dt: number): void {
    const t = this.visualTime;
    const azimuth = Math.sin(t * 0.045) * 0.26 + Math.sin(t * 0.013 + 1.7) * 0.12;
    const radius = 56 + Math.sin(t * 0.06 + 0.4) * 2.2 - this.weave * 2.0;
    const height = 13 + Math.sin(t * 0.055 + 2.0) * 2.1;

    this.desiredCameraPosition.set(
      Math.sin(azimuth) * radius,
      height,
      Math.cos(azimuth) * radius
    );

    this.desiredLookTarget.copy(BASE_LOOK_TARGET);
    if (this.weave > 0.04) {
      this.desiredLookTarget.lerp(this.comet.position, 0.14 * this.weave);
    }
    this.desiredLookTarget.y = clamp(this.desiredLookTarget.y, -6, 15);

    this.camera.position.lerp(
      this.desiredCameraPosition,
      1 - Math.exp(-dt * 0.55)
    );
    this.lookTarget.lerp(this.desiredLookTarget, 1 - Math.exp(-dt * 0.85));
    this.camera.lookAt(this.lookTarget);
  }

  /* ================================================================== */
  /* ICelestialGraphics                                                 */
  /* ================================================================== */

  public updatePhysicsFrame(
    dt: number,
    _elapsed: number,
    stars: StarNode[],
    comet: CometPhysicsState,
    edges: ConstellationEdge[]
  ): void {
    if (!this.renderer) return;

    this.lastExternalFrameAt = performance.now();
    this.stars = stars;
    this.comet = comet;
    this.edges = edges;

    this.step(dt);
  }

  public triggerSupernova(winnerStar: StarNode): void {
    this.web?.fadeOutComet();
    this.supernova?.trigger(winnerStar);
  }

  public resetVisuals(): void {
    this.web?.reset();
    this.supernova?.reset();
    this.weave = 0;

    for (const star of this.stars) {
      star.brightness = 1;
      star.isVisited = false;
      star.isWinner = false;
    }

    // Bỏ tham chiếu trạng thái cũ để vòng lặp dự phòng không vẽ lại
    // dải sao chổi / mạng lưới vừa được reset khi Core tạm dừng.
    this.edges = [];
    this.comet = {
      position: new THREE.Vector3(0, 0, 0),
      velocity: new THREE.Vector3(),
      targetStarId: -1,
      speedNormalized: 0,
      tailHistory: [],
    };

    if (this.bloomPass) {
      this.bloomPass.strength = BLOOM_BASE_STRENGTH;
    }
    if (this.renderer) {
      this.renderer.toneMappingExposure = BASE_EXPOSURE;
    }

    this.camera.position.copy(BASE_CAMERA_POSITION);
    this.lookTarget.copy(BASE_LOOK_TARGET);
    this.camera.lookAt(this.lookTarget);
  }

  public resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));

    if (!this.renderer) return;

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    this.composer?.setPixelRatio(pixelRatio);
    this.composer?.setSize(w, h);

    this.environment?.setPixelRatio(pixelRatio);
    this.web?.setPixelRatio(pixelRatio);
    this.supernova?.setPixelRatio(pixelRatio);
    this.supernova?.resize(w, h);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loopRunning = false;

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = 0;
    }

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('resize', this.onWindowResize);

    this.supernova?.dispose();
    this.web?.dispose();
    this.environment?.dispose();
    this.bloomPass?.dispose();
    this.smaaPass?.dispose();
    this.outputPass?.dispose();
    this.composer?.dispose();

    this.scene.environment = null;
    this.envRenderTarget?.dispose();
    this.envRenderTarget = null;

    this.scene.clear();

    this.vignette?.remove();
    this.vignette = null;

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
      this.renderer = null;
    }

    this.composer = null;
    this.bloomPass = null;
    this.smaaPass = null;
    this.outputPass = null;
    this.supernova = null;
    this.web = null;
    this.environment = null;
    this.container = null;
  }
}
