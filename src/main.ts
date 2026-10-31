import {
  OrbitalPhysicsEngine,
  ObservatoryCameraDirector,
  MinimalUI,
} from './core';
import { CelestialGraphicsEngine } from './graphics/CelestialGraphicsEngine';
import { cosmicEventBus } from './shared/CosmicEventBus';

async function bootstrap(): Promise<void> {
  const container = document.getElementById('celestial-canvas-container');
  if (!container) {
    console.error('Không tìm thấy #celestial-canvas-container trong DOM');
    return;
  }

  // 1. Khởi tạo OrbitalPhysicsEngine (Antigravity /src/core)
  const physicsEngine = new OrbitalPhysicsEngine();
  const initialStars = physicsEngine.getStars();

  // 2. Khởi tạo ObservatoryCameraDirector
  const cameraDirector = new ObservatoryCameraDirector();

  // 3. Khởi tạo CelestialGraphicsEngine (DeepSeek /src/graphics)
  const graphicsEngine = new CelestialGraphicsEngine();
  graphicsEngine.init(container, initialStars);

  // 4. Khởi tạo MinimalUI với các callback điều khiển tối giản
  new MinimalUI('celestial-ui', {
    onStart: () => {
      physicsEngine.startWeaving();
    },
    onNext: () => {
      // Ẩn bảng thông báo vinh danh và sẵn sàng cho lượt dệt tiếp theo
      graphicsEngine.dismissPlaque();
      physicsEngine.reset();
      cosmicEventBus.emit('DISMISS_PLAQUE', undefined);
    },
    onReset: () => {
      physicsEngine.reset();
      graphicsEngine.resetVisuals();
    },
    onResetHistory: () => {
      physicsEngine.resetChosenWinners();
      graphicsEngine.resetVisuals();
    },
    getStars: () => physicsEngine.getStars(),
    getChosenWinnerIds: () => physicsEngine.getChosenWinnerIds(),
  });

  // 5. Kết nối các sự kiện trên CosmicEventBus giữa Core & Graphics
  cosmicEventBus.on('STAR_LOCKED_SUPERNOVA', ({ winnerStar }) => {
    graphicsEngine.triggerSupernova(winnerStar);
  });

  cosmicEventBus.on('CAMERA_RESET', () => {
    graphicsEngine.resetVisuals();
  });

  cosmicEventBus.on('DISMISS_PLAQUE', () => {
    graphicsEngine.dismissPlaque();
  });

  // 6. Xử lý Window Resize
  const handleResize = (): void => {
    graphicsEngine.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', handleResize);

  // 7. Vòng lặp requestAnimationFrame truyền dữ liệu vật lý sang đồ họa
  let lastTimestamp = performance.now();
  let elapsed = 0;

  const loop = (now: number): void => {
    requestAnimationFrame(loop);

    const dt = Math.min((now - lastTimestamp) / 1000, 0.05);
    lastTimestamp = now;
    elapsed += dt;

    // Cập nhật tính toán vật lý quỹ đạo 28 sao và sao chổi
    physicsEngine.update(dt, elapsed);

    const stars = physicsEngine.getStars();
    const comet = physicsEngine.getCometState();
    const edges = physicsEngine.getEdges();

    // Cập nhật đạo diễn Camera
    cameraDirector.update(dt, comet);

    // Cung cấp frame vật lý cho CelestialGraphicsEngine vẽ (Three.js + PostProcessing)
    graphicsEngine.updatePhysicsFrame(dt, elapsed, stars, comet, edges);
  };

  requestAnimationFrame(loop);

  console.log('🌌 [Main] Đài Thiên Văn Dệt Chòm Sao đã kết nối thành công và đang hoạt động.');
}

bootstrap().catch(console.error);
