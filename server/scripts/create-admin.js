// 사용법: node scripts/create-admin.js <이메일> <비밀번호>
// 관리자 계정을 새로 만들거나, 이미 있으면 관리자 권한 + 승인 상태로 바꾸고 비밀번호를 재설정한다.
// (새 서버를 처음 띄울 때, 또는 관리자 비밀번호를 잊어버렸을 때 사용)
import { hashPassword } from '../src/auth.js';
import { pool, runMigrations, waitForDatabase } from '../src/db.js';
import { parseEmail, parseNewPassword } from '../src/http.js';

const [, , rawEmail, rawPassword] = process.argv;

if (!rawEmail || !rawPassword) {
  console.error('사용법: node scripts/create-admin.js <이메일> <비밀번호>');
  process.exit(1);
}

try {
  const email = parseEmail(rawEmail);
  const password = parseNewPassword(rawPassword);
  await waitForDatabase();
  await runMigrations();

  const passwordHash = await hashPassword(password);
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, role, status, approved_at)
     VALUES ($1, $2, 'admin', 'approved', now())
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, role = 'admin', status = 'approved',
           approved_at = COALESCE(users.approved_at, now())
     RETURNING id, (xmax = 0) AS inserted`,
    [email, passwordHash]
  );
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [rows[0].id]);
  console.log(rows[0].inserted ? `관리자 계정을 만들었습니다: ${email}` : `기존 계정을 관리자로 갱신했습니다: ${email}`);
} catch (err) {
  console.error('실패:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
