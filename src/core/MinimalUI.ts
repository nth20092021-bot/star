import { cosmicEventBus } from '../shared/CosmicEventBus';
import type { StarNode } from '../shared/CosmicTypes';

export interface UIControlsCallbacks {
  onStart: () => void;
  onNext: () => void;
  onReset: () => void;
  onResetHistory: () => void;
  getStars: () => StarNode[];
  getChosenWinnerIds: () => Set<number>;
}

export type UIState = 'READY' | 'WEAVING' | 'WINNER' | 'ALL_COMPLETED';

export class MinimalUI {
  private container: HTMLElement;
  private callbacks: UIControlsCallbacks;

  private btnAction!: HTMLButtonElement;
  private btnSettings!: HTMLButtonElement;
  private statusBadge!: HTMLElement;

  private settingsModal!: HTMLElement;
  private settingsCloseBtn!: HTMLButtonElement;
  private settingsResetHistoryBtn!: HTMLButtonElement;
  private studentListContainer!: HTMLElement;
  private statsSummaryEl!: HTMLElement;

  private currentState: UIState = 'READY';
  private unsubscribers: Array<() => void> = [];

  constructor(containerId: string, callbacks: UIControlsCallbacks) {
    const el = document.getElementById(containerId);
    if (!el) {
      throw new Error(`MinimalUI: Container #${containerId} not found in DOM`);
    }
    this.container = el;
    this.callbacks = callbacks;

    this.render();
    this.bindEvents();
    this.setupCosmicListeners();
    this.updateStatusBadge();
  }

  private render(): void {
    this.container.innerHTML = `
      <div style="position: absolute; inset: 0; pointer-events: none; display: flex; flex-direction: column; justify-content: space-between; padding: 20px 24px; box-sizing: border-box; font-family: 'Be Vietnam Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        
        <!-- Top Right Floating HUD (Tối giản, không chứa tên game) -->
        <header style="display: flex; justify-content: flex-end; align-items: center; gap: 12px; pointer-events: auto;">
          <!-- Quick Status Badge -->
          <div id="hud-status-badge" style="background: rgba(9, 13, 28, 0.78); backdrop-filter: blur(14px); border: 1px solid rgba(255, 209, 102, 0.3); border-radius: 24px; padding: 8px 18px; font-size: 13px; font-weight: 600; color: #ffd166; box-shadow: 0 4px 20px rgba(0,0,0,0.35); display: flex; align-items: center; gap: 8px;">
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #ffd166; box-shadow: 0 0 8px #ffd166;"></span>
            <span id="badge-text">Đã chọn: 0 / 28</span>
          </div>

          <!-- Bánh Răng Setting Button -->
          <button id="btn-settings" class="interactive" title="Xem danh sách & cài đặt" style="background: rgba(9, 13, 28, 0.78); backdrop-filter: blur(14px); border: 1px solid rgba(255, 255, 255, 0.2); width: 42px; height: 42px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 19px; cursor: pointer; color: #e6edf3; transition: all 0.25s ease; box-shadow: 0 4px 20px rgba(0,0,0,0.35); outline: none;">
            ⚙️
          </button>
        </header>

        <!-- Bottom Controls Bar (Tối giản nhất có thể) -->
        <footer style="display: flex; flex-direction: column; align-items: center; gap: 10px; pointer-events: auto; margin-bottom: 8px;">
          <!-- Nút hành động chính đa trạng thái: Bắt đầu / Đang dệt / Tiếp theo -->
          <button id="btn-action" class="interactive" style="background: linear-gradient(135deg, #ffd166, #e09f3e); color: #080a14; border: none; font-size: 16px; font-weight: 700; padding: 14px 44px; border-radius: 36px; cursor: pointer; letter-spacing: 0.6px; box-shadow: 0 6px 28px rgba(255, 209, 102, 0.45); transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1); outline: none; display: flex; align-items: center; gap: 10px;">
            <span id="btn-icon">☄️</span>
            <span id="btn-text">Bắt đầu</span>
          </button>
        </footer>

        <!-- Settings & Danh Sách Học Sinh Modal (Ẩn mặc định) -->
        <div id="settings-modal" style="position: absolute; inset: 0; background: rgba(3, 5, 14, 0.75); backdrop-filter: blur(12px); display: none; align-items: center; justify-content: center; pointer-events: auto; z-index: 100;">
          <div style="background: linear-gradient(160deg, rgba(14, 19, 38, 0.96), rgba(8, 10, 22, 0.98)); border: 1px solid rgba(255, 209, 102, 0.4); border-radius: 20px; width: 620px; max-width: 92vw; max-height: 85vh; display: flex; flex-direction: column; box-shadow: 0 16px 50px rgba(0,0,0,0.7); overflow: hidden;">
            
            <!-- Modal Header -->
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 20px;">⚙️</span>
                <h2 style="margin: 0; font-size: 17px; font-weight: 700; color: #ffd166; letter-spacing: 0.5px;">
                  Bảng Trạng Thái & Danh Sách Học Sinh
                </h2>
              </div>
              <button id="settings-close-btn" style="background: transparent; border: none; font-size: 20px; color: #8b949e; cursor: pointer; padding: 4px 8px; border-radius: 6px; transition: color 0.2s;">
                ✕
              </button>
            </div>

            <!-- Modal Summary Bar -->
            <div style="padding: 14px 24px; background: rgba(255, 255, 255, 0.03); border-bottom: 1px solid rgba(255, 255, 255, 0.08); display: flex; justify-content: space-between; align-items: center; flex-wrap: gap;">
              <div id="stats-summary" style="font-size: 13px; color: #cbd5e1; display: flex; gap: 16px;">
                <!-- Render động -->
              </div>
              <button id="settings-reset-history-btn" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.35); color: #fca5a5; font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 8px; cursor: pointer; transition: all 0.2s;">
                🔄 Đặt lại danh sách
              </button>
            </div>

            <!-- Scrollable Student List -->
            <div id="student-list-container" style="flex: 1; overflow-y: auto; padding: 16px 24px; display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px;">
              <!-- Danh sách 28 học sinh render động tại đây -->
            </div>
          </div>
        </div>

      </div>
    `;

    this.btnAction = this.container.querySelector('#btn-action') as HTMLButtonElement;
    this.btnSettings = this.container.querySelector('#btn-settings') as HTMLButtonElement;
    this.statusBadge = this.container.querySelector('#badge-text') as HTMLElement;

    this.settingsModal = this.container.querySelector('#settings-modal') as HTMLElement;
    this.settingsCloseBtn = this.container.querySelector('#settings-close-btn') as HTMLButtonElement;
    this.settingsResetHistoryBtn = this.container.querySelector('#settings-reset-history-btn') as HTMLButtonElement;
    this.studentListContainer = this.container.querySelector('#student-list-container') as HTMLElement;
    this.statsSummaryEl = this.container.querySelector('#stats-summary') as HTMLElement;
  }

  private bindEvents(): void {
    // Nút hành động chính
    this.btnAction.addEventListener('click', () => {
      if (this.currentState === 'READY') {
        this.callbacks.onStart();
      } else if (this.currentState === 'WINNER') {
        // Bấm "Tiếp theo" -> ẩn bảng vinh danh và sẵn sàng cho lượt mới
        this.callbacks.onNext();
        this.setUIState('READY');
      } else if (this.currentState === 'ALL_COMPLETED') {
        if (confirm('Tất cả 28 học sinh đã được chọn. Bạn có muốn đặt lại danh sách để bắt đầu vòng mới?')) {
          this.callbacks.onResetHistory();
          this.setUIState('READY');
        }
      }
    });

    // Mở / Đóng Settings Modal
    this.btnSettings.addEventListener('click', () => {
      this.openSettings();
    });

    this.settingsCloseBtn.addEventListener('click', () => {
      this.closeSettings();
    });

    this.settingsModal.addEventListener('click', (e) => {
      if (e.target === this.settingsModal) {
        this.closeSettings();
      }
    });

    // Đặt lại lịch sử chọn
    this.settingsResetHistoryBtn.addEventListener('click', () => {
      if (confirm('Xác nhận đặt lại danh sách? Tất cả 28 học sinh sẽ có thể được chọn lại từ đầu.')) {
        this.callbacks.onResetHistory();
        this.updateSettingsContent();
        this.updateStatusBadge();
        this.setUIState('READY');
      }
    });

    // Hover effect trên btnSettings
    this.btnSettings.addEventListener('mouseenter', () => {
      this.btnSettings.style.transform = 'rotate(30deg) scale(1.08)';
      this.btnSettings.style.borderColor = 'rgba(255, 209, 102, 0.6)';
    });
    this.btnSettings.addEventListener('mouseleave', () => {
      this.btnSettings.style.transform = 'none';
      this.btnSettings.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    });
  }

  private setupCosmicListeners(): void {
    const unsubStart = cosmicEventBus.on('WEAVE_START', () => {
      this.setUIState('WEAVING');
    });

    const unsubSupernova = cosmicEventBus.on('STAR_LOCKED_SUPERNOVA', () => {
      this.setUIState('WINNER');
      this.updateStatusBadge();
    });

    const unsubReset = cosmicEventBus.on('CAMERA_RESET', () => {
      this.setUIState('READY');
      this.updateStatusBadge();
    });

    const unsubDismiss = cosmicEventBus.on('DISMISS_PLAQUE', () => {
      this.setUIState('READY');
      this.updateStatusBadge();
    });

    this.unsubscribers.push(unsubStart, unsubSupernova, unsubReset, unsubDismiss);
  }

  public setUIState(state: UIState): void {
    this.currentState = state;
    const btnIcon = this.btnAction.querySelector('#btn-icon') as HTMLElement;
    const btnText = this.btnAction.querySelector('#btn-text') as HTMLElement;

    const remaining = this.getRemainingCount();
    if (state === 'READY' && remaining === 0) {
      this.currentState = 'ALL_COMPLETED';
      state = 'ALL_COMPLETED';
    }

    switch (state) {
      case 'READY':
        this.btnAction.disabled = false;
        this.btnAction.style.opacity = '1';
        this.btnAction.style.cursor = 'pointer';
        this.btnAction.style.background = 'linear-gradient(135deg, #ffd166, #e09f3e)';
        this.btnAction.style.boxShadow = '0 6px 28px rgba(255, 209, 102, 0.45)';
        btnIcon.textContent = '☄️';
        btnText.textContent = 'Bắt đầu';
        break;

      case 'WEAVING':
        this.btnAction.disabled = true;
        this.btnAction.style.opacity = '0.7';
        this.btnAction.style.cursor = 'not-allowed';
        this.btnAction.style.background = 'linear-gradient(135deg, #718096, #4a5568)';
        this.btnAction.style.boxShadow = 'none';
        btnIcon.textContent = '⏳';
        btnText.textContent = 'Đang dệt chòm sao...';
        break;

      case 'WINNER':
        this.btnAction.disabled = false;
        this.btnAction.style.opacity = '1';
        this.btnAction.style.cursor = 'pointer';
        // Hiệu ứng nút Tiếp theo màu xanh ngọc - vàng nổi bật
        this.btnAction.style.background = 'linear-gradient(135deg, #2dd4bf, #059669)';
        this.btnAction.style.boxShadow = '0 6px 32px rgba(45, 212, 191, 0.55)';
        btnIcon.textContent = '✨';
        btnText.textContent = 'Tiếp theo';
        break;

      case 'ALL_COMPLETED':
        this.btnAction.disabled = false;
        this.btnAction.style.opacity = '1';
        this.btnAction.style.cursor = 'pointer';
        this.btnAction.style.background = 'linear-gradient(135deg, #a855f7, #6366f1)';
        this.btnAction.style.boxShadow = '0 6px 28px rgba(168, 85, 247, 0.45)';
        btnIcon.textContent = '🎉';
        btnText.textContent = 'Đã chọn hết (Đặt lại)';
        break;
    }
  }

  private updateStatusBadge(): void {
    const chosen = this.callbacks.getChosenWinnerIds().size;
    const total = this.callbacks.getStars().length || 28;
    this.statusBadge.textContent = `Đã chọn: ${chosen} / ${total}`;
  }

  private getRemainingCount(): number {
    const chosen = this.callbacks.getChosenWinnerIds().size;
    const total = this.callbacks.getStars().length || 28;
    return total - chosen;
  }

  private openSettings(): void {
    this.updateSettingsContent();
    this.settingsModal.style.display = 'flex';
  }

  private closeSettings(): void {
    this.settingsModal.style.display = 'none';
  }

  private updateSettingsContent(): void {
    const stars = this.callbacks.getStars();
    const chosenIds = this.callbacks.getChosenWinnerIds();
    const total = stars.length;
    const chosenCount = chosenIds.size;
    const remainingCount = total - chosenCount;

    // Cập nhật summary
    this.statsSummaryEl.innerHTML = `
      <span>Tổng số: <strong style="color: #ffd166;">${total}</strong></span>
      <span>Đã vinh danh: <strong style="color: #38ef7d;">${chosenCount}</strong></span>
      <span>Còn lại: <strong style="color: #60a5fa;">${remainingCount}</strong></span>
    `;

    // Cập nhật danh sách 28 học sinh
    let html = '';
    for (const star of stars) {
      const isChosen = chosenIds.has(star.id);
      const bg = isChosen ? 'rgba(34, 197, 94, 0.12)' : 'rgba(255, 255, 255, 0.04)';
      const border = isChosen ? 'rgba(34, 197, 94, 0.4)' : 'rgba(255, 255, 255, 0.08)';
      const badgeText = isChosen ? '✅ Đã vinh danh' : '⏳ Chưa chọn';
      const badgeColor = isChosen ? '#86efac' : '#94a3b8';

      html += `
        <div style="background: ${bg}; border: 1px solid ${border}; border-radius: 10px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 11px; color: #64748b; font-weight: 700; width: 22px;">#${star.id < 10 ? '0' + star.id : star.id}</span>
            <span style="font-size: 13px; font-weight: 600; color: ${isChosen ? '#f0fdf4' : '#e2e8f0'};">${star.studentName}</span>
          </div>
          <span style="font-size: 11px; font-weight: 600; color: ${badgeColor};">${badgeText}</span>
        </div>
      `;
    }
    this.studentListContainer.innerHTML = html;
  }

  public dispose(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }
}
