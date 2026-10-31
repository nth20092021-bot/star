import type { StarNode, CometPhysicsState, ConstellationEdge } from './CosmicTypes';

/**
 * Interface chuẩn quy định toàn bộ các phương thức mà DeepSeek bắt buộc
 * phải hiện thực trong `/src/graphics/CelestialGraphicsEngine.ts`.
 *
 * Antigravity (/src/core) chỉ tương tác với hệ thống đồ họa thông qua interface này
 * và qua CosmicEventBus, tuyệt đối không chạm vào renderer nội bộ của Three.js.
 */
export interface ICelestialGraphics {
  /**
   * Khởi tạo WebGL Scene, Camera, Renderer, Post-processing (UnrealBloomPass),
   * vòm trời Milky Way, Đài thiên văn Armillary Sphere, và nạp 28 ngôi sao ban đầu.
   *
   * @param container Phần tử HTML chứa canvas 3D
   * @param stars Danh sách 28 ngôi sao đã được tính toán vị trí ban đầu
   */
  init(container: HTMLElement, stars: StarNode[]): void | Promise<void>;

  /**
   * Cập nhật frame đồ họa theo nhịp mô phỏng vật lý của Antigravity (gọi trong requestAnimationFrame).
   *
   * @param dt Thời gian chênh lệch giữa 2 frame (delta time tính bằng giây)
   * @param elapsed Tổng thời gian mô phỏng đã trôi qua (giây)
   * @param stars Mảng 28 ngôi sao với tọa độ và độ sáng cập nhật
   * @param comet Trạng thái vật lý của sao chổi (tọa độ, vận tốc, lịch sử đuôi)
   * @param edges Danh sách các cạnh chòm sao đang được kết nối và phát sáng
   */
  updatePhysicsFrame(
    dt: number,
    elapsed: number,
    stars: StarNode[],
    comet: CometPhysicsState,
    edges: ConstellationEdge[]
  ): void;

  /**
   * Kích hoạt hiệu ứng vụ nổ siêu tân tinh (Supernova explosion) hoành tráng
   * tại ngôi sao định mệnh chiến thắng:
   * - Hàng nghìn hạt ánh sáng bùng nổ (particle burst).
   * - Vòng sóng xung kích giãn nở (shockwave ring).
   * - Gia tăng độ chói bloom cục bộ qua UnrealBloomPass.
   *
   * @param winnerStar Ngôi sao học sinh chiến thắng
   */
  triggerSupernova(winnerStar: StarNode): void;

  /**
   * Đưa toàn bộ hiệu ứng đồ họa về trạng thái tĩnh ban đầu:
   * - Xóa các đường nối chòm sao (LineSegments).
   * - Đưa các ngôi sao về độ sáng cơ bản (brightness = 1.0, isVisited = false, isWinner = false).
   * - Ẩn sao chổi và dọn dẹp tàn dư vụ nổ Supernova.
   */
  resetVisuals(): void;

  /**
   * Ẩn bảng thông báo vinh danh Supernova và trở về trạng thái quan sát
   */
  dismissPlaque(): void;

  /**
   * Xử lý khi kích thước cửa sổ trình duyệt thay đổi
   * Cập nhật Camera Aspect Ratio, Renderer Size, và EffectComposer Size.
   *
   * @param width Chiều rộng mới của viewport (px)
   * @param height Chiều cao mới của viewport (px)
   */
  resize(width: number, height: number): void;

  /**
   * Dọn dẹp tài nguyên GPU (geometries, materials, textures, passes) khi hủy đài thiên văn
   */
  dispose?(): void;
}

