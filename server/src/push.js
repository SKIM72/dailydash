// 웹 푸시(마감 입력 알림). VAPID 키는 .env 에 없으면 처음 시작할 때 만들어 DB(app_settings)에 보관한다.
// 전송은 web-push 로 암호화한 요청을 만들고 fetch 로 보낸다. (시험에서 가짜 푸시 서버로 받을 수 있도록)
import webpush from 'web-push';
import { config } from './config.js';
import { query } from './db.js';

let vapid = null;

async function loadOrCreateKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const read = async () => {
    const { rows } = await query("SELECT key, value FROM app_settings WHERE key IN ('vapid_public_key', 'vapid_private_key')");
    const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    return map.vapid_public_key && map.vapid_private_key ? { publicKey: map.vapid_public_key, privateKey: map.vapid_private_key } : null;
  };
  const existing = await read();
  if (existing) return existing;
  const keys = webpush.generateVAPIDKeys();
  await query(
    `INSERT INTO app_settings (key, value) VALUES ('vapid_public_key', $1), ('vapid_private_key', $2)
     ON CONFLICT (key) DO NOTHING`,
    [keys.publicKey, keys.privateKey]
  );
  return read();
}

function vapidSubject() {
  // 푸시 서비스가 문제 시 연락할 곳. 화면 주소(https)를 우선 쓴다.
  if (config.appUrl.startsWith('https://')) return config.appUrl;
  return config.adminEmail ? `mailto:${config.adminEmail}` : 'mailto:admin@dailydash.invalid';
}

export async function initPush() {
  vapid = await loadOrCreateKeys();
}

export function getPushPublicKey() {
  return vapid?.publicKey || null;
}

// subscription: { endpoint, p256dh, auth } (DB 행) / payload: { title, body, url, tag }
export async function sendPush(subscription, payload) {
  if (!vapid) throw new Error('웹 푸시가 준비되지 않았습니다.');
  const details = webpush.generateRequestDetails(
    { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
    JSON.stringify(payload),
    {
      TTL: 6 * 60 * 60,
      urgency: 'normal',
      vapidDetails: { subject: vapidSubject(), publicKey: vapid.publicKey, privateKey: vapid.privateKey }
    }
  );
  const response = await fetch(details.endpoint, {
    method: details.method,
    headers: details.headers,
    body: details.body,
    signal: AbortSignal.timeout(15_000)
  });
  // 404/410: 사용자가 알림을 끄거나 앱을 지워 더 이상 없는 구독 → 지운다.
  if (response.status === 404 || response.status === 410) {
    await query('DELETE FROM push_subscriptions WHERE endpoint = $1', [subscription.endpoint]);
    return { ok: false, gone: true, status: response.status };
  }
  return { ok: response.ok, status: response.status };
}
