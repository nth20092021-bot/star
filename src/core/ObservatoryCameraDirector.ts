import * as THREE from 'three';
import { cosmicEventBus } from '../shared/CosmicEventBus';
import type { CometPhysicsState } from '../shared/CosmicTypes';

export type CameraMode = 'IDLE' | 'TRACKING_COMET' | 'SUPERNOVA_FOCUS';
export type CinematicAct = 0 | 1 | 2 | 3 | 4;

const ACT1_END = 2.0;
const ACT2_END = 7.5;

const BASE_CAMERA_POSITION = new THREE.Vector3(0, 13, 56);
const BASE_LOOK_TARGET = new THREE.Vector3(0, 0.4, 0);
const ORB_CENTER = new THREE.Vector3(0, -1, 0);
const DIVE_END_POSITION = new THREE.Vector3(0, 2.6, 10.4);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_SIDE = new THREE.Vector3(0, 0, 1);
const CAMERA_FORWARD_AXIS = new THREE.Vector3(0, 0, 1);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(1e-5, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

/**
 * 🎥 ObservatoryCameraDirector — Antigravity (/src/core)
 *
 * Nhạc trưởng của toàn bộ Kịch bản Điện ảnh 12 giây:
 * - Act 1 (0 → 2s): lao qua các vòng đồng, FOV 50 → 68.
 * - Act 2 (2 → 7.5s): bám đuôi sao chổi, offset 8–14, nghiêng cánh khi vào cua,
 *   lookAt = comet.position + comet.velocity * 0.4 (giới hạn an toàn).
 * - Act 3 (7.5 → 10.5s): FOV co còn 45, quỹ đạo camera bao quanh cụm 3 sao cuối,
 *   ghìm lại ở ngôi áp chót rồi lao dứt điểm.
 * - Act 4 (10.5 → 12s): khóa ngôi sao, dolly-out, rung nhẹ 0.25s quanh vụ nổ.
 *
 * Mọi chuyển động đều đi qua Vector3.lerp / Quaternion.slerp có damping theo dt,
 * nên không bao giờ giật hình khi tia sáng đổi hướng đột ngột.
 *
 * Lớp đồ họa (/src/graphics) đọc tư thế camera qua `ObservatoryCameraDirector.active`
 * để áp dụng chính xác mà không cần sửa /src/main.ts hay hợp đồng shared.
 */
export class ObservatoryCameraDirector {
  /** Instance đang hoạt động — cầu nối camera sang lớp đồ họa. */
  public static active: ObservatoryCameraDirector | null = null;

  private mode: CameraMode = 'IDLE';
  private act: CinematicAct = 0;
  private cinematicActive = false;
  private cinematicTime = 0;
  private cinematicStartedAt = 0;
  private lastUpdateWall = performance.now();
  private lockTime = 0;
  private idleTime = 0;
  private fov = 50;

  private readonly posePosition = BASE_CAMERA_POSITION.clone();
  private readonly poseQuaternion = new THREE.Quaternion();
  private readonly desiredPosition = new THREE.Vector3().copy(BASE_CAMERA_POSITION);
  private readonly desiredLookTarget = new THREE.Vector3().copy(BASE_LOOK_TARGET);
  private readonly desiredQuaternion = new THREE.Quaternion();

  private readonly diveStartPosition = new THREE.Vector3().copy(BASE_CAMERA_POSITION);
  private readonly winnerPosition = new THREE.Vector3();
  private readonly finaleViewDir = new THREE.Vector3(0, 0.35, 1);
  private readonly linkedPositions: THREE.Vector3[] = [];

  private readonly lastCometDirection = new THREE.Vector3(0, 0, -1);
  private readonly previousCometDirection = new THREE.Vector3(0, 0, -1);
  private bank = 0;

  // Làm mềm quỹ đạo camera: mục tiêu ngắm, tâm orbit và trục up đều có
  // quán tính riêng để camera không giật khi tia sáng đổi hướng tại mỗi sao.
  private readonly smoothedLookTarget = new THREE.Vector3().copy(BASE_LOOK_TARGET);
  private readonly smoothedOrbitFocus = new THREE.Vector3();
  private orbitFocusReady = false;
  private orbitAngleReady = false;
  private orbitAngleBase = 0.4;
  private readonly currentUp = new THREE.Vector3().copy(WORLD_UP);
  private currentRoll = 0;
  private lookLambda = 1.2;
  private rotationSpeedCap = 0.9;

  private readonly unsubscribers: Array<() => void> = [];

  private readonly tmpDirection = new THREE.Vector3();
  private readonly tmpSide = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private readonly tmpLook = new THREE.Vector3();
  private readonly tmpFocus = new THREE.Vector3();
  private readonly tmpAnchor = new THREE.Vector3();
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpRoll = new THREE.Quaternion();
  private readonly shakeOffset = new THREE.Vector3();

  constructor() {
    this.tmpMatrix.lookAt(BASE_CAMERA_POSITION, BASE_LOOK_TARGET, WORLD_UP);
    this.poseQuaternion.setFromRotationMatrix(this.tmpMatrix);
    this.desiredQuaternion.copy(this.poseQuaternion);
    ObservatoryCameraDirector.active = this;
    this.setupEventListeners();
  }

  /* ================================================================== */
  /* Sự kiện kịch bản                                                   */
  /* ================================================================== */

  private setupEventListeners(): void {
    const unsubWeaveStart = cosmicEventBus.on('WEAVE_START', () => {
      this.beginCinematic();
    });

    const unsubLinked = cosmicEventBus.on('STAR_LINKED', ({ position }) => {
      this.linkedPositions.unshift(position.clone());
      if (this.linkedPositions.length > 4) {
        this.linkedPositions.length = 4;
      }
    });

    const unsubSupernova = cosmicEventBus.on('STAR_LOCKED_SUPERNOVA', ({ winnerStar, position }) => {
      this.mode = 'SUPERNOVA_FOCUS';
      this.act = 4;
      this.winnerPosition.copy(position);
      this.cinematicTime = Math.max(
        0,
        (performance.now() - this.cinematicStartedAt) / 1000
      );
      this.lockTime = this.cinematicTime;

      // Xác định hướng nhìn tự nhiên từ camera về ngôi sao chiến thắng để không giật góc
      this.finaleViewDir.subVectors(this.posePosition, this.winnerPosition);
      if (this.finaleViewDir.lengthSq() < 1e-4) {
        this.finaleViewDir.set(0, 0.35, 1);
      }
      this.finaleViewDir.normalize();
      // Nâng nhẹ cao độ để nhìn bao quát ngôi sao nổ (không bị chúi góc từ dưới lên)
      this.finaleViewDir.y = Math.max(0.18, Math.min(0.45, this.finaleViewDir.y));
      this.finaleViewDir.normalize();

      // Khóa tức thì mục tiêu ngắm và hướng nhìn chính xác vào tâm ngôi sao nổ
      this.desiredLookTarget.copy(this.winnerPosition);
      this.smoothedLookTarget.copy(this.winnerPosition);
      this.tmpMatrix.lookAt(this.posePosition, this.winnerPosition, WORLD_UP);
      this.poseQuaternion.setFromRotationMatrix(this.tmpMatrix);
      this.desiredQuaternion.copy(this.poseQuaternion);

      this.linkedPositions.unshift(winnerStar.currentPosition.clone());
      if (this.linkedPositions.length > 4) {
        this.linkedPositions.length = 4;
      }
    });

    const unsubReset = cosmicEventBus.on('CAMERA_RESET', () => {
      this.cinematicActive = false;
      this.cinematicTime = 0;
      this.lockTime = 0;
      this.act = 0;
      this.mode = 'IDLE';
      this.linkedPositions.length = 0;
      this.bank = 0;
      this.orbitFocusReady = false;
      this.orbitAngleReady = false;
      this.currentRoll = 0;
    });

    this.unsubscribers.push(unsubWeaveStart, unsubLinked, unsubSupernova, unsubReset);
  }

  private beginCinematic(): void {
    this.cinematicActive = true;
    this.cinematicTime = 0;
    this.cinematicStartedAt = performance.now();
    this.lastUpdateWall = performance.now();
    this.lockTime = 0;
    this.act = 1;
    this.mode = 'TRACKING_COMET';
    this.diveStartPosition.copy(this.posePosition);
    this.linkedPositions.length = 0;
    this.bank = 0;
    this.orbitFocusReady = false;
    this.orbitAngleReady = false;
    this.currentUp.copy(WORLD_UP);
    this.currentRoll = 0;
    this.smoothedLookTarget.copy(BASE_LOOK_TARGET);
    this.lastCometDirection.set(0, -0.15, -1).normalize();
    this.previousCometDirection.copy(this.lastCometDirection);
  }

  /* ================================================================== */
  /* Cập nhật mỗi frame                                                 */
  /* ================================================================== */

  public update(_dt: number, comet: CometPhysicsState): void {
    const now = performance.now();
    const wallDt = Math.min(
      0.12,
      Math.max(1e-4, (now - this.lastUpdateWall) / 1000)
    );
    this.lastUpdateWall = now;

    if (!this.cinematicActive) {
      this.idleTime += wallDt;
      this.updateIdle(wallDt);
      return;
    }

    // Đồng hồ thực: camera luôn đi đúng nhịp 12 giây bất kể FPS.
    this.cinematicTime = Math.max(
      0,
      (now - this.cinematicStartedAt) / 1000
    );

    if (this.mode === 'SUPERNOVA_FOCUS') {
      this.act = 4;
      this.updateFinale(wallDt);
      return;
    }

    if (this.cinematicTime < ACT1_END) {
      this.act = 1;
      this.updateAwakening(wallDt);
    } else if (this.cinematicTime < ACT2_END) {
      this.act = 2;
      this.updateChase(wallDt, comet);
    } else {
      // Giữ bám đuôi sao chổi cho tới khi nhận sự kiện khóa mục tiêu Supernova thực sự
      this.act = 3;
      this.updateSlowMotionArc(wallDt, comet);
    }
  }

  /* -------------------------- IDLE ---------------------------------- */

  private updateIdle(dt: number): void {
    const t = this.idleTime;
    const azimuth = Math.sin(t * 0.045) * 0.26 + Math.sin(t * 0.013 + 1.7) * 0.12;
    const radius = 56 + Math.sin(t * 0.06 + 0.4) * 2.2;
    const height = 13 + Math.sin(t * 0.055 + 2.0) * 2.1;

    this.desiredPosition.set(
      Math.sin(azimuth) * radius,
      height,
      Math.cos(azimuth) * radius
    );
    this.desiredLookTarget.copy(BASE_LOOK_TARGET);
    this.currentUp.copy(WORLD_UP);
    this.currentRoll = 0;
    this.lookLambda = 1.2;
    this.rotationSpeedCap = 0.9;
    this.smoothPose(dt, 0.55, 0.85, 50, 0.6);
  }

  /* ----------------------- ACT 1: AWAKENING ------------------------- */

  private updateAwakening(dt: number): void {
    const t = clamp01(this.cinematicTime / ACT1_END);
    const dive = easeInOutCubic(clamp01((this.cinematicTime - 0.55) / 1.45));
    const arc = Math.sin(Math.PI * dive);

    this.desiredPosition.lerpVectors(this.diveStartPosition, DIVE_END_POSITION, dive);
    this.desiredPosition.x += arc * 1.4;
    this.desiredPosition.y += arc * 1.6;

    this.desiredLookTarget.lerpVectors(BASE_LOOK_TARGET, ORB_CENTER, dive);
    this.currentUp.copy(WORLD_UP);
    this.currentRoll = 0;
    this.lookLambda = 4.5;
    this.rotationSpeedCap = 1.8;

    const fovTarget = 50 + 18 * easeInOutCubic(t);
    this.smoothPose(dt, 3.4, 4.2, fovTarget, 2.4);
  }

  /* --------------------- ACT 2: CONSTELLATION CHASE ----------------- */

  private updateChase(dt: number, comet: CometPhysicsState): void {
    this.tmpDirection.copy(comet.velocity);
    if (this.tmpDirection.lengthSq() > 1e-5) {
      this.tmpDirection.normalize();
    } else {
      this.tmpDirection.copy(this.lastCometDirection);
    }

    this.previousCometDirection.copy(this.lastCometDirection);
    // Hướng offset xoay rất chậm: khi tia sáng đảo hướng, camera không quay
    // vòng quanh nó ngay mà trượt theo, nhờ đó ống kính không bị "văng".
    this.lastCometDirection
      .lerp(this.tmpDirection, 1 - Math.exp(-dt * 2.8))
      .normalize();

    this.applyChaseFrame(dt, comet, 68);
  }

  private applyChaseFrame(dt: number, comet: CometPhysicsState, baseFov: number): void {
    const direction = this.lastCometDirection;
    const time = this.cinematicTime;
    const speed = Math.min(1, Math.max(0, comet.speedNormalized));

    this.resolveUp(direction, this.tmpUp);
    this.tmpSide.crossVectors(direction, this.tmpUp);
    if (this.tmpSide.lengthSq() < 1e-5) {
      this.tmpSide.set(1, 0, 0);
    } else {
      this.tmpSide.normalize();
    }

    const chaseDistance = 12.0 + Math.sin(time * 1.35) * 1.6;
    const lateral = Math.sin(time * 0.85 + 0.7) * 1.8;
    const height = 0.9 + Math.cos(time * 1.1) * 0.5;

    this.desiredPosition
      .copy(comet.position)
      .addScaledVector(direction, -chaseDistance)
      .addScaledVector(this.tmpSide, lateral)
      .addScaledVector(this.tmpUp, height);

    // Nhìn trước một khoảng NGẮN cố định (1.8 đơn vị) thay vì lead theo vận
    // tốc: ở tốc độ cao, lead dài sẽ đẩy chính sao chổi ra khỏi khung hình.
    this.tmpLook.copy(direction).multiplyScalar(1.8);
    this.desiredLookTarget.copy(comet.position).add(this.tmpLook);
    this.desiredLookTarget.y += 0.5;

    // Nghiêng cánh khi vào cua (banking/roll) dựa trên đạo hàm hướng bay.
    this.tmpDirection.copy(direction).sub(this.previousCometDirection);
    const turn = this.tmpSide.dot(this.tmpDirection);
    const bankTarget = Math.max(
      -0.16,
      Math.min(0.16, turn * 4.0 + Math.sin(time * 0.9) * 0.025)
    );
    this.bank += (bankTarget - this.bank) * (1 - Math.exp(-dt * 3.0));

    // Camera ngắm từ vị trí thực tế tới mục tiêu đã làm mềm; orientation
    // được slerp có giới hạn tốc độ góc để không bao giờ "văng" theo sao.
    // Các gain cao giữ sao chổi trong khung, còn mềm mại đến từ damping
    // hướng bay + look target + trần tốc độ góc, không phải từ độ trễ lớn.
    this.currentUp.copy(this.tmpUp);
    this.currentRoll = this.bank;
    this.lookLambda = 9.0;
    this.rotationSpeedCap = 5.0;

    const fovTarget = baseFov + Math.sin(time * 0.7) * 1.4 + (speed - 0.65) * 2.6;
    this.smoothPose(dt, 8.5, 5.0, fovTarget, 3.2);
  }

  /* ----------------------- ACT 3: SLOW-MO ARC ----------------------- */

  private updateSlowMotionArc(dt: number, comet: CometPhysicsState): void {
    const time = this.cinematicTime;
    const dash = smoothstep(9.15, 10.35, time);

    this.tmpFocus.set(0, 0, 0);
    let count = 0;
    const recent = Math.min(3, this.linkedPositions.length);
    for (let i = 0; i < recent; i += 1) {
      this.tmpFocus.add(this.linkedPositions[i]);
      count += 1;
    }
    if (count > 0) {
      this.tmpFocus.divideScalar(count);
      this.tmpFocus.lerp(comet.position, 0.5);
    } else {
      this.tmpFocus.copy(comet.position);
    }

    // Tâm cụm 3 sao cuối có quán tính riêng, chỉ dùng làm điểm tựa thị giác.
    if (!this.orbitFocusReady) {
      this.smoothedOrbitFocus.copy(this.tmpFocus);
      this.orbitFocusReady = true;
    } else {
      this.smoothedOrbitFocus.lerp(this.tmpFocus, 1 - Math.exp(-dt * 3.2));
    }

    // Tâm orbit neo vào chính sao chổi (chỉ nghiêng 18% về cụm sao), nhờ đó
    // camera không bỏ rơi chủ thể khi cụm sao nằm cao hơn quỹ đạo lao xuống.
    this.tmpAnchor.copy(comet.position).lerp(this.smoothedOrbitFocus, 0.18);

    // Bắt đầu orbit đúng từ phương vị camera hiện tại để cú chuyển Act 2 → 3
    // không quét ngang đột ngột quanh sao chổi.
    if (!this.orbitAngleReady) {
      const offsetX = this.posePosition.x - this.tmpAnchor.x;
      const offsetZ = this.posePosition.z - this.tmpAnchor.z;
      if (offsetX * offsetX + offsetZ * offsetZ > 1e-4) {
        this.orbitAngleBase =
          Math.atan2(offsetZ, offsetX) - (time - ACT2_END) * 0.62;
      }
      this.orbitAngleReady = true;
    }

    const orbitAngle = this.orbitAngleBase + (time - ACT2_END) * 0.62;
    // Lùi nhẹ trong cú lao cuối giúp giảm tốc độ góc cần thiết và giữ
    // sao chổi trọn vẹn trong khung hình.
    const radius = 13.5 + 4.0 * dash;
    const height = 2.4 + 1.0 * dash;

    this.desiredPosition.set(
      this.tmpAnchor.x + Math.cos(orbitAngle) * radius,
      this.tmpAnchor.y + height,
      this.tmpAnchor.z + Math.sin(orbitAngle) * radius
    );

    // Ống kính bám sao chổi với lead ngắn, giữ nó gần tâm khung hình.
    this.desiredLookTarget
      .copy(comet.position)
      .addScaledVector(this.lastCometDirection, 2.4 + dash * 1.2);
    this.desiredLookTarget.y += 0.7;

    // Nhả roll từ từ để đường chân trời ổn định khi vào slow-mo.
    this.bank *= Math.exp(-dt * 2.0);
    this.resolveUp(this.lastCometDirection, this.tmpUp);
    this.currentUp.copy(this.tmpUp);
    this.currentRoll = this.bank * 0.3;
    this.lookLambda = 9.5;
    this.rotationSpeedCap = 4.0;

    // FOV khép về 50 thay vì 45 để cú lao cuối vẫn giữ trọn sao chổi.
    const fovTarget = 68 - 18 * smoothstep(ACT2_END, 8.9, time);
    this.smoothPose(dt, 6.5 + dash * 2.5, 6.0, fovTarget, 2.4);
  }

  /* --------------------- ACT 4: SUPERNOVA REVEAL -------------------- */

  private updateFinale(dt: number): void {
    if (this.winnerPosition.lengthSq() < 1e-6) {
      this.winnerPosition.copy(ORB_CENTER);
    }

    const t4 = Math.max(0, this.cinematicTime - this.lockTime);
    const dolly = easeOutCubic(clamp01(t4 / 2.0));
    // Khoảng cách lùi nhẹ từ 14 lên 22 để ngôi sao và vụ nổ Supernova luôn ở chính giữa khung hình
    const distance = 14.0 + 8.0 * dolly;

    this.desiredPosition.copy(this.winnerPosition).addScaledVector(this.finaleViewDir, distance);
    this.desiredPosition.y = Math.max(3.0, this.desiredPosition.y);
    this.desiredLookTarget.copy(this.winnerPosition);
    this.currentUp.copy(WORLD_UP);
    this.currentRoll = 0;
    this.lookLambda = 20.0;
    this.rotationSpeedCap = 12.0;

    const fovTarget = 46 + 6 * dolly;
    this.smoothPose(dt, 4.5, 7.0, fovTarget, 2.5);

    // Rung máy đúng 0.25s quanh thời điểm vụ nổ bung ra (lock + 0.5s).
    if (t4 > 0.5 && t4 < 0.75) {
      const strength = 1 - smoothstep(0.5, 0.75, t4);
      const amplitude = 0.45 * strength;
      this.shakeOffset.set(
        Math.sin(t4 * 97.0) * amplitude,
        Math.sin(t4 * 131.0 + 1.3) * amplitude * 0.8,
        Math.sin(t4 * 83.0 + 2.1) * amplitude * 0.55
      );
      this.posePosition.add(this.shakeOffset);
    }
  }

  /* ================================================================== */
  /* Toán học tư thế                                                    */
  /* ================================================================== */

  private resolveUp(direction: THREE.Vector3, out: THREE.Vector3): void {
    out.copy(WORLD_UP).addScaledVector(direction, -direction.dot(WORLD_UP));
    if (out.lengthSq() < 1e-4) {
      out.copy(WORLD_SIDE).addScaledVector(direction, -direction.dot(WORLD_SIDE));
    }
    out.normalize();
  }

  private smoothPose(
    dt: number,
    positionLambda: number,
    rotationLambda: number,
    fovTarget: number,
    fovLambda: number
  ): void {
    const positionAlpha = 1 - Math.exp(-positionLambda * dt);
    this.posePosition.lerp(this.desiredPosition, positionAlpha);

    // Mục tiêu ngắm có quán tính riêng: kể cả khi tia sáng đổi hướng gắt,
    // ống kính vẫn trượt theo một cung mềm thay vì bật sang hướng mới.
    const lookAlpha = 1 - Math.exp(-this.lookLambda * dt);
    this.smoothedLookTarget.lerp(this.desiredLookTarget, lookAlpha);

    // Tính orientation từ vị trí camera thực tế (đã damping) tới mục tiêu
    // đã làm mềm, sau đó giới hạn tốc độ góc để tránh cú văng cục bộ.
    this.tmpMatrix.lookAt(this.posePosition, this.smoothedLookTarget, this.currentUp);
    this.desiredQuaternion.setFromRotationMatrix(this.tmpMatrix);
    if (Math.abs(this.currentRoll) > 1e-4) {
      this.tmpRoll.setFromAxisAngle(CAMERA_FORWARD_AXIS, this.currentRoll);
      this.desiredQuaternion.multiply(this.tmpRoll);
    }

    const baseRotationAlpha = 1 - Math.exp(-rotationLambda * dt);
    const angle = this.poseQuaternion.angleTo(this.desiredQuaternion);
    const cappedAlpha =
      angle > 1e-5 ? (this.rotationSpeedCap * dt) / angle : baseRotationAlpha;
    this.poseQuaternion.slerp(
      this.desiredQuaternion,
      Math.min(baseRotationAlpha, cappedAlpha)
    );

    const fovAlpha = 1 - Math.exp(-fovLambda * dt);
    this.fov += (fovTarget - this.fov) * fovAlpha;
  }

  /* ================================================================== */
  /* API công khai                                                      */
  /* ================================================================== */

  public getMode(): CameraMode {
    return this.mode;
  }

  public getAct(): CinematicAct {
    return this.act;
  }

  public isCinematicActive(): boolean {
    return this.cinematicActive;
  }

  public getCinematicTime(): number {
    return this.cinematicTime;
  }

  /** Tư thế camera đã qua damping — lớp đồ họa sao chép trực tiếp. */
  public getCameraPosition(): THREE.Vector3 {
    return this.posePosition;
  }

  public getCameraQuaternion(): THREE.Quaternion {
    return this.poseQuaternion;
  }

  public getFov(): number {
    return this.fov;
  }

  public getTargetPosition(): THREE.Vector3 {
    return this.desiredPosition;
  }

  public getLookTarget(): THREE.Vector3 {
    return this.desiredLookTarget;
  }

  public dispose(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers.length = 0;

    if (ObservatoryCameraDirector.active === this) {
      ObservatoryCameraDirector.active = null;
    }
  }
}
