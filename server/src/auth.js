import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { query } from './db.js';
import { HttpError } from './http.js';

const SESSION_COOKIE = 'dd_session';
const BCRYPT_ROUNDS = 10; // Supabase(GoTrue)와 같은 강도라 이전된 해시와 섞여도 일관적이다.
const DAY_MS = 86_400_000;

// 존재하지 않는 이메일로 로그인할 때도 bcrypt 비교 시간을 들여 계정 존재 여부가 드러나지 않게 한다.
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), BCRYPT_ROUNDS);

export const USER_COLUMNS = 'id, email, role, status, created_at, approved_at, last_login_at';

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password, hash) {
  if (!hash || !hash.startsWith('$2')) {
    await bcrypt.compare(password, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(password, hash);
}

export function generateTemporaryPassword() {
  // 헷갈리는 문자(0/O, 1/l/I)를 뺀 10자리
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(10);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}

function parseCookies(header = '') {
  const cookies = {};
  header.split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index < 0) return;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  });
  return cookies;
}

function getBearerToken(req) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+([A-Za-z0-9_-]{20,200})$/);
  return match ? match[1] : null;
}

// 같은 주소에서 열린 화면은 httpOnly 쿠키를, GitHub Pages 처럼 다른 주소의 화면은
// Authorization 헤더 토큰을 쓴다. (아이폰 Safari 는 다른 사이트 쿠키를 막기 때문)
function getRequestToken(req) {
  const bearer = getBearerToken(req);
  if (bearer) return { token: bearer, fromCookie: false };
  const cookieToken = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  return cookieToken ? { token: cookieToken, fromCookie: true } : { token: null, fromCookie: false };
}

export function isAllowedCrossOrigin(req) {
  const origin = req.get('origin');
  return Boolean(origin) && config.allowedOrigins.includes(origin);
}

function isSecureRequest(req) {
  if (config.cookieSecure === 'true') return true;
  if (config.cookieSecure === 'false') return false;
  return req.secure;
}

function setSessionCookie(req, res, token, expiresAt) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: '/',
    expires: expiresAt
  });
}

export function clearSessionCookie(req, res) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: isSecureRequest(req), path: '/' });
}

// 새 세션을 만든다. 다른 주소의 화면(허용된 출처)에서 온 로그인이면 토큰을 돌려줘 헤더로 쓰게 한다.
export async function createSession(req, res, userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionDays * DAY_MS);
  await query(
    'INSERT INTO sessions (id, user_id, expires_at, user_agent, ip) VALUES ($1, $2, $3, $4, $5)',
    [hashToken(token), userId, expiresAt, String(req.get('user-agent') || '').slice(0, 300), req.ip]
  );
  if (isAllowedCrossOrigin(req)) return token;
  setSessionCookie(req, res, token, expiresAt);
  return null;
}

export async function destroySession(req, res) {
  const { token, fromCookie } = getRequestToken(req);
  if (token) await query('DELETE FROM sessions WHERE id = $1', [hashToken(token)]);
  if (fromCookie || !token) clearSessionCookie(req, res);
}

export async function revokeUserSessions(db, userId, { exceptSessionId = null } = {}) {
  await db.query('DELETE FROM sessions WHERE user_id = $1 AND ($2::text IS NULL OR id <> $2)', [userId, exceptSessionId]);
}

// 모든 /api 요청에서 쿠키를 읽어 req.user 를 채운다. 만료가 절반 이상 지났으면 연장(슬라이딩)한다.
export async function loadSession(req, res, next) {
  req.user = null;
  req.sessionId = null;
  const { token, fromCookie } = getRequestToken(req);
  if (!token) return next();

  const sessionId = hashToken(token);
  const { rows } = await query(
    `SELECT s.expires_at, u.id, u.email, u.role, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [sessionId]
  );

  if (!rows.length) {
    if (fromCookie) clearSessionCookie(req, res);
    return next();
  }

  const { expires_at: expiresAt, ...user } = rows[0];
  req.user = user;
  req.sessionId = sessionId;

  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (remainingMs < (config.sessionDays * DAY_MS) / 2) {
    const nextExpiry = new Date(Date.now() + config.sessionDays * DAY_MS);
    await query('UPDATE sessions SET expires_at = $2 WHERE id = $1', [sessionId, nextExpiry]);
    if (fromCookie) setSessionCookie(req, res, token, nextExpiry);
  }
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
  if (req.user.status === 'pending') {
    throw new HttpError(403, 'PENDING_APPROVAL', '아직 가입 승인이 완료되지 않은 계정입니다. 관리자의 승인을 기다려 주세요.');
  }
  if (req.user.status !== 'approved') {
    throw new HttpError(403, 'ACCOUNT_DISABLED', '사용이 중지된 계정입니다. 관리자에게 문의해 주세요.');
  }
  next();
}

export function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (req.user.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', '관리자만 사용할 수 있는 기능입니다.');
    next();
  });
}

export async function cleanupExpiredTokens() {
  await query('DELETE FROM sessions WHERE expires_at < now()');
  await query("DELETE FROM password_resets WHERE expires_at < now() - interval '7 days'");
}
