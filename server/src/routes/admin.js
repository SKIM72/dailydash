import { Router } from 'express';
import { writeAudit } from '../audit.js';
import { USER_COLUMNS, generateTemporaryPassword, hashPassword, requireAdmin, revokeUserSessions } from '../auth.js';
import { query, withTransaction } from '../db.js';
import { HttpError, notFound, parseId } from '../http.js';

const router = Router();
router.use(requireAdmin);

router.get('/users', async (req, res) => {
  const { rows } = await query(
    `SELECT ${USER_COLUMNS} FROM users
      ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, created_at`
  );
  res.json({ users: rows });
});

async function loadTarget(db, req, { allowSelf = false } = {}) {
  const id = parseId(req.params.id);
  if (!allowSelf && id === req.user.id) {
    throw new HttpError(400, 'SELF_ACTION', '본인 계정에는 이 작업을 할 수 없습니다.');
  }
  const { rows } = await db.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1 FOR UPDATE`, [id]);
  if (!rows.length) throw notFound('사용자를 찾을 수 없습니다.');
  return rows[0];
}

router.post('/users/:id/approve', async (req, res) => {
  const user = await withTransaction(async (db) => {
    const target = await loadTarget(db, req);
    const { rows } = await db.query(
      `UPDATE users SET status = 'approved', approved_at = COALESCE(approved_at, now())
        WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [target.id]
    );
    await writeAudit(db, req.user, '회원 승인', target.email, ['DailyDash 접속 권한 승인']);
    return rows[0];
  });
  res.json({ user });
});

router.post('/users/:id/disable', async (req, res) => {
  const user = await withTransaction(async (db) => {
    const target = await loadTarget(db, req);
    if (target.role === 'admin') throw new HttpError(400, 'ADMIN_TARGET', '관리자 계정은 사용 중지할 수 없습니다.');
    const { rows } = await db.query(
      `UPDATE users SET status = 'disabled' WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [target.id]
    );
    await revokeUserSessions(db, target.id);
    await writeAudit(db, req.user, '회원 사용중지', target.email, ['모든 기기 로그인 해제']);
    return rows[0];
  });
  res.json({ user });
});

// 메일 발송 없이도 운영할 수 있도록 관리자가 임시 비밀번호를 발급한다. (응답으로 한 번만 보여줌)
router.post('/users/:id/reset-password', async (req, res) => {
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const user = await withTransaction(async (db) => {
    const target = await loadTarget(db, req);
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [target.id, passwordHash]);
    await revokeUserSessions(db, target.id);
    await writeAudit(db, req.user, '비밀번호 초기화', target.email, ['임시 비밀번호 발급']);
    return target;
  });
  res.json({ user, temporaryPassword });
});

// 승인 대기/사용중지 계정만 삭제할 수 있다. 정산 내역의 created_by 는 NULL 로 남는다.
router.delete('/users/:id', async (req, res) => {
  await withTransaction(async (db) => {
    const target = await loadTarget(db, req);
    if (target.status === 'approved') {
      throw new HttpError(400, 'ACTIVE_USER', '사용 중인 계정은 먼저 사용 중지한 뒤 삭제해 주세요.');
    }
    await db.query('DELETE FROM users WHERE id = $1', [target.id]);
    await writeAudit(db, req.user, target.status === 'pending' ? '가입 거절' : '회원 삭제', target.email);
  });
  res.status(204).end();
});

export default router;
