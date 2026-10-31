import * as THREE from 'three';

/**
 * Đại diện cho 1 trong 28 ngôi sao trong vũ trụ (đại diện cho 28 học sinh).
 * Tọa độ và trạng thái vật lý được điều khiển bởi Antigravity (/src/core)
 * và được render bằng đồ họa phát sáng bởi DeepSeek (/src/graphics).
 */
export interface StarNode {
  /** ID định danh duy nhất (1 - 28) */
  id: number;
  /** Tên học sinh gắn với ngôi sao */
  studentName: string;
  /** Bán kính quỹ đạo từ tâm đài thiên văn */
  orbitRadius: number;
  /** Góc nghiêng quỹ đạo (radians) */
  inclination: number;
  /** Tốc độ quay góc phương vị (rad/s) */
  azimuthSpeed: number;
  /** Tọa độ gốc ban đầu */
  basePosition: THREE.Vector3;
  /** Tọa độ hiện tại (cập nhật theo quỹ đạo từng frame) */
  currentPosition: THREE.Vector3;
  /** Độ sáng ngôi sao (0.0 -> 2.0) */
  brightness: number;
  /** Đã được sao chổi ghé thăm qua trong lượt dệt chưa */
  isVisited: boolean;
  /** Ngôi sao được chọn là người chiến thắng cuối cùng */
  isWinner: boolean;
}

/**
 * Dữ liệu đường liên kết chòm sao truyền sang THREE.LineSegments động
 */
export interface ConstellationEdge {
  /** ID ngôi sao xuất phát */
  fromStarId: number;
  /** ID ngôi sao đích đến */
  toStarId: number;
  /** Vị trí bắt đầu của tia sáng */
  startPos: THREE.Vector3;
  /** Vị trí kết thúc của tia sáng */
  endPos: THREE.Vector3;
  /** Cường độ sáng của tia liên kết (0.0 -> 1.0, mờ dần theo thời gian hoặc duy trì) */
  intensity: number;
  /** Thời điểm tạo tia sáng (timestamp ms hoặc elapsed time s) */
  createdAt: number;
}

/**
 * Trạng thái vật lý thời gian thực của Sao Chổi (Shooting Star)
 */
export interface CometPhysicsState {
  /** Vị trí không gian 3D hiện tại của đầu sao chổi */
  position: THREE.Vector3;
  /** Vector vận tốc di chuyển */
  velocity: THREE.Vector3;
  /** ID ngôi sao mục tiêu mà sao chổi đang hướng tới */
  targetStarId: number;
  /** Tốc độ chuẩn hóa (1.0 = vận tốc cực đại ban đầu, 0.0 = dừng hẳn tại Supernova) */
  speedNormalized: number;
  /** Lịch sử vị trí các điểm của đuôi sao chổi (phục vụ hiệu ứng Ribbon / Trail Shader) */
  tailHistory: THREE.Vector3[];
}

/**
 * Payload sự kiện khi Sao Chổi kết nối với một ngôi sao mới
 */
export interface StarLinkedPayload {
  starId: number;
  position: THREE.Vector3;
  stepIndex: number;
  speedNormalized: number;
}

/**
 * Payload sự kiện cập nhật frame vật lý của Sao Chổi
 */
export interface CometStepPayload {
  comet: CometPhysicsState;
  edges: ConstellationEdge[];
  elapsed: number;
  dt: number;
}

/**
 * Payload sự kiện bắt đầu hành trình dệt chòm sao
 */
export interface WeaveStartPayload {
  initialStarId: number;
  totalSteps: number;
  timestamp: number;
}

/**
 * Payload sự kiện khóa chặt ngôi sao định mệnh & nổ Supernova
 */
export interface SupernovaPayload {
  winnerStar: StarNode;
  position: THREE.Vector3;
}

/**
 * Hằng số cấu hình hệ thống thiên văn học
 */
export const CELESTIAL_CONSTANTS = {
  TOTAL_STARS: 28,
  DEFAULT_CAMERA_DISTANCE: 45,
  MIN_ORBIT_RADIUS: 18,
  MAX_ORBIT_RADIUS: 32,
  ARMILLARY_RADIUS: 36,
  MAX_TAIL_LENGTH: 40,
} as const;
