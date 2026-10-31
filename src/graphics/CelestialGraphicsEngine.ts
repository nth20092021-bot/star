import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import type { ICelestialGraphics } from '../shared/ICelestialGraphics';
import type { StarNode, CometPhysicsState, ConstellationEdge } from '../shared/CosmicTypes';
import { cosmicEventBus } from '../shared/CosmicEventBus';
import { ObservatoryCameraDirector } from '../core/ObservatoryCameraDirector';
import { ObservatoryEnvironment } from './ObservatoryEnvironment';
import { ConstellationWebRenderer } from './ConstellationWebRenderer';
import { SupernovaEffect } from './SupernovaEffect';
import { CosmicAudioEngine } from './CosmicAudioEngine';
import { clamp, damp } from './GraphicsUtils';
import type { CinematicPhase } from './GraphicsUtils';

const BLOOM_BASE_STRENGTH = 0.55;
const BASE_EXPOSURE = 0.98;
const BASE_CAMERA_POSITION = new THREE.Vector3(0, 13, 56);
const BASE_LOOK_TARGET = new THREE.Vector3(0, 0.4, 0);

const SOUND_ON_ICON = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#ffd166" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.4 6.1a9 9 0 0 1 0 11.8"/></svg>`;
const SOUND_OFF_ICON = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#8b949e" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><line x1="16" y1="9" x2="21" y2="14"/><line x1="21" y1="9" x2="16" y2="14"/></svg>`;

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
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 4000);

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
  private readonly audio = new CosmicAudioEngine();
  private audioButton: HTMLButtonElement | null = null;

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
  private lastStepWall = 0;

  private readonly cinematicPhase: CinematicPhase = { active: false, time: 0, act: 0 };
  private localCinematicActive = false;
  private localCinematicTime = 0;
  private readonly effectUnsubscribers: Array<() => void> = [];

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
    this.lastStepWall = performance.now();
    this.startAnimationLoop();

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.onWindowResize());
      this.resizeObserver.observe(container);
    }
    window.addEventListener('resize', this.onWindowResize);

    this.effectUnsubscribers.push(
      cosmicEventBus.on('WEAVE_START', () => {
        this.localCinematicActive = true;
        this.localCinematicTime = 0;
      }),
      cosmicEventBus.on('STAR_LINKED', ({ starId, position }) => {
        this.web?.triggerStarPulse(position, starId);
        const star = this.stars.find((item) => item.id === starId);
        if (star) {
          this.web?.showStudentHologram(star.studentName, position, starId);
        }
      }),
      cosmicEventBus.on('CAMERA_RESET', () => {
        this.localCinematicActive = false;
        this.localCinematicTime = 0;
      })
    );

    // Âm thanh điện ảnh tổng hợp + nút tắt tiếng tối giản ở góc trái.
    this.audio.attach();
    this.createAudioButton();

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

    // Đồng hồ thực cho toàn bộ hiệu ứng hình ảnh: giữ đúng nhịp 12 giây
    // kể cả khi trình duyệt tụt FPS hoặc chạy trong môi trường headless.
    const now = performance.now();
    const safeDt =
      this.lastStepWall > 0
        ? clamp((now - this.lastStepWall) / 1000, 0, 0.12)
        : clamp(dt, 0, 0.12);
    this.lastStepWall = now;
    this.visualTime += safeDt;

    this.updateCinematicPhase(safeDt);

    const cometSpeed = clamp(this.comet?.speedNormalized ?? 0, 0, 1);
    let weaveTarget = Math.max(cometSpeed, this.edges.length > 0 ? 0.45 : 0);
    if (this.cinematicPhase.active) {
      const cineTime = this.cinematicPhase.time;
      if (cineTime < 2) {
        weaveTarget = Math.max(weaveTarget, 0.8 + 0.2 * clamp(cineTime / 1.8, 0, 1));
      } else if (cineTime < 10.5) {
        weaveTarget = Math.max(weaveTarget, 0.55);
      } else {
        weaveTarget = Math.max(weaveTarget, 0.9);
      }
    }
    this.weave = damp(this.weave, clamp(weaveTarget, 0, 1), 2.0, safeDt);

    // Camera Director là nhạc trưởng; graphics chỉ sao chép tư thế đã damping.
    const director = ObservatoryCameraDirector.active;
    if (director) {
      this.applyDirectorPose(director);
    } else {
      this.updateCamera(safeDt);
    }

    this.environment?.update(
      safeDt,
      this.visualTime,
      this.weave,
      this.cinematicPhase
    );
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

  private updateCinematicPhase(dt: number): void {
    if (this.localCinematicActive) {
      this.localCinematicTime += dt;
    }

    const director = ObservatoryCameraDirector.active;
    if (director) {
      this.cinematicPhase.active =
        director.isCinematicActive() || director.getMode() === 'SUPERNOVA_FOCUS';
      this.cinematicPhase.time = director.getCinematicTime();
      this.cinematicPhase.act = director.getAct();
      return;
    }

    this.cinematicPhase.active = this.localCinematicActive;
    this.cinematicPhase.time = this.localCinematicTime;
    this.cinematicPhase.act = this.localCinematicActive
      ? this.estimateFallbackAct(this.localCinematicTime)
      : 0;
  }

  private estimateFallbackAct(time: number): number {
    if (time < 2) return 1;
    if (time < 7.5) return 2;
    if (time < 10.5) return 3;
    return 4;
  }

  private applyDirectorPose(director: ObservatoryCameraDirector): void {
    this.camera.position.copy(director.getCameraPosition());
    this.camera.quaternion.copy(director.getCameraQuaternion());

    const fov = director.getFov();
    if (Math.abs(this.camera.fov - fov) > 0.001) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
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
    this.web?.triggerEnergySurge(winnerStar.currentPosition);
    this.web?.fadeOutComet();
    this.supernova?.trigger(winnerStar);
  }

  public dismissPlaque(): void {
    this.supernova?.reset();
  }

  public resetVisuals(): void {
    this.audio.reset();
    this.web?.reset();
    this.supernova?.reset();
    this.environment?.resetCinematic();
    this.weave = 0;
    this.localCinematicActive = false;
    this.localCinematicTime = 0;
    this.cinematicPhase.active = false;
    this.cinematicPhase.time = 0;
    this.cinematicPhase.act = 0;
    this.lastStepWall = performance.now();

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

    // Khi có CameraDirector, hãy để director tự đưa camera về idle bằng
    // damping; nếu chạy độc lập thì đặt lại camera ngay.
    if (!ObservatoryCameraDirector.active) {
      this.camera.position.copy(BASE_CAMERA_POSITION);
      this.lookTarget.copy(BASE_LOOK_TARGET);
      this.camera.lookAt(this.lookTarget);
      this.camera.fov = 50;
      this.camera.updateProjectionMatrix();
    }
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

  /* ================================================================== */
  /* Nút âm thanh                                                       */
  /* ================================================================== */

  private createAudioButton(): void {
    if (!this.container || this.audioButton) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.style.cssText = [
      'position:absolute',
      // Nằm ngay dưới hàng HUD trên cùng: hàng đó phủ pointer-events toàn
      // chiều ngang nên đặt cao hơn sẽ bị chặn click.
      'top:76px',
      'left:24px',
      'z-index:6',
      'width:42px',
      'height:42px',
      'border-radius:50%',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'cursor:pointer',
      'outline:none',
      'pointer-events:auto',
      'background:rgba(9,13,28,0.78)',
      'backdrop-filter:blur(14px)',
      'border:1px solid rgba(255,255,255,0.2)',
      'box-shadow:0 4px 20px rgba(0,0,0,0.35)',
      'transition:all 0.25s ease',
    ].join(';');

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const muted = this.audio.toggleMute();
      this.updateAudioButton(muted);
    });
    button.addEventListener('mouseenter', () => {
      button.style.transform = 'scale(1.08)';
      button.style.borderColor = 'rgba(255,209,102,0.6)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.transform = 'none';
      button.style.borderColor = 'rgba(255,255,255,0.2)';
    });

    this.container.appendChild(button);
    this.audioButton = button;
    this.updateAudioButton(this.audio.isMuted());
  }

  private updateAudioButton(muted: boolean): void {
    const button = this.audioButton;
    if (!button) return;

    button.setAttribute('aria-pressed', String(muted));
    const label = muted ? 'Bật âm thanh' : 'Tắt âm thanh';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = muted ? SOUND_OFF_ICON : SOUND_ON_ICON;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loopRunning = false;

    for (const unsub of this.effectUnsubscribers) {
      unsub();
    }
    this.effectUnsubscribers.length = 0;

    this.audio.dispose();
    this.audioButton?.remove();
    this.audioButton = null;

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
