// 마감 입력 알림 (웹 푸시) 구독 관리 - 이 기기(브라우저·앱)마다 따로 켜고 끈다.
import { api } from '../services/api.js';

export const DEFAULT_REMINDER_TIME = '21:00';

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ToUint8Array(base64) {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function getRegistration() {
  return (await navigator.serviceWorker.getRegistration()) || null;
}

// { supported, reason?, subscribed, reminderTime, publicKey, permission }
export async function getReminderState() {
  if (!isPushSupported()) return { supported: false, reason: 'browser' };
  const registration = await getRegistration();
  if (!registration) return { supported: false, reason: 'no-service-worker' };
  const { enabled, publicKey } = await api.pushPublicKey();
  if (!enabled) return { supported: false, reason: 'server' };
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return { supported: true, subscribed: false, publicKey, permission: Notification.permission };
  const status = await api.pushStatus(subscription.endpoint);
  return { supported: true, subscribed: status.subscribed, reminderTime: status.reminderTime, publicKey, permission: Notification.permission };
}

export async function enableReminder(publicKey, reminderTime) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('알림 권한이 꺼져 있어요. 휴대폰(또는 브라우저) 설정에서 DailyDash 알림을 허용해 주세요.');
  }
  const registration = await getRegistration();
  let subscription = await registration.pushManager.getSubscription();
  subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  await api.pushSubscribe(subscription.toJSON(), reminderTime);
}

export async function updateReminderTime(reminderTime) {
  const subscription = await (await getRegistration())?.pushManager.getSubscription();
  if (subscription) await api.pushSubscribe(subscription.toJSON(), reminderTime);
}

export async function disableReminder() {
  const subscription = await (await getRegistration())?.pushManager.getSubscription();
  if (!subscription) return;
  await api.pushUnsubscribe(subscription.endpoint).catch(() => {});
  await subscription.unsubscribe();
}

export async function sendTestReminder() {
  const subscription = await (await getRegistration())?.pushManager.getSubscription();
  if (!subscription) throw new Error('이 기기는 알림이 켜져 있지 않아요.');
  return api.pushTest(subscription.endpoint);
}
