import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { writeAudit } from '../audit.js';
import {
  USER_COLUMNS,
  createSession,
  destroySession,
  hashPassword,
  hashToken,
  requireUser,
  revokeUserSessions,
  verifyPassword
} from '../auth.js';
import { config, isMailEnabled } from '../config.js';
import { query, withTransaction } from '../db.js';
import { HttpError, badRequest, parseEmail, parseNewPassword } from '../http.js';
import { sendPasswordResetMail } from '../mailer.js';
import { createRateLimiter } from '../rateLimit.js';

const router = Router();

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60_000,
  max: 10,
  key: (req) => `${req.ip}|${String(req.body?.email || '').trim().toLowerCase()}`,
  message: '로그인 시도가 너무 많습니다. 15분 뒤에 다시 시도해 주세요.',
  resetOnSuccess: true
});
const signupLimiter = createRateLimiter({ windowMs: 60 * 60_000, max: 5 });
const resetLimiter = createRateLimiter({ windowMs: 60 * 60_000, max: 5 });

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status
  };
}

router.get('/options', (req, res) => {
  res.json({ emailPasswordReset: isMailEnabled });
});

router.get('/me', (req, res) => {
  if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
  res.json({ user: publicUser(req.user) });
});

router.post('/login', loginLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) throw badRequest('이메일과 비밀번호를 입력해 주세요.');

  const { rows } = await query(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = $1`, [email]);
  const user = rows[0];
  const valid = await verifyPassword(password, user?.password_hash);
  if (!user || !valid) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.');
  }
  if (user.status === 'pending') {
    throw new HttpError(403, 'PENDING_APPROVAL', '아직 가입 승인이 완료되지 않은 계정입니다. 관리자의 승인을 기다려 주세요.');
  }
  if (user.status !== 'approved') {
    throw new HttpError(403, 'ACCOUNT_DISABLED', '사용이 중지된 계정입니다. 관리자에게 문의해 주세요.');
  }

  const token = await createSession(req, res, user.id);
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  res.json(token ? { user: publicUser(user), token } : { user: publicUser(user) });
});

router.post('/logout', async (req, res) => {
  await destroySession(req, res);
  res.status(204).end();
});

router.post('/signup', signupLimiter, async (req, res) => {
  const email = parseEmail(req.body?.email);
  const password = parseNewPassword(req.body?.password);
  const passwordHash = await hashPassword(password);

  const user = await withTransaction(async (db) => {
    const existing = await db.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (existing.rows.length) throw new HttpError(409, 'EMAIL_TAKEN', '이미 가입된 이메일입니다.');

    // ADMIN_EMAIL 로 처음 가입하는 계정은 곧바로 관리자 승인 상태가 된다 (새 서버 첫 설정용)
    const isBootstrapAdmin = Boolean(config.adminEmail) && email === config.adminEmail;
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, role, status, approved_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${USER_COLUMNS}`,
      [
        email,
        passwordHash,
        isBootstrapAdmin ? 'admin' : 'member',
        isBootstrapAdmin ? 'approved' : 'pending',
        isBootstrapAdmin ? new Date() : null
      ]
    );
    await writeAudit(db, rows[0], '회원가입 신청', email, [isBootstrapAdmin ? '관리자 계정 자동 승인' : '승인 대기']);
    return rows[0];
  });

  res.status(201).json({ user: publicUser(user) });
});

router.post('/password', requireUser, async (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = parseNewPassword(req.body?.newPassword);

  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await verifyPassword(currentPassword, rows[0]?.password_hash))) {
    throw badRequest('현재 비밀번호가 올바르지 않습니다.', 'INVALID_PASSWORD');
  }

  const passwordHash = await hashPassword(newPassword);
  await withTransaction(async (db) => {
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, passwordHash]);
    // 지금 쓰는 기기를 제외한 다른 기기의 로그인은 모두 끊는다.
    await revokeUserSessions(db, req.user.id, { exceptSessionId: req.sessionId });
    await writeAudit(db, req.user, '비밀번호 변경', req.user.email, ['다른 기기 로그인 해제']);
  });
  res.json({ ok: true });
});

router.post('/password-reset/request', resetLimiter, async (req, res) => {
  if (!isMailEnabled) {
    throw new HttpError(501, 'MAIL_DISABLED', '메일 발송이 설정되지 않은 서버입니다. 관리자에게 비밀번호 초기화를 요청해 주세요.');
  }
  const email = parseEmail(req.body?.email);
  const { rows } = await query("SELECT id, email FROM users WHERE email = $1 AND status <> 'disabled'", [email]);

  // 가입 여부와 관계없이 같은 응답을 돌려준다 (계정 존재 여부 노출 방지)
  if (rows.length) {
    const token = randomBytes(32).toString('base64url');
    await query(
      "INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
      [hashToken(token), rows[0].id]
    );
    const baseUrl = config.appUrl || `${req.protocol}://${req.get('host')}`;
    try {
      await sendPasswordResetMail(rows[0].email, `${baseUrl}/login.html#reset=${token}`);
    } catch (err) {
      console.error('[mail] 비밀번호 재설정 메일 발송 실패', err);
      throw new HttpError(502, 'MAIL_FAILED', '메일 발송에 실패했습니다. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요.');
    }
  }
  res.json({ ok: true });
});

router.post('/password-reset/confirm', resetLimiter, async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const newPassword = parseNewPassword(req.body?.newPassword);
  if (!token) throw badRequest('재설정 링크가 올바르지 않습니다.');

  const passwordHash = await hashPassword(newPassword);
  await withTransaction(async (db) => {
    const { rows } = await db.query(
      `UPDATE password_resets SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [hashToken(token)]
    );
    if (!rows.length) {
      throw badRequest('재설정 링크가 만료되었거나 이미 사용되었습니다. 다시 요청해 주세요.', 'INVALID_TOKEN');
    }
    const userId = rows[0].user_id;
    const updated = await db.query(
      `UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [userId, passwordHash]
    );
    await revokeUserSessions(db, userId);
    await writeAudit(db, updated.rows[0], '비밀번호 재설정', updated.rows[0].email, ['메일 링크로 재설정']);
  });
  res.json({ ok: true });
});

export default router;
