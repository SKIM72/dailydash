import { HttpError } from './http.js';

// 단일 서버용 간단한 메모리 기반 제한기 (로그인 무차별 대입 방지 용도)
// resetOnSuccess: 요청이 성공(2xx/3xx)하면 해당 키의 횟수를 초기화한다. (실패한 시도만 누적)
export function createRateLimiter({ windowMs, max, key = (req) => req.ip, message, resetOnSuccess = false }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [entryKey, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(entryKey);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    const entryKey = key(req);
    let entry = hits.get(entryKey);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(entryKey, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      throw new HttpError(429, 'RATE_LIMITED', message || '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
    }
    if (resetOnSuccess) {
      res.on('finish', () => {
        if (res.statusCode < 400) hits.delete(entryKey);
      });
    }
    next();
  };
}
