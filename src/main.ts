import { cosmicEventBus } from './shared/CosmicEventBus';
import type { StarNode } from './shared/CosmicTypes';
import { CelestialGraphicsEngine } from './graphics/CelestialGraphicsEngine';

// Khởi tạo container và engine đồ họa
const container = document.getElementById('celestial-canvas-container');

async function bootstrap() {
  if (!container) {
    console.error('Không tìm thấy #celestial-canvas-container');
    return;
  }

  // Khởi tạo danh sách 28 ngôi sao đại diện ban đầu (Antigravity /src/core sẽ tạo thuật toán quỹ đạo chính thức)
  const initialStars: StarNode[] = [];

  const graphicsEngine = new CelestialGraphicsEngine();
  await graphicsEngine.init(container, initialStars);

  // Đăng ký các sự kiện cơ bản từ CosmicEventBus
  cosmicEventBus.on('STAR_LOCKED_SUPERNOVA', ({ winnerStar }) => {
    graphicsEngine.triggerSupernova(winnerStar);
  });

  cosmicEventBus.on('CAMERA_RESET', () => {
    graphicsEngine.resetVisuals();
  });

  window.addEventListener('resize', () => {
    graphicsEngine.resize(window.innerWidth, window.innerHeight);
  });

  console.log('🌌 [Main] Đài Thiên Văn Dệt Chòm Sao đã sẵn sàng.');
}

bootstrap().catch(console.error);
