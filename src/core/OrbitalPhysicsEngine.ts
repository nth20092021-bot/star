import * as THREE from 'three';
import type {
  StarNode,
  ConstellationEdge,
  CometPhysicsState,
} from '../shared/CosmicTypes';
import { CELESTIAL_CONSTANTS } from '../shared/CosmicTypes';
import { cosmicEventBus } from '../shared/CosmicEventBus';
import { generateCelestialStars, updateStarOrbit } from './CelestialOrbits';

/* ====================================================================== */
/* Nhịp kịch bản 12.0 giây                                                */
/* ====================================================================== */

const ACT1_LAUNCH = 2.0;
const ACT2_END = 7.5;
const ACT2_VISIT_COUNT = 8;

/**
 * Mốc chạm sao (giây):
 * - 14 ngôi sao của Act 2 trải đều 2.0 → 7.5s.
 * - Ngôi thứ 15 (mở màn Act 3): 8.15s.
 * - Ngôi áp chót (ghìm lại, gần như dừng): 9.0s.
 * - Ngôi chiến thắng thật sự: 10.5s.
 */
const HIT_TIMES: readonly number[] = (() => {
  const times: number[] = [];
  for (let i = 0; i < ACT2_VISIT_COUNT; i += 1) {
    times.push(ACT1_LAUNCH + ((ACT2_END - ACT1_LAUNCH) * (i + 1)) / ACT2_VISIT_COUNT);
  }
  times.push(8.15, 9.0, 10.5);
  return times;
})();

const SPEED_REFERENCE = 58;
const ORB_CENTER = new THREE.Vector3(0, -1, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_SIDE = new THREE.Vector3(0, 0, 1);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/**
 * 🌠 OrbitalPhysicsEngine — Antigravity (/src/core)
 *
 * Chuyển mô phỏng sang timeline tuyệt đối 12.0 giây:
 * 1. Act 1 (0 → 2s): sao chổi tích năng lượng tại quả cầu trung tâm,
 *    đúng 2.0s phóng đi như một tia sáng.
 * 2. Act 2 (2 → 7.5s): xuyên qua 14 ngôi sao trên các cung Bezier 3D mượt,
 *    mỗi lần chạm phát STAR_LINKED và nối ConstellationEdge.
 * 3. Act 3 (7.5 → 10.5s): 3 ngôi sao cuối, ghìm tốc độ tại ngôi áp chót (9.0s),
 *    rồi ngoặt gắt lao dứt điểm về ngôi chiến thắng (10.5s).
 * 4. Act 4 (10.5s): khóa mục tiêu, phát STAR_LOCKED_SUPERNOVA.
 */
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
  private hitIndex = 0;
  private winnerStarId = -1;
  private previousLinkedStarId = -1;

  private cinematicActive = false;
  private cinematicTime = 0;
  private cinematicStartedAt = 0;
  private launched = false;
  private lastUpdateWall = performance.now();

  private segmentStartTime = 0;
  private segmentEndTime = 0;
  private readonly segmentStart = new THREE.Vector3();
  private readonly segmentControl1 = new THREE.Vector3();
  private readonly segmentEndOffset = new THREE.Vector3();
  private readonly lastEndTangent = new THREE.Vector3(1, 0, 0);

  // Danh sách các học sinh đã từng được chọn (đảm bảo không lặp lại)
  private readonly chosenWinnerIds: Set<number> = new Set();

  // Scratch vectors tái sử dụng mỗi frame
  private readonly tmpToTarget = new THREE.Vector3();
  private readonly tmpDirection = new THREE.Vector3();
  private readonly tmpSide = new THREE.Vector3();
  private readonly tmpLift = new THREE.Vector3();
  private readonly tmpControl2 = new THREE.Vector3();
  private readonly tmpBezier = new THREE.Vector3();
  private readonly tmpVelocity = new THREE.Vector3();

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

  public getCinematicTime(): number {
    return this.cinematicTime;
  }

  /**
   * Bắt đầu Kịch bản Điện ảnh 12 giây.
   * @param specifiedWinnerId Tùy chọn chỉ định ID ngôi sao chiến thắng (1 - 28)
   */
  public startWeaving(specifiedWinnerId?: number): boolean {
    if (this.isRunning) return false;

    const unchosenStars = this.stars.filter((s) => !this.chosenWinnerIds.has(s.id));
    if (unchosenStars.length === 0) {
      console.warn('[OrbitalPhysicsEngine] Tất cả 28 học sinh đều đã được chọn!');
      return false;
    }

    this.resetStateForNewRun();

    if (specifiedWinnerId && !this.chosenWinnerIds.has(specifiedWinnerId)) {
      this.winnerStarId = specifiedWinnerId;
    } else {
      const randIdx = Math.floor(Math.random() * unchosenStars.length);
      this.winnerStarId = unchosenStars[randIdx].id;
    }

    const winner = this.getStarById(this.winnerStarId);
    if (!winner) return false;

    this.route = this.buildRoute(winner);
    this.hitIndex = 0;
    this.cinematicActive = true;
    this.cinematicTime = 0;
    this.cinematicStartedAt = performance.now();
    this.launched = false;

    this.comet.position.copy(ORB_CENTER);
    this.comet.velocity.set(0, 0, 0);
    this.comet.targetStarId = this.route[0];
    this.comet.speedNormalized = 0;
    this.comet.tailHistory = [];
    this.previousLinkedStarId = -1;

    this.isRunning = true;

    cosmicEventBus.emit('WEAVE_START', {
      initialStarId: this.route[0],
      totalSteps: this.route.length,
      timestamp: performance.now(),
    });

    console.log(
      `[OrbitalPhysicsEngine] 🎬 Cinematic 12s bắt đầu: ${this.route.length} điểm chạm, ` +
        `winner #${this.winnerStarId} "${winner.studentName}".`
    );
    return true;
  }

  /* ================================================================== */
  /* Chọn lộ trình                                                       */
  /* ================================================================== */

  private buildRoute(winner: StarNode): number[] {
    const others = this.stars.filter((s) => s.id !== winner.id);

    // Hai ngôi sao cuối (trước winner) chọn gần winner để cụm 3 sao
    // cuối cùng tạo thành tâm điểm quay của Act 3.
    const nearPool = others
      .slice()
      .sort(
        (a, b) =>
          a.currentPosition.distanceToSquared(winner.currentPosition) -
          b.currentPosition.distanceToSquared(winner.currentPosition)
      )
      .slice(0, Math.min(7, others.length));
    const finaleStars = this.pickRandom(nearPool, 2);
    const finaleIds = new Set(finaleStars.map((s) => s.id));

    const act2Pool = others.filter((s) => !finaleIds.has(s.id));

    // Ưu tiên các ngôi sao phía trên sàn đài để màn rượt đuổi diễn ra
    // giữa tinh hà thay vì lao xuống dưới mặt cẩm thạch.
    let routePool = act2Pool.filter((s) => s.currentPosition.y > -8);
    if (routePool.length < ACT2_VISIT_COUNT) {
      routePool = act2Pool
        .slice()
        .sort((a, b) => b.currentPosition.y - a.currentPosition.y)
        .slice(0, ACT2_VISIT_COUNT);
    }

    const act2Stars = this.orderForChase(this.pickRandom(routePool, ACT2_VISIT_COUNT));

    return [
      ...act2Stars.map((s) => s.id),
      ...finaleStars.map((s) => s.id),
      winner.id,
    ];
  }

  private pickRandom(pool: StarNode[], count: number): StarNode[] {
    const copy = pool.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, Math.min(count, copy.length));
  }

  /**
   * Sắp xếp 14 ngôi sao Act 2 theo bước nhảy gần (có yếu tố ngẫu nhiên)
   * để tốc độ tia sáng vừa bay lượn liên tục vừa quét được nhiều vùng trời.
   */
  private orderForChase(pool: StarNode[]): StarNode[] {
    const remaining = pool.slice();
    if (remaining.length === 0) return remaining;

    const ordered: StarNode[] = [];
    let current = remaining.splice(Math.floor(Math.random() * remaining.length), 1)[0];
    ordered.push(current);

    while (remaining.length > 0) {
      remaining.sort(
        (a, b) =>
          a.currentPosition.distanceToSquared(current.currentPosition) -
          b.currentPosition.distanceToSquared(current.currentPosition)
      );
      const poolSize = Math.min(4, remaining.length);
      const pickIndex = Math.random() < 0.72 ? 0 : Math.floor(Math.random() * poolSize);
      current = remaining.splice(pickIndex, 1)[0];
      ordered.push(current);
    }

    return ordered;
  }

  /* ================================================================== */
  /* Vòng cập nhật                                                       */
  /* ================================================================== */

  public update(dt: number, elapsed: number): void {
    const safeDt = Math.min(dt, 0.05);
    const now = performance.now();
    const wallDt = Math.min(
      0.12,
      Math.max(1e-4, (now - this.lastUpdateWall) / 1000)
    );
    this.lastUpdateWall = now;

    // 1. Quỹ đạo vi sai của 28 ngôi sao (ngôi sao chiến thắng đứng yên tại tâm vụ nổ Supernova)
    for (const star of this.stars) {
      if (!star.isWinner) {
        updateStarOrbit(star, elapsed);
      }
      if (star.brightness > 1.0 && !star.isWinner) {
        star.brightness = Math.max(1.0, star.brightness - safeDt * 1.8);
      }
    }

    // 2. Cạnh chòm sao bám theo vị trí sao
    for (const edge of this.edges) {
      const s1 = this.getStarById(edge.fromStarId);
      const s2 = this.getStarById(edge.toStarId);
      if (s1 && s2) {
        edge.startPos.copy(s1.currentPosition);
        edge.endPos.copy(s2.currentPosition);
      }
    }

    // 3. Timeline điện ảnh — dùng đồng hồ thực để luôn đúng 12.0 giây
    // kể cả khi FPS dao động hoặc trình duyệt bị giật khung hình.
    if (this.cinematicActive) {
      this.cinematicTime = Math.max(
        0,
        (now - this.cinematicStartedAt) / 1000
      );
      this.updateCinematic(wallDt, elapsed);
    }

    // 4. Frame event
    cosmicEventBus.emit('COMET_STEP', {
      comet: this.comet,
      edges: this.edges,
      elapsed,
      dt: wallDt,
    });
  }

  private updateCinematic(dt: number, elapsed: number): void {
    // Act 1: tích năng lượng tại quả cầu trung tâm.
    if (this.cinematicTime < ACT1_LAUNCH) {
      this.comet.position.copy(ORB_CENTER);
      this.comet.velocity.set(0, 0, 0);
      this.comet.targetStarId = this.route[0] ?? -1;
      this.comet.speedNormalized = 0;
      return;
    }

    // Đúng 2.0s: phóng tia sáng khỏi quả cầu.
    if (!this.launched) {
      this.launched = true;
      this.beginSegment(0);
    }

    // Xử lý các mốc chạm sao đã đi qua trong frame này.
    let guard = 0;
    while (
      this.hitIndex < this.route.length &&
      this.cinematicTime >= HIT_TIMES[this.hitIndex] &&
      guard < this.route.length
    ) {
      const star = this.getStarById(this.route[this.hitIndex]);
      if (!star) break;

      this.comet.position.copy(star.currentPosition);
      this.pushTail();
      this.onStarReached(star, elapsed, this.hitIndex);

      this.hitIndex += 1;
      if (!this.isRunning || this.hitIndex >= this.route.length) return;

      this.beginSegment(this.hitIndex);
      guard += 1;
    }

    if (!this.isRunning || this.hitIndex >= this.route.length) return;

    const segmentIndex = this.hitIndex;
    const target = this.getStarById(this.route[segmentIndex]);
    if (!target) return;

    const span = Math.max(1e-3, this.segmentEndTime - this.segmentStartTime);
    const progress = clamp01((this.cinematicTime - this.segmentStartTime) / span);
    const eased = this.segmentEasing(segmentIndex, progress);

    // Điểm cuối bám theo quỹ đạo sống của ngôi sao đích.
    this.tmpControl2.copy(target.currentPosition).sub(this.segmentEndOffset);
    this.computeBezier(
      this.segmentStart,
      this.segmentControl1,
      this.tmpControl2,
      target.currentPosition,
      eased,
      this.tmpBezier
    );

    this.updateCometMotion(this.tmpBezier, dt);
    this.comet.targetStarId = target.id;
  }

  private segmentEasing(segmentIndex: number, progress: number): number {
    const p = clamp01(progress);

    // Cú lao cuối: khởi đầu gần như đứng yên (fake-out), rồi tăng tốc dữ dội.
    if (segmentIndex === this.route.length - 1) {
      return 1 - Math.pow(1 - p, 1.8);
    }

    // Đoạn tới ngôi áp chót: bay nhanh rồi ghìm dần, gần như dừng tại 9.0s.
    if (segmentIndex === this.route.length - 2) {
      return 1 - Math.pow(1 - p, 3.2);
    }

    return p;
  }

  private beginSegment(index: number): void {
    const target = this.getStarById(this.route[index]);
    if (!target) return;

    this.segmentStartTime = index === 0 ? ACT1_LAUNCH : HIT_TIMES[index - 1];
    this.segmentEndTime = HIT_TIMES[index];
    this.segmentStart.copy(this.comet.position);

    this.tmpToTarget.subVectors(target.currentPosition, this.segmentStart);
    const distance = Math.max(0.001, this.tmpToTarget.length());
    const direct = this.tmpDirection.copy(this.tmpToTarget).divideScalar(distance);

    // Nối tiếp tuyến mượt với cung trước.
    const outDirection =
      index === 0
        ? direct
        : this.tmpLift.copy(this.lastEndTangent).lerp(direct, 0.42).normalize();

    this.tmpSide.crossVectors(outDirection, WORLD_UP);
    if (this.tmpSide.lengthSq() < 1e-4) {
      this.tmpSide.crossVectors(outDirection, WORLD_SIDE);
    }
    this.tmpSide.normalize();

    const lateralSign = index % 2 === 0 ? 1 : -1;
    const arc = lateralSign * (1.8 + distance * 0.075);
    const lift = Math.sin(index * 1.7) * (0.8 + distance * 0.035);

    if (index === this.route.length - 1) {
      // Fake-out: mồi lệch sang bên rồi ngoặt gắt về winner.
      this.segmentControl1
        .copy(this.segmentStart)
        .addScaledVector(direct, distance * 0.16)
        .addScaledVector(this.tmpSide, distance * 0.24 * lateralSign)
        .addScaledVector(WORLD_UP, distance * 0.06);

      this.tmpControl2
        .copy(target.currentPosition)
        .addScaledVector(direct, -distance * 0.24)
        .addScaledVector(this.tmpSide, distance * 0.07);
    } else {
      this.segmentControl1
        .copy(this.segmentStart)
        .addScaledVector(outDirection, distance * 0.3)
        .addScaledVector(this.tmpSide, arc)
        .addScaledVector(WORLD_UP, lift);

      this.tmpControl2
        .copy(target.currentPosition)
        .addScaledVector(direct, -distance * 0.28)
        .addScaledVector(this.tmpSide, arc * 0.35);
    }

    // Lưu offset của control2 so với điểm cuối để nó bám theo sao đang quay.
    this.segmentEndOffset.subVectors(target.currentPosition, this.tmpControl2);
    this.lastEndTangent.copy(this.segmentEndOffset).normalize();
  }

  private computeBezier(
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    p3: THREE.Vector3,
    t: number,
    out: THREE.Vector3
  ): void {
    const u = 1 - t;
    const uu = u * u;
    const tt = t * t;
    out.set(
      uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
      uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y,
      uu * u * p0.z + 3 * uu * t * p1.z + 3 * u * tt * p2.z + tt * t * p3.z
    );
  }

  private updateCometMotion(nextPosition: THREE.Vector3, dt: number): void {
    const safeDt = Math.max(dt, 1e-4);
    this.tmpVelocity.subVectors(nextPosition, this.comet.position).divideScalar(safeDt);
    const rawSpeed = this.tmpVelocity.length();

    this.comet.velocity.lerp(this.tmpVelocity, 1 - Math.exp(-safeDt * 18));
    this.comet.position.copy(nextPosition);
    this.comet.speedNormalized = clamp(rawSpeed / SPEED_REFERENCE, 0.05, 1);
    this.pushTail();
  }

  private pushTail(): void {
    const head = this.comet.tailHistory[0];
    if (head && head.distanceToSquared(this.comet.position) < 0.012) {
      return;
    }
    this.comet.tailHistory.unshift(this.comet.position.clone());
    if (this.comet.tailHistory.length > CELESTIAL_CONSTANTS.MAX_TAIL_LENGTH) {
      this.comet.tailHistory.pop();
    }
  }

  private onStarReached(star: StarNode, elapsed: number, index: number): void {
    const isWinner = index >= this.route.length - 1;
    star.isVisited = true;
    star.brightness = Math.max(star.brightness, isWinner ? 4.2 : 2.7);

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

    cosmicEventBus.emit('STAR_LINKED', {
      starId: star.id,
      position: star.currentPosition.clone(),
      stepIndex: index + 1,
      speedNormalized: this.comet.speedNormalized,
    });

    if (isWinner) {
      this.finishRun(star);
    }
  }

  private finishRun(winner: StarNode): void {
    this.isRunning = false;
    this.cinematicActive = false;
    this.chosenWinnerIds.add(winner.id);
    winner.isWinner = true;
    winner.brightness = 4.2;
    this.comet.targetStarId = winner.id;
    this.comet.velocity.set(0, 0, 0);
    this.comet.speedNormalized = 0;

    console.log(
      `🌟 [OrbitalPhysicsEngine] Khóa mục tiêu Supernova lúc ${this.cinematicTime.toFixed(2)}s: ` +
        `"${winner.studentName}" (#${winner.id}) — ${this.chosenWinnerIds.size}/${this.stars.length}`
    );

    cosmicEventBus.emit('STAR_LOCKED_SUPERNOVA', {
      winnerStar: winner,
      position: winner.currentPosition.clone(),
    });
  }

  /* ================================================================== */
  /* Reset & truy vấn                                                    */
  /* ================================================================== */

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
    this.cinematicActive = false;
    this.cinematicTime = 0;
    this.launched = false;
    this.route = [];
    this.hitIndex = 0;
    this.winnerStarId = -1;
    this.previousLinkedStarId = -1;
    this.segmentStartTime = 0;
    this.segmentEndTime = 0;
  }

  public getStarById(id: number): StarNode | undefined {
    return this.stars.find((s) => s.id === id);
  }
}
