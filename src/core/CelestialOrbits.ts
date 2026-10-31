import * as THREE from 'three';
import type { StarNode } from '../shared/CosmicTypes';
import { CELESTIAL_CONSTANTS } from '../shared/CosmicTypes';

export const STUDENT_NAMES: string[] = [
  'Vương Trần Thiên Ái',
  'Nguyễn Hải Anh',
  'Nguyễn Phạm Minh Anh',
  'Nguyễn Ngọc Minh Châu',
  'Nguyễn Trần Diễm Chi',
  'Nguyễn Khải Hoàn',
  'A Se Kinl',
  'Trình Nhã Kỳ',
  'Nguyễn Ngọc Bảo Linh',
  'Phạm Hoàng Trúc Linh',
  'Bành Gia Mẫn',
  'Trần Thục Bảo Nghi',
  'Thiên Ngọc',
  'Bùi Hoàng Nhân',
  'Vũ Nguyễn Yến Nhi',
  'Ngô Tâm Như',
  'Nguyễn Ngọc Thảo Như',
  'Bùi Nguyễn Phúc Ni',
  'Hoàng Phúc',
  'Lê Ngọc Thuận',
  'Nguyễn Minh Thư',
  'Trần Ngọc Anh Thư',
  'Hồ Ngọc Bảo Thy',
  'Nguyễn Ngọc Phương Trang',
  'Nguyễn Minh Triết',
  'Huỳnh Ngọc Thanh Vy',
  'Lê Ngọc Tường Vy',
  'Đặng Thanh Xuân'
];

/**
 * Khởi tạo 28 ngôi sao phân bổ đều trên mặt cầu Fibonacci (Fibonacci Sphere Lattice)
 * Tránh va chạm hoặc chồng lấn vị trí trong không gian 3D của Đài Thiên Văn.
 */
export function generateCelestialStars(): StarNode[] {
  const count = CELESTIAL_CONSTANTS.TOTAL_STARS;
  const stars: StarNode[] = [];
  const goldenRatio = (1 + Math.sqrt(5)) / 2;
  const goldenAngle = 2 * Math.PI * (1 - 1 / goldenRatio);

  const minR = CELESTIAL_CONSTANTS.MIN_ORBIT_RADIUS; // 18
  const maxR = CELESTIAL_CONSTANTS.MAX_ORBIT_RADIUS; // 32

  for (let i = 0; i < count; i++) {
    // Phân bổ đều cao độ y trên hình cầu (-0.85 đến +0.85 để không tụ quá dày ở 2 cực)
    const normalizedY = 1 - (i / (count - 1)) * 2;
    const yClamped = normalizedY * 0.82;
    const radiusAtY = Math.sqrt(Math.max(0, 1 - yClamped * yClamped));

    const theta = goldenAngle * i;

    // Phân tầng bán kính 3 lớp quỹ đạo (inner, middle, outer) để tạo chiều sâu
    const layer = i % 3;
    const baseRadius = minR + ((maxR - minR) / 2) * (layer * 0.45 + 0.1) + ((i * 1.7) % 3);

    const x = Math.cos(theta) * radiusAtY * baseRadius;
    const y = yClamped * baseRadius;
    const z = Math.sin(theta) * radiusAtY * baseRadius;

    const basePosition = new THREE.Vector3(x, y, z);
    const currentPosition = basePosition.clone();

    // Góc nghiêng quỹ đạo riêng biệt cho từng ngôi sao
    const inclination = ((i % 5) - 2) * 0.12 + (i * 0.03);
    // Tốc độ xoay vi phân chậm rãi quanh trục đài thiên văn
    const azimuthSpeed = 0.025 + ((i % 7) * 0.008);

    const rawName = STUDENT_NAMES[i] || `Vì Sao Thứ ${i + 1}`;
    const name = rawName.normalize('NFC');

    stars.push({
      id: i + 1,
      studentName: name,
      orbitRadius: baseRadius,
      inclination,
      azimuthSpeed,
      basePosition,
      currentPosition,
      brightness: 1.0,
      isVisited: false,
      isWinner: false,
    });
  }

  return stars;
}

/**
 * Cập nhật tọa độ quỹ đạo vi sai của ngôi sao theo thời gian thực
 */
export function updateStarOrbit(star: StarNode, elapsed: number): void {
  const angle = elapsed * star.azimuthSpeed;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  // Xoay quanh trục Y kết hợp độ nghiêng quỹ đạo
  const bx = star.basePosition.x;
  const by = star.basePosition.y;
  const bz = star.basePosition.z;

  // Xoay trục Y
  const rx = bx * cosA - bz * sinA;
  const rz = bx * sinA + bz * cosA;

  // Dao động nhẹ theo độ nghiêng
  const tiltY = by + Math.sin(angle * 1.2 + star.inclination) * 0.6;

  star.currentPosition.set(rx, tiltY, rz);
}

