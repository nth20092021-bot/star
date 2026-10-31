import * as THREE from 'three';
import type {
  StarNode,
  ConstellationEdge,
  CometPhysicsState,
} from '../shared/CosmicTypes';
import { CELESTIAL_CONSTANTS } from '../shared/CosmicTypes';
import { cosmicEventBus } from '../shared/CosmicEventBus';
import { generateCelestialStars, updateStarOrbit } from './CelestialOrbits';

export class OrbitalPhysicsEngine {
  private stars: StarNode[] = [];
  private edges: ConstellationEdge[] = [];
  private comet: CometPhysicsState = {
    position: new THREE.Vector3(0, 0, 0),
    velocity: new THREE.Vector3(0, 0, 0),
    targetStarId: -1,
    speedNormalized: 0,
    tailHistory: [],
  };

  private isRunning = false;
  private route: number[] = [];
  private routeIndex = 0;
  private totalRouteSteps = 0;
  private winnerStarId = -1;

  // Danh sách các học sinh đã từng được chọn (đảm bảo không lặp lại)
  private chosenWinnerIds: Set<number> = new Set();

  // Easing và điều khiển vận tốc giảm tốc dần (tinh chỉnh cho tiến trình nhanh & mượt)
  private currentSpeed = 0;
  private baseMaxSpeed = 150; // Tốc độ phóng cực nhanh ban đầu (đơn vị/giây)
  private minSpeed = 26;      // Vận tốc lượn nhịp cuối chậm lại hồi hộp
  private arrivalThreshold = 1.9;
  private previousLinkedStarId = -1;

  constructor() {
    this.initStars();
  }

  public initStars(): void {
    this.stars = generateCelestialStars();
    this.reset();
  }

  public getStars(): StarNode[] {
    return this.stars;
  }

  public getCometState(): CometPhysicsState {
    return this.comet;
  }

  public getEdges(): ConstellationEdge[] {
    return this.edges;
  }

  public isWeaving(): boolean {
    return this.isRunning;
  }

  /**
   * Bắt đầu lộ trình dệt mạng lưới chòm sao giảm tốc dần
   * Đảm bảo không lặp lại học sinh đã được chọn ở các vòng trước.
   * @param specifiedWinnerId Tùy chọn chỉ định ID ngôi sao chiến thắng (1 - 28)
   */
  public startWeaving(specifiedWinnerId?: number): boolean {
    if (this.isRunning) return false;

    // Lọc danh sách học sinh chưa từng được chọn
    const unchosenStars = this.stars.filter((s) => !this.chosenWinnerIds.has(s.id));
    if (unchosenStars.length === 0) {
      console.warn('[OrbitalPhysicsEngine] Tất cả 28 học sinh đều đã được chọn!');
      return false;
    }

    this.resetStateForNewRun();

    // Chọn ngôi sao chiến thắng từ tập học sinh chưa được chọn
    if (specifiedWinnerId && !this.chosenWinnerIds.has(specifiedWinnerId)) {
      this.winnerStarId = specifiedWinnerId;
    } else {
      const randIdx = Math.floor(Math.random() * unchosenStars.length);
      this.winnerStarId = unchosenStars[randIdx].id;
    }

    // Tạo lộ trình dệt ngẫu nhiên gồm 8 bước dệt nhanh và dứt khoát qua các ngôi sao
    const numSteps = 8;
    const availableIds = this.stars
      .map((s) => s.id)
      .filter((id) => id !== this.winnerStarId);

    // Shuffle mảng availableIds (Fisher-Yates)
    for (let i = availableIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [availableIds[i], availableIds[j]] = [availableIds[j], availableIds[i]];
    }

    this.route = availableIds.slice(0, numSteps - 1);
    this.route.push(this.winnerStarId);
    this.totalRouteSteps = this.route.length;
    this.routeIndex = 0;

    const firstStar = this.getStarById(this.route[0]);
    if (firstStar) {
      // Đặt sao chổi xuất phát từ ngoài không gian hoặc gần ngôi sao đầu tiên
      const startOffset = new THREE.Vector3(
        firstStar.currentPosition.x * 1.35,
        firstStar.currentPosition.y + 10,
        firstStar.currentPosition.z * 1.35
      );
      this.comet.position.copy(startOffset);
      this.comet.velocity.set(0, 0, 0);
      this.comet.targetStarId = firstStar.id;
      this.comet.speedNormalized = 1.0;
      this.comet.tailHistory = [startOffset.clone()];
    }

    this.isRunning = true;
    this.currentSpeed = this.baseMaxSpeed;

    cosmicEventBus.emit('WEAVE_START', {
      initialStarId: this.route[0],
      totalSteps: this.totalRouteSteps,
      timestamp: performance.now(),
    });

    console.log(
      `[OrbitalPhysicsEngine] Bắt đầu dệt chòm sao: ${this.totalRouteSteps} bước. Winner Star: #${this.winnerStarId}`
    );
    return true;
  }

  /**
   * Cập nhật chuyển động vật lý từng frame
   */
  public update(dt: number, elapsed: number): void {
    const safeDt = Math.min(dt, 0.05);

    // 1. Cập nhật quỹ đạo vi sai của 28 ngôi sao
    for (const star of this.stars) {
      updateStarOrbit(star, elapsed);
      // Giảm độ sáng sau cú boost
      if (star.brightness > 1.0 && !star.isWinner) {
        star.brightness = Math.max(1.0, star.brightness - safeDt * 1.8);
      }
    }

    // 2. Cập nhật tọa độ các cạnh đường nối chòm sao bám theo quỹ đạo ngôi sao
    for (const edge of this.edges) {
      const s1 = this.getStarById(edge.fromStarId);
      const s2 = this.getStarById(edge.toStarId);
      if (s1 && s2) {
        edge.startPos.copy(s1.currentPosition);
        edge.endPos.copy(s2.currentPosition);
      }
    }

    // 3. Mô phỏng vật lý Sao Chổi khi đang dệt
    if (this.isRunning && this.routeIndex < this.route.length) {
      this.simulateCometStep(safeDt, elapsed);
    }

    // 4. Phát COMET_STEP frame event
    cosmicEventBus.emit('COMET_STEP', {
      comet: this.comet,
      edges: this.edges,
      elapsed,
      dt: safeDt,
    });
  }

  private simulateCometStep(dt: number, elapsed: number): void {
    const targetStarId = this.route[this.routeIndex];
    const targetStar = this.getStarById(targetStarId);
    if (!targetStar) return;

    const targetPos = targetStar.currentPosition;
    const toTarget = new THREE.Vector3().subVectors(targetPos, this.comet.position);
    const distance = toTarget.length();

    // Tính toán tốc độ giảm tốc dần theo tiến độ lộ trình (Exponential / Deceleration Easing)
    // progress: 0.0 (mới xuất phát) -> 1.0 (chạm ngôi sao chiến thắng)
    const progress = (this.routeIndex + Math.max(0, 1 - distance / 15)) / this.totalRouteSteps;
    const clampedProgress = Math.max(0, Math.min(1, progress));

    // Đường cong giảm tốc: Tốc độ giảm dần đều từ baseMaxSpeed xuống minSpeed
    const speedDecay = Math.pow(1 - clampedProgress, 1.4);
    this.currentSpeed = this.minSpeed + (this.baseMaxSpeed - this.minSpeed) * speedDecay;

    // Chuẩn hóa speedNormalized (1.0 -> 0.05)
    this.comet.speedNormalized = Math.max(0.05, this.currentSpeed / this.baseMaxSpeed);

    // Tính lực lái chuyển hướng mượt mà (Steering / Smooth Pursuit with Inertia)
    toTarget.normalize();
    const desiredVelocity = toTarget.multiplyScalar(this.currentSpeed);

    // Thêm lực xoáy cung nhẹ (Arc bias) để sao chổi bay lượn hình vòng cung không gian
    const arcAxis = new THREE.Vector3(0, 1, 0);
    const arcVector = new THREE.Vector3().crossVectors(desiredVelocity, arcAxis).normalize();
    const arcStrength = Math.sin(elapsed * 5 + this.routeIndex) * (this.currentSpeed * 0.12);
    desiredVelocity.addScaledVector(arcVector, arcStrength);

    // Quán tính: Damped interpolation cho vận tốc lượn nhanh & dứt khoát
    const steerSharpness = Math.min(1, dt * 14.0);
    this.comet.velocity.lerp(desiredVelocity, steerSharpness);

    // Cập nhật vị trí
    this.comet.position.addScaledVector(this.comet.velocity, dt);

    // Lưu lại lịch sử đuôi sao chổi (Tail Ribbon History)
    this.comet.tailHistory.unshift(this.comet.position.clone());
    if (this.comet.tailHistory.length > CELESTIAL_CONSTANTS.MAX_TAIL_LENGTH) {
      this.comet.tailHistory.pop();
    }

    // Kiểm tra đã chạm đích tới ngôi sao mục tiêu chưa
    if (distance <= this.arrivalThreshold) {
      this.onStarReached(targetStar, elapsed);
    }
  }

  private onStarReached(star: StarNode, elapsed: number): void {
    star.isVisited = true;
    star.brightness = 2.4; // Flash sáng chói tức thì

    // Tạo tia sáng kết nối từ ngôi sao trước đó tới ngôi sao này
    if (this.previousLinkedStarId !== -1 && this.previousLinkedStarId !== star.id) {
      const prevStar = this.getStarById(this.previousLinkedStarId);
      if (prevStar) {
        this.edges.push({
          fromStarId: prevStar.id,
          toStarId: star.id,
          startPos: prevStar.currentPosition.clone(),
          endPos: star.currentPosition.clone(),
          intensity: 1.0,
          createdAt: elapsed,
        });
      }
    }

    this.previousLinkedStarId = star.id;

    // Phát sự kiện STAR_LINKED
    cosmicEventBus.emit('STAR_LINKED', {
      starId: star.id,
      position: star.currentPosition.clone(),
      stepIndex: this.routeIndex + 1,
      speedNormalized: this.comet.speedNormalized,
    });

    this.routeIndex++;

    // Kiểm tra xem đã hoàn thành toàn bộ lộ trình dệt chưa (chạm Winner Star)
    if (this.routeIndex >= this.route.length) {
      this.onWeaveComplete(star);
    } else {
      this.comet.targetStarId = this.route[this.routeIndex];
    }
  }

  private onWeaveComplete(winnerStar: StarNode): void {
    this.isRunning = false;
    this.chosenWinnerIds.add(winnerStar.id);
    winnerStar.isWinner = true;
    winnerStar.brightness = 3.5;
    this.comet.speedNormalized = 0;
    this.comet.velocity.set(0, 0, 0);

    console.log(
      `🌟 [OrbitalPhysicsEngine] Khóa mục tiêu Supernova: "${winnerStar.studentName}" (#${winnerStar.id})! Đã chọn: ${this.chosenWinnerIds.size}/${this.stars.length}`
    );

    cosmicEventBus.emit('STAR_LOCKED_SUPERNOVA', {
      winnerStar,
      position: winnerStar.currentPosition.clone(),
    });
  }

  public getChosenWinnerIds(): Set<number> {
    return this.chosenWinnerIds;
  }

  public getRemainingCount(): number {
    return this.stars.length - this.chosenWinnerIds.size;
  }

  public resetChosenWinners(): void {
    this.chosenWinnerIds.clear();
    for (const star of this.stars) {
      star.isWinner = false;
    }
    this.reset();
  }

  public reset(): void {
    this.resetStateForNewRun();
    this.edges = [];

    for (const star of this.stars) {
      star.brightness = 1.0;
      star.isVisited = false;
      star.isWinner = false;
    }

    this.comet.position.set(0, 0, 0);
    this.comet.velocity.set(0, 0, 0);
    this.comet.targetStarId = -1;
    this.comet.speedNormalized = 0;
    this.comet.tailHistory = [];

    cosmicEventBus.emit('CAMERA_RESET', { immediate: false, duration: 1.5 });
  }

  private resetStateForNewRun(): void {
    this.isRunning = false;
    this.route = [];
    this.routeIndex = 0;
    this.totalRouteSteps = 0;
    this.winnerStarId = -1;
    this.previousLinkedStarId = -1;
    this.currentSpeed = 0;
  }

  public getStarById(id: number): StarNode | undefined {
    return this.stars.find((s) => s.id === id);
  }
}

