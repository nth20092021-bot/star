import type {
  StarLinkedPayload,
  CometStepPayload,
  WeaveStartPayload,
  SupernovaPayload
} from './CosmicTypes';

/**
 * Bản đồ ánh xạ toàn bộ các sự kiện giữa Antigravity (/src/core) và DeepSeek (/src/graphics)
 */
export interface CosmicEventMap {
  /**
   * Bắt đầu phóng sao chổi dệt chòm sao
   */
  WEAVE_START: WeaveStartPayload;

  /**
   * Cập nhật mỗi frame: vị trí sao chổi, đuôi sao chổi, và danh sách cạnh chòm sao đang sáng
   */
  COMET_STEP: CometStepPayload;

  /**
   * Khi sao chổi vừa chạm vào một ngôi sao mới trên quỹ đạo
   */
  STAR_LINKED: StarLinkedPayload;

  /**
   * Khi sao chổi dừng hẳn và khóa chặt vào ngôi sao định mệnh cuối cùng -> Kích hoạt Supernova
   */
  STAR_LOCKED_SUPERNOVA: SupernovaPayload;

  /**
   * Đưa góc quay camera và đài thiên văn về trạng thái quan sát tĩnh ban đầu
   */
  CAMERA_RESET: { immediate?: boolean; duration?: number };
}

export type CosmicEventListener<T> = (payload: T) => void;

/**
 * Hệ thống Typed Event Emitter an toàn kiểu dữ liệu, đóng vai trò cầu nối thông tin
 * không phụ thuộc (decoupled) giữa bộ tính toán Vật lý và bộ render Đồ họa Three.js.
 */
export class CosmicEventBus {
  private listeners: {
    [E in keyof CosmicEventMap]?: Set<CosmicEventListener<CosmicEventMap[E]>>;
  } = {};

  /**
   * Đăng ký lắng nghe sự kiện
   * @returns Hàm hủy đăng ký (unsubscribe) tiện lợi
   */
  public on<E extends keyof CosmicEventMap>(
    event: E,
    handler: CosmicEventListener<CosmicEventMap[E]>
  ): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = new Set() as any;
    }
    const set = this.listeners[event] as Set<CosmicEventListener<CosmicEventMap[E]>>;
    set.add(handler);

    return () => {
      this.off(event, handler);
    };
  }

  /**
   * Hủy đăng ký lắng nghe sự kiện
   */
  public off<E extends keyof CosmicEventMap>(
    event: E,
    handler: CosmicEventListener<CosmicEventMap[E]>
  ): void {
    const set = this.listeners[event] as Set<CosmicEventListener<CosmicEventMap[E]>> | undefined;
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        delete this.listeners[event];
      }
    }
  }

  /**
   * Lắng nghe sự kiện duy nhất một lần
   */
  public once<E extends keyof CosmicEventMap>(
    event: E,
    handler: CosmicEventListener<CosmicEventMap[E]>
  ): () => void {
    const wrapper: CosmicEventListener<CosmicEventMap[E]> = (payload) => {
      this.off(event, wrapper);
      handler(payload);
    };
    return this.on(event, wrapper);
  }

  /**
   * Phát tín hiệu sự kiện kèm dữ liệu payload
   */
  public emit<E extends keyof CosmicEventMap>(
    event: E,
    payload: CosmicEventMap[E]
  ): void {
    const set = this.listeners[event] as Set<CosmicEventListener<CosmicEventMap[E]>> | undefined;
    if (set && set.size > 0) {
      // Sao chép Set để tránh lỗi concurrent modification nếu listener tự hủy trong callback
      const copy = Array.from(set);
      for (let i = 0; i < copy.length; i++) {
        try {
          copy[i](payload);
        } catch (err) {
          console.error(`[CosmicEventBus] Error in listener for event "${String(event)}":`, err);
        }
      }
    }
  }

  /**
   * Xóa tất cả listener của một sự kiện hoặc toàn bộ bus
   */
  public clear<E extends keyof CosmicEventMap>(event?: E): void {
    if (event) {
      delete this.listeners[event];
    } else {
      this.listeners = {};
    }
  }
}

/**
 * Singleton instance dùng chung toàn dự án
 */
export const cosmicEventBus = new CosmicEventBus();
