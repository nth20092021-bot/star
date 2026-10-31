import * as THREE from 'three';
import type { ICelestialGraphics } from '../shared/ICelestialGraphics';
import type { StarNode, CometPhysicsState, ConstellationEdge } from '../shared/CosmicTypes';

/**
 * 🎨 CelestialGraphicsEngine
 * Phụ trách độc quyền bởi DEEPSEEK (/src/graphics)
 *
 * Hiện thực hóa toàn bộ hiển thị 3D:
 * - Vòm trời Milky Way Shader (mây tinh vân FBM + bụi sao)
 * - Đài thiên văn Armillary Sphere với các vòng xoay bằng đồng cổ
 * - THREE.LineSegments động vẽ tia sáng chòm sao
 * - Hiệu ứng hạt nổ Supernova + Shockwave ring
 * - Post-processing UnrealBloomPass r170+
 */
export class CelestialGraphicsEngine implements ICelestialGraphics {
  private container: HTMLElement | null = null;
  private scene: THREE.Scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera();
  private renderer: THREE.WebGLRenderer | null = null;

  public async init(container: HTMLElement, stars: StarNode[]): Promise<void> {
    this.container = container;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // Thiết lập Camera
    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000);
    this.camera.position.set(0, 15, 45);

    // Thiết lập Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.container.appendChild(this.renderer.domElement);

    console.log(`[CelestialGraphicsEngine] Initialized with ${stars.length} stars. Ready for DeepSeek graphics implementation.`);
  }

  public updatePhysicsFrame(
    _dt: number,
    _elapsed: number,
    _stars: StarNode[],
    _comet: CometPhysicsState,
    _edges: ConstellationEdge[]
  ): void {
    // DeepSeek sẽ cập nhật vị trí sao, đuôi sao chổi và buffer LineSegments ở đây
    if (this.renderer) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  public triggerSupernova(winnerStar: StarNode): void {
    console.log(`[CelestialGraphicsEngine] Supernova triggered at winner star: ${winnerStar.studentName} (ID: ${winnerStar.id})`);
    // DeepSeek sẽ kích hoạt shockwave ring và burst particles ở đây
  }

  public resetVisuals(): void {
    console.log('[CelestialGraphicsEngine] Visuals reset to initial observatory state.');
    // DeepSeek sẽ dọn dẹp các đường nối và particles ở đây
  }

  public resize(width: number, height: number): void {
    if (!this.renderer) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public dispose(): void {
    if (this.renderer && this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
      this.renderer.dispose();
    }
  }
}
