import { cosmicEventBus } from '../shared/CosmicEventBus';

export interface UIControlsCallbacks {
  onStart: () => void;
  onReset: () => void;
}

export class MinimalUI {
  private container: HTMLElement;
  private callbacks: UIControlsCallbacks;
  private btnStart!: HTMLButtonElement;
  private btnReset!: HTMLButtonElement;
  private statusText!: HTMLElement;
  private starCounter!: HTMLElement;
  private speedBarFill!: HTMLElement;
  private speedLabel!: HTMLElement;

  private visitedCount = 0;
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
  }

  private render(): void {
    this.container.innerHTML = `
      <div style="position: absolute; inset: 0; pointer-events: none; display: flex; flex-direction: column; justify-content: space-between; padding: 24px 32px; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <!-- Top Header HUD -->
        <header style="display: flex; justify-content: space-between; align-items: flex-start; pointer-events: auto;">
          <div style="background: rgba(8, 12, 28, 0.72); backdrop-filter: blur(12px); border: 1px solid rgba(198, 168, 105, 0.35); border-radius: 12px; padding: 14px 22px; box-shadow: 0 8px 32px rgba(0,0,0,0.4);">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 20px;">🌌</span>
              <h1 style="margin: 0; font-size: 19px; font-weight: 700; color: #f5eedc; letter-spacing: 1.2px; text-transform: uppercase;">
                Đài Thiên Văn Dệt Chòm Sao
              </h1>
            </div>
            <p style="margin: 4px 0 0 30px; font-size: 12px; color: #a2b4d2; letter-spacing: 0.5px;">
              The Celestial Constellation Weaver • Hệ Thống 28 Vì Tinh Tú
            </p>
          </div>

          <!-- Status / Star Stats Badge -->
          <div style="background: rgba(8, 12, 28, 0.75); backdrop-filter: blur(12px); border: 1px solid rgba(88, 166, 255, 0.35); border-radius: 12px; padding: 12px 20px; text-align: right; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
            <div style="font-size: 11px; text-transform: uppercase; color: #7ee787; font-weight: 600; letter-spacing: 1px;" id="hud-status">
              ● Sẵn sàng dệt chòm sao
            </div>
            <div style="margin-top: 4px; font-size: 14px; font-weight: 600; color: #e6edf3;" id="hud-counter">
              Sao đã kết nối: <span style="color: #ffd166;">0</span> / 28
            </div>
          </div>
        </header>

        <!-- Bottom Controls Bar -->
        <footer style="display: flex; flex-direction: column; align-items: center; gap: 14px; pointer-events: auto;">
          <!-- Speed Gauge & Progress -->
          <div style="width: 380px; max-width: 90vw; background: rgba(8, 12, 28, 0.75); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 10px; padding: 10px 18px; box-sizing: border-box;">
            <div style="display: flex; justify-content: space-between; font-size: 11px; color: #8b949e; margin-bottom: 6px;">
              <span id="speed-label">Tốc độ Sao Chổi: 0%</span>
              <span>Động lực học quỹ đạo</span>
            </div>
            <div style="width: 100%; height: 6px; background: rgba(255, 255, 255, 0.1); border-radius: 3px; overflow: hidden;">
              <div id="speed-bar-fill" style="width: 0%; height: 100%; background: linear-gradient(90deg, #38ef7d, #11998e, #ffd166); border-radius: 3px; transition: width 0.1s linear;"></div>
            </div>
          </div>

          <!-- Buttons Action Row -->
          <div style="display: flex; gap: 16px;">
            <button id="btn-start" class="interactive" style="background: linear-gradient(135deg, #ffd166, #e09f3e); color: #080a14; border: none; font-size: 15px; font-weight: 700; padding: 12px 34px; border-radius: 30px; cursor: pointer; letter-spacing: 0.8px; box-shadow: 0 4px 20px rgba(255, 209, 102, 0.4); transition: all 0.25s ease; outline: none; display: flex; align-items: center; gap: 8px;">
              <span>☄️</span> Bắt đầu
            </button>
            <button id="btn-reset" class="interactive" style="background: rgba(22, 27, 46, 0.85); color: #c9d1d9; border: 1px solid rgba(255, 255, 255, 0.18); font-size: 14px; font-weight: 600; padding: 12px 24px; border-radius: 30px; cursor: pointer; letter-spacing: 0.5px; transition: all 0.25s ease; outline: none;">
              Đặt lại
            </button>
          </div>
        </footer>
      </div>
    `;

    this.btnStart = this.container.querySelector('#btn-start') as HTMLButtonElement;
    this.btnReset = this.container.querySelector('#btn-reset') as HTMLButtonElement;
    this.statusText = this.container.querySelector('#hud-status') as HTMLElement;
    this.starCounter = this.container.querySelector('#hud-counter') as HTMLElement;
    this.speedBarFill = this.container.querySelector('#speed-bar-fill') as HTMLElement;
    this.speedLabel = this.container.querySelector('#speed-label') as HTMLElement;
  }

  private bindEvents(): void {
    this.btnStart.addEventListener('click', () => {
      this.callbacks.onStart();
    });

    this.btnReset.addEventListener('click', () => {
      this.callbacks.onReset();
    });

    // Hover effects
    this.btnStart.addEventListener('mouseenter', () => {
      if (!this.btnStart.disabled) {
        this.btnStart.style.transform = 'translateY(-2px) scale(1.02)';
        this.btnStart.style.boxShadow = '0 6px 26px rgba(255, 209, 102, 0.6)';
      }
    });
    this.btnStart.addEventListener('mouseleave', () => {
      this.btnStart.style.transform = 'none';
      this.btnStart.style.boxShadow = '0 4px 20px rgba(255, 209, 102, 0.4)';
    });

    this.btnReset.addEventListener('mouseenter', () => {
      this.btnReset.style.background = 'rgba(38, 45, 72, 0.9)';
      this.btnReset.style.borderColor = 'rgba(255, 255, 255, 0.35)';
    });
    this.btnReset.addEventListener('mouseleave', () => {
      this.btnReset.style.background = 'rgba(22, 27, 46, 0.85)';
      this.btnReset.style.borderColor = 'rgba(255, 255, 255, 0.18)';
    });
  }

  private setupCosmicListeners(): void {
    const unsubStart = cosmicEventBus.on('WEAVE_START', ({ totalSteps }) => {
      this.btnStart.disabled = true;
      this.btnStart.style.opacity = '0.5';
      this.btnStart.style.cursor = 'not-allowed';

      this.visitedCount = 0;
      this.statusText.innerHTML = `● Đang dệt chòm sao (0/${totalSteps})...`;
      this.statusText.style.color = '#ffd166';
      this.starCounter.innerHTML = `Sao đã kết nối: <span style="color: #ffd166;">0</span> / 28`;
    });

    const unsubStep = cosmicEventBus.on('COMET_STEP', ({ comet }) => {
      const pct = Math.round(comet.speedNormalized * 100);
      this.speedBarFill.style.width = `${pct}%`;
      this.speedLabel.textContent = `Tốc độ Sao Chổi: ${pct}%`;
    });

    const unsubStarLinked = cosmicEventBus.on('STAR_LINKED', ({ stepIndex }) => {
      this.visitedCount++;
      this.starCounter.innerHTML = `Sao đã kết nối: <span style="color: #ffd166;">${this.visitedCount}</span> / 28`;
      this.statusText.innerHTML = `● Đang dệt chòm sao (Bước ${stepIndex})...`;
    });

    const unsubSupernova = cosmicEventBus.on('STAR_LOCKED_SUPERNOVA', ({ winnerStar }) => {
      this.statusText.innerHTML = `🌟 ĐÃ KHÓA: ${winnerStar.studentName.toUpperCase()}`;
      this.statusText.style.color = '#ff9f43';

      this.speedBarFill.style.width = '0%';
      this.speedLabel.textContent = 'Tốc độ Sao Chổi: 0% (Khóa mục tiêu)';

      this.btnStart.disabled = false;
      this.btnStart.style.opacity = '1';
      this.btnStart.style.cursor = 'pointer';
    });

    const unsubReset = cosmicEventBus.on('CAMERA_RESET', () => {
      this.btnStart.disabled = false;
      this.btnStart.style.opacity = '1';
      this.btnStart.style.cursor = 'pointer';

      this.visitedCount = 0;
      this.statusText.innerHTML = '● Sẵn sàng dệt chòm sao';
      this.statusText.style.color = '#7ee787';
      this.starCounter.innerHTML = `Sao đã kết nối: <span style="color: #ffd166;">0</span> / 28`;
      this.speedBarFill.style.width = '0%';
      this.speedLabel.textContent = 'Tốc độ Sao Chổi: 0%';
    });

    this.unsubscribers.push(unsubStart, unsubStep, unsubStarLinked, unsubSupernova, unsubReset);
  }

  public dispose(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }
}
