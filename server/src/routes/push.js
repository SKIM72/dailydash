import { Router } from 'express';
import { requireUser } from '../auth.js';
import { query } from '../db.js';
import { badRequest } from '../http.js';
import { getPushPublicKey, sendPush } from '../push.js';
import { createRateLimiter } from '../rateLimit.js';

const router = Router();
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const testLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5,
  key: (req) => `push-test:${req.user?.id}`,
  message: '시험 알림은 10분에 5번까지 보낼 수 있습니다.'
});

function parseSubscription(body) {
  const sub = body?.subscription || {};
  const endpoint = String(sub.endpoint || '');
  const p256dh = String(sub.keys?.p256dh || '');
  const auth = String(sub.keys?.auth || '');
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw badRequest('알림 구독 정보가 올바르지 않습니다.');
  }
  if (!['https:', 'http:'].includes(url.protocol) || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
    throw badRequest('알림 구독 정보가 올바르지 않습니다.');
  }
  return { endpoint, p256dh, auth };
}

function parseTime(value) {
  const time = String(value || '21:00');
  if (!TIME_RE.test(time)) throw badRequest('알림 시각 형식이 올바르지 않습니다. (예: 21:00)');
  return time;
}

router.get('/public-key', requireUser, (req, res) => {
  const publicKey = getPushPublicKey();
  res.json({ enabled: Boolean(publicKey), publicKey });
});

// 이 기기의 알림 설정 (endpoint 로 찾는다)
router.post('/status', requireUser, async (req, res) => {
  const endpoint = String(req.body?.endpoint || '');
  const { rows } = await query('SELECT reminder_time FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, req.user.id]);
  res.json({ subscribed: rows.length > 0, reminderTime: rows[0]?.reminder_time || null });
});

router.post('/subscribe', requireUser, async (req, res) => {
  const { endpoint, p256dh, auth } = parseSubscription(req.body);
  const reminderTime = parseTime(req.body?.reminderTime);
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, reminder_time, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
           reminder_time = EXCLUDED.reminder_time, user_agent = EXCLUDED.user_agent, updated_at = now()`,
    [req.user.id, endpoint, p256dh, auth, reminderTime, String(req.get('user-agent') || '').slice(0, 300)]
  );
  res.status(201).json({ subscribed: true, reminderTime });
});

router.delete('/subscribe', requireUser, async (req, res) => {
  const endpoint = String(req.body?.endpoint || '');
  await query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, req.user.id]);
  res.json({ subscribed: false });
});

// 이 기기로 시험 알림 보내기
router.post('/test', requireUser, testLimiter, async (req, res) => {
  const endpoint = String(req.body?.endpoint || '');
  const { rows } = await query('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, req.user.id]);
  if (!rows.length) throw badRequest('이 기기는 알림이 켜져 있지 않습니다.');
  const result = await sendPush(rows[0], {
    title: 'DailyDash 알림 시험',
    body: '알림이 잘 와요! 마감 시각에 오늘 입력이 없으면 이렇게 알려 드려요.',
    url: 'index.html?view=daily',
    tag: 'dailydash-test'
  });
  res.json(result);
});

export default router;
