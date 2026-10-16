import '../style.css';
import { setIcon } from './shared/icons.js';
import { detectPlatform, isStandalone, registerServiceWorker } from './shared/pwa.js';
import { initTheme, resolveTheme, toggleTheme } from './shared/theme.js';
import { showToast } from './shared/toast.js';

initTheme();
registerServiceWorker();

// 안드로이드·PC 의 Chrome/Edge 는 설치 가능할 때 이 이벤트를 준다. (iOS 는 공유 메뉴로만 설치)
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  document.getElementById('installBtn')?.classList.remove('hidden-view');
  document.getElementById('guideBtn')?.classList.add('hidden-view');
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  document.getElementById('installBtn')?.classList.add('hidden-view');
  showToast('설치가 끝났어요. 홈 화면에서 DailyDash 를 열어 보세요.');
});

function guideKey(platform) {
  if (platform.startsWith('ios')) return 'ios';
  if (platform.startsWith('android')) return 'android';
  return 'desktop';
}

function highlightThisDevice() {
  const platform = detectPlatform();
  const guide = document.querySelector(`.install-guide[data-platform="${guideKey(platform)}"]`);
  if (!guide) return;
  guide.open = true;
  guide.querySelector('[data-this-device]')?.classList.remove('hidden-view');
  // 이 기기에 맞는 안내를 맨 위로 올린다.
  guide.parentElement.prepend(guide);
  if (platform === 'ios-safari') document.getElementById('iosOtherBrowserNote')?.classList.add('hidden-view');
}

function paintThemeToggle() {
  const button = document.getElementById('themeToggleBtn');
  if (!button) return;
  const dark = resolveTheme() === 'dark';
  setIcon(button, dark ? 'sun' : 'moon');
  button.setAttribute('aria-label', dark ? '라이트 모드로 바꾸기' : '다크 모드로 바꾸기');
  button.title = button.getAttribute('aria-label');
}

async function renderQrCode(container, text) {
  const { default: qrcode } = await import('qrcode-generator');
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  let path = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) path += `M${col},${row}h1v1h-1z`;
    }
  }
  container.innerHTML = `<svg viewBox="0 0 ${count} ${count}" shape-rendering="crispEdges" aria-hidden="true"><path d="${path}" fill="currentColor"/></svg>`;
}

document.addEventListener('DOMContentLoaded', () => {
  highlightThisDevice();
  paintThemeToggle();
  document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
    toggleTheme();
    paintThemeToggle();
  });

  if (isStandalone()) {
    document.getElementById('installedStatus')?.classList.remove('hidden-view');
    document.getElementById('guideBtn')?.classList.add('hidden-view');
  }

  document.getElementById('installBtn')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') deferredPrompt = null;
  });

  const pageUrl = new URL('install.html', window.location.href).href;
  const qrContainer = document.getElementById('qrCode');
  if (qrContainer) renderQrCode(qrContainer, pageUrl).catch((err) => console.warn('QR 코드 생성 실패', err));

  document.getElementById('copyLinkBtn')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pageUrl);
      showToast('설치 안내 링크를 복사했어요.');
    } catch {
      showToast(pageUrl, { tone: 'info', duration: 8000 });
    }
  });
});
