// PWA 공통: 서비스워커 등록 · 새 버전 알림 · 앱(홈 화면)으로 실행 중인지 판별

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];
const ANDROID_APP_KEY = 'dailydash-android-app';

// 안드로이드 앱(APK)은 시작 주소에 ?source=twa 를 붙이고, 첫 화면의 referrer 가 android-app:// 이다.
// 로그인 화면으로 넘어가도 기억하도록 탭(세션) 단위로 표시해 둔다.
function rememberAndroidApp() {
  const launchedFromApp = new URLSearchParams(window.location.search).get('source') === 'twa'
    || document.referrer.startsWith('android-app://');
  try {
    if (launchedFromApp) sessionStorage.setItem(ANDROID_APP_KEY, '1');
    return sessionStorage.getItem(ANDROID_APP_KEY) === '1';
  } catch {
    return launchedFromApp;
  }
}
const runningInAndroidApp = rememberAndroidApp();

export function isAndroidApp() {
  return runningInAndroidApp;
}

export function isStandalone() {
  return runningInAndroidApp
    || window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

export function detectPlatform() {
  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  if (isIos) return /crios|fxios|edgios/i.test(ua) ? 'ios-other' : 'ios-safari';
  if (/android/i.test(ua)) return /samsungbrowser/i.test(ua) ? 'android-samsung' : 'android';
  return 'desktop';
}

// 설치 안내가 필요 없는 환경(이미 앱으로 실행 중)에서는 '앱 설치' 메뉴를 숨긴다.
export function hideInstallEntriesWhenStandalone(root = document) {
  if (!isStandalone()) return;
  root.querySelectorAll('[data-install-entry]').forEach((element) => element.classList.add('hidden-view'));
}

// 서비스워커를 등록하고, 새 버전이 적용되면 onUpdate 를 부른다. (배포 후 열려 있던 화면에 새로고침 안내)
export function registerServiceWorker({ onUpdate } = {}) {
  if (!('serviceWorker' in navigator)) return;

  if (LOCAL_HOSTS.includes(window.location.hostname)) {
    // 로컬 개발 중에는 캐시 때문에 헷갈리지 않도록 서비스워커를 쓰지 않는다.
    navigator.serviceWorker.getRegistrations?.().then((registrations) => registrations.forEach((registration) => registration.unregister()));
    window.caches?.keys?.().then((keys) => keys.filter((key) => key.startsWith('dailydash')).forEach((key) => caches.delete(key)));
    return;
  }

  const hadController = Boolean(navigator.serviceWorker.controller);
  let notified = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || notified) return;
    notified = true;
    onUpdate?.();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((registration) => {
      const checkForUpdate = () => registration.update().catch(() => {});
      // 앱을 다시 열거나 오래 켜 둔 경우에도 새 버전을 확인한다.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
      setInterval(checkForUpdate, 30 * 60 * 1000);
    }).catch((err) => console.warn('서비스워커 등록 실패', err));
  });
}
