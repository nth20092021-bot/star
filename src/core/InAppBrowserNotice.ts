/**
 * 🌐 InAppBrowserNotice — Antigravity (/src/core)
 *
 * Tự động phát hiện khi web game được mở trong các trình duyệt phụ (In-App Browsers)
 * như Messenger, Facebook, Zalo, Instagram, TikTok...
 *
 * Giải pháp:
 * 1. Trên Android: Tự động điều hướng hoặc cung cấp nút 1-click kích hoạt Chrome Intent
 *    (`intent://...#Intent;scheme=https;package=com.android.chrome;end`) để tự động mở Google Chrome.
 * 2. Trên iOS / Nền tảng khác: Cung cấp nút mở bằng Google Chrome (`googlechromes://`),
 *    nút sao chép liên kết nhanh và hướng dẫn bấm dấu ⋯ để mở bằng trình duyệt Safari/Chrome mặc định.
 */

export function isInAppBrowser(): boolean {
  const ua = (navigator.userAgent || navigator.vendor || (window as unknown as { opera?: string }).opera || '').toLowerCase();
  
  // Kiểm tra chuỗi User-Agent đặc trưng của các nền tảng xem phụ
  const isIAB =
    /fban|fbav|fb_iab|messenger/i.test(ua) || // Facebook, Messenger
    /instagram/i.test(ua) ||                  // Instagram
    /zalo|zalotheme/i.test(ua) ||             // Zalo
    /musical_ly|bytelocale|tiktok/i.test(ua) || // TikTok
    /micromessenger/i.test(ua) ||             // WeChat
    /line\//i.test(ua) ||                     // LINE
    /viber/i.test(ua) ||                      // Viber
    /twitter|snapchat/i.test(ua) ||           // Twitter/Snapchat
    /\biab\b/i.test(ua) ||                    // In-App Browser chung
    /wv\b/.test(ua);                          // Android WebView

  // Cho phép kiểm thử bằng tham số ?inapp=1 trên URL
  return isIAB || window.location.search.includes('inapp=1');
}

export function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Kiểm tra và hiển thị giao diện điều hướng sang Google Chrome nếu đang chạy trong trình duyệt phụ
 */
export function checkAndPromptInAppBrowser(): void {
  if (!isInAppBrowser()) return;

  const currentUrl = window.location.href;
  const cleanUrl = currentUrl.replace(/^https?:\/\//i, '');
  const androidIntentUrl = `intent://${cleanUrl}#Intent;scheme=https;package=com.android.chrome;end`;
  const iosChromeUrl = `googlechromes://${cleanUrl}`;

  // Trên Android: Thử tự động kích hoạt intent một lần nếu chưa từng từ chối trong session
  if (isAndroid() && !sessionStorage.getItem('celestial_iab_dismissed')) {
    try {
      window.location.href = androidIntentUrl;
    } catch {
      // Tiếp tục hiển thị banner bên dưới nếu trình duyệt chặn intent tự động
    }
  }

  // Nếu người dùng đã bấm tắt thông báo trong phiên này thì không làm phiền nữa
  if (sessionStorage.getItem('celestial_iab_dismissed')) {
    return;
  }

  // Tạo banner thông báo tối giản, ăn khớp với phong cách vũ trụ đài thiên văn
  const overlay = document.createElement('div');
  overlay.id = 'inapp-browser-prompt';
  overlay.style.cssText = `
    position: fixed;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    width: 92%;
    max-width: 520px;
    background: linear-gradient(145deg, rgba(16, 22, 45, 0.96), rgba(8, 10, 24, 0.98));
    border: 1px solid rgba(255, 209, 102, 0.5);
    border-radius: 18px;
    padding: 16px 20px;
    box-shadow: 0 16px 45px rgba(0, 0, 0, 0.75), 0 0 25px rgba(255, 209, 102, 0.2);
    backdrop-filter: blur(16px);
    z-index: 10000;
    pointer-events: auto;
    font-family: 'Be Vietnam Pro', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #e6edf3;
    animation: fadeInDown 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  overlay.innerHTML = `
    <style>
      @keyframes fadeInDown {
        from { opacity: 0; transform: translate(-50%, -18px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }
      .iab-btn-primary {
        background: linear-gradient(135deg, #ffd166, #e09f3e);
        color: #080a14;
        border: none;
        border-radius: 12px;
        padding: 10px 18px;
        font-weight: 700;
        font-size: 13.5px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 4px 18px rgba(255, 209, 102, 0.4);
        transition: transform 0.2s, filter 0.2s;
        text-decoration: none;
      }
      .iab-btn-primary:active {
        transform: scale(0.97);
      }
      .iab-btn-secondary {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #e2e8f0;
        border-radius: 12px;
        padding: 10px 14px;
        font-weight: 600;
        font-size: 13px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: background 0.2s;
      }
      .iab-btn-secondary:active {
        background: rgba(255, 255, 255, 0.16);
      }
    </style>
    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 24px;">🚀</span>
        <div>
          <div style="font-size: 14.5px; font-weight: 700; color: #ffd166; letter-spacing: 0.3px;">
            Mở trên Google Chrome
          </div>
          <div style="font-size: 12.5px; color: #94a3b8; margin-top: 3px; line-height: 1.4;">
            Trình duyệt Messenger / Zalo làm giảm FPS 3D và chặn âm thanh. Mở bằng Google Chrome để trải nghiệm mượt nhất!
          </div>
        </div>
      </div>
      <button id="iab-close-btn" style="background: transparent; border: none; font-size: 18px; color: #64748b; cursor: pointer; padding: 2px 6px; border-radius: 6px;">✕</button>
    </div>

    <div style="margin-top: 14px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px;">
      <button id="iab-open-btn" class="iab-btn-primary">
        <span>🌐</span> Mở ngay bằng Google
      </button>
      <button id="iab-copy-btn" class="iab-btn-secondary">
        <span>📋</span> Sao chép link
      </button>
      <span id="iab-toast" style="font-size: 12px; color: #38ef7d; font-weight: 600; display: none;">✓ Đã chép link!</span>
    </div>

    <div style="margin-top: 10px; font-size: 11.5px; color: #64748b; display: flex; align-items: center; gap: 4px;">
      <span>💡</span> <span>Hoặc chạm biểu tượng <strong>⋯</strong> ở góc trên ➔ chọn <strong>"Mở bằng trình duyệt ngoài"</strong>.</span>
    </div>
  `;

  document.body.appendChild(overlay);

  // Xử lý nút Mở bằng Google Chrome
  const openBtn = overlay.querySelector('#iab-open-btn') as HTMLButtonElement;
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      if (isAndroid()) {
        window.location.href = androidIntentUrl;
      } else if (isIOS()) {
        window.location.href = iosChromeUrl;
        // Nếu không có Chrome, sau 1s gợi ý sao chép link
        setTimeout(() => {
          copyLinkToClipboard();
        }, 1200);
      } else {
        // Desktop hoặc nền tảng khác
        copyLinkToClipboard();
      }
    });
  }

  // Xử lý nút Sao chép link
  const copyBtn = overlay.querySelector('#iab-copy-btn') as HTMLButtonElement;
  const toast = overlay.querySelector('#iab-toast') as HTMLElement;

  function copyLinkToClipboard(): void {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(currentUrl).then(showToast).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  }

  function fallbackCopy(): void {
    try {
      const input = document.createElement('input');
      input.value = currentUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      showToast();
    } catch {
      alert('Hãy sao chép liên kết: ' + currentUrl);
    }
  }

  function showToast(): void {
    if (toast) {
      toast.style.display = 'inline';
      setTimeout(() => {
        toast.style.display = 'none';
      }, 3000);
    }
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', copyLinkToClipboard);
  }

  // Nút đóng
  const closeBtn = overlay.querySelector('#iab-close-btn') as HTMLButtonElement;
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      sessionStorage.setItem('celestial_iab_dismissed', '1');
      overlay.style.transition = 'opacity 0.25s, transform 0.25s';
      overlay.style.opacity = '0';
      overlay.style.transform = 'translate(-50%, -18px)';
      setTimeout(() => {
        overlay.remove();
      }, 250);
    });
  }
}
