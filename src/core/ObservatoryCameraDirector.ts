import * as THREE from 'three';
import { cosmicEventBus } from '../shared/CosmicEventBus';
import type { StarNode, CometPhysicsState } from '../shared/CosmicTypes';

export type CameraMode = 'IDLE' | 'TRACKING_COMET' | 'SUPERNOVA_FOCUS';

export class ObservatoryCameraDirector {
  private mode: CameraMode = 'IDLE';
  private targetPosition = new THREE.Vector3(0, 13, 56);
  private lookTarget = new THREE.Vector3(0, 0.4, 0);
  private focusStar: StarNode | null = null;
  private unsubscribers: Array<() => void> = [];

  constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    const unsubWeaveStart = cosmicEventBus.on('WEAVE_START', () => {
      this.mode = 'TRACKING_COMET';
      this.focusStar = null;
    });

    const unsubSupernova = cosmicEventBus.on('STAR_LOCKED_SUPERNOVA', ({ winnerStar }) => {
      this.mode = 'SUPERNOVA_FOCUS';
      this.focusStar = winnerStar;
    });

    const unsubReset = cosmicEventBus.on('CAMERA_RESET', () => {
      this.mode = 'IDLE';
      this.focusStar = null;
      this.targetPosition.set(0, 13, 56);
      this.lookTarget.set(0, 0.4, 0);
    });

    this.unsubscribers.push(unsubWeaveStart, unsubSupernova, unsubReset);
  }

  public getMode(): CameraMode {
    return this.mode;
  }

  public getTargetPosition(): THREE.Vector3 {
    return this.targetPosition;
  }

  public getLookTarget(): THREE.Vector3 {
    return this.lookTarget;
  }

  public update(_dt: number, _comet: CometPhysicsState): void {
    // Director calculates camera intent vectors based on current mode
    if (this.mode === 'SUPERNOVA_FOCUS' && this.focusStar) {
      const pos = this.focusStar.currentPosition;
      this.lookTarget.lerp(pos, 0.08);
    } else if (this.mode === 'IDLE') {
      this.lookTarget.set(0, 0.4, 0);
    }
  }

  public dispose(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }
}

