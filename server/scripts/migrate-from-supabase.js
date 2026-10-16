// Supabase(Postgres) → 자체 서버 Postgres 데이터 이전 스크립트
//
// 사용법:
//   SUPABASE_DB_URL="postgresql://postgres.xxxx:비밀번호@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres" \
//   node scripts/migrate-from-supabase.js --dry-run     # 실제 반영 없이 검증만
//   node scripts/migrate-from-supabase.js               # 실제 이전
//   node scripts/migrate-from-supabase.js --force       # 대상 DB 의 기존 데이터를 지우고 다시 이전
//
// - auth.users 의 bcrypt 비밀번호 해시를 그대로 옮기므로 기존 비밀번호로 계속 로그인할 수 있다.
// - user_approvals.is_approved 는 users.status(approved/pending) 로 합쳐진다.
// - 소프트 삭제된 내역(deleted_at)도 보관 상태 그대로 옮긴다.
// - 이전이 끝나면 원본/대상의 건수와 금액 합계를 비교해서 출력한다.
import pg from 'pg';
import { config } from '../src/config.js';
import { pool as target, runMigrations, waitForDatabase } from '../src/db.js';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const FORCE = args.has('--force');
const sourceUrl = process.env.SUPABASE_DB_URL;

if (!sourceUrl) {
  console.error('SUPABASE_DB_URL 환경변수가 필요합니다. (Supabase 대시보드 → Connect → Session pooler 주소)');
  process.exit(1);
}

function stripSslMode(url) {
  const parsed = new URL(url);
  parsed.searchParams.delete('sslmode');
  return parsed.toString();
}

// Supabase 는 자체 CA 인증서를 쓰므로 인증서 검증만 끄고 암호화 연결은 유지한다.
const source = new pg.Pool({
  connectionString: stripSslMode(sourceUrl),
  ssl: process.env.SUPABASE_DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 2
});

const MAPPED_COLUMNS = {
  transactions: new Set([
    'id', 'transaction_date', 'description', 'customer_count', 'cash_income', 'cash_expense',
    'card_income', 'remark1', 'remark2', 'created_at', 'updated_at', 'deleted_at', 'user_id', 'created_by'
  ]),
  daily_notes: new Set(['id', 'note_date', 'special_note', 'created_at', 'updated_at']),
  user_approvals: new Set(['id', 'email', 'is_approved', 'created_at', 'updated_at'])
};

const toInt = (value) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
};
const toText = (value) => (value === null || value === undefined ? '' : String(value).trim());
const toDateKey = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

async function getColumns(db, schema, table) {
  const { rows } = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
    [schema, table]
  );
  return rows.map((row) => row.column_name);
}

async function readTable(table) {
  const columns = await getColumns(source, 'public', table);
  if (!columns.length) {
    console.warn(`  ! public.${table} 테이블이 없습니다. 건너뜁니다.`);
    return { columns, rows: [] };
  }
  const skipped = columns.filter((column) => !MAPPED_COLUMNS[table].has(column));
  if (skipped.length) console.warn(`  ! public.${table} 에서 옮기지 않는 컬럼: ${skipped.join(', ')}`);
  const { rows } = await source.query(`SELECT * FROM public."${table}"`);
  console.log(`  - public.${table}: ${rows.length.toLocaleString()}행`);
  return { columns, rows };
}

async function readAuthUsers() {
  const columns = await getColumns(source, 'auth', 'users');
  const hasDeletedAt = columns.includes('deleted_at');
  const { rows } = await source.query(
    `SELECT id::text AS id, lower(email) AS email, encrypted_password, created_at, last_sign_in_at
       FROM auth.users
      WHERE email IS NOT NULL ${hasDeletedAt ? 'AND deleted_at IS NULL' : ''}`
  );
  console.log(`  - auth.users: ${rows.length.toLocaleString()}명`);
  return rows;
}

async function sourceTotals() {
  const { rows } = await source.query(`
    SELECT COUNT(*)::bigint AS rows,
           COALESCE(SUM(cash_income), 0)::bigint AS cash,
           COALESCE(SUM(card_income), 0)::bigint AS card,
           COALESCE(SUM(cash_expense), 0)::bigint AS expense,
           COALESCE(SUM(customer_count), 0)::bigint AS people
      FROM public.transactions WHERE deleted_at IS NULL`);
  return rows[0];
}

async function targetTotals(db) {
  const { rows } = await db.query(`
    SELECT COUNT(*)::bigint AS rows,
           COALESCE(SUM(cash_income), 0)::bigint AS cash,
           COALESCE(SUM(card_income), 0)::bigint AS card,
           COALESCE(SUM(cash_expense), 0)::bigint AS expense,
           COALESCE(SUM(customer_count), 0)::bigint AS people
      FROM transactions WHERE deleted_at IS NULL`);
  return rows[0];
}

async function main() {
  console.log(`\n[1/5] 대상 DB 준비 (${DRY_RUN ? '검증 모드 - 실제로 저장하지 않음' : '실제 이전'})`);
  await waitForDatabase();
  await runMigrations();

  const existing = await target.query(
    'SELECT (SELECT COUNT(*) FROM transactions) AS tx, (SELECT COUNT(*) FROM users) AS users'
  );
  const hasData = Number(existing.rows[0].tx) > 0 || Number(existing.rows[0].users) > 0;
  if (hasData && !FORCE && !DRY_RUN) {
    console.error('대상 DB 에 이미 데이터가 있습니다. 덮어쓰려면 --force 옵션을 붙여 다시 실행하세요.');
    process.exitCode = 1;
    return;
  }

  console.log('\n[2/5] Supabase 원본 읽기');
  const authUsers = await readAuthUsers();
  const approvals = await readTable('user_approvals');
  const transactions = await readTable('transactions');
  const notes = await readTable('daily_notes');

  const approvalByEmail = new Map(
    approvals.rows.map((row) => [toText(row.email).toLowerCase(), row])
  );

  const client = await target.connect();
  try {
    await client.query('BEGIN');

    if (hasData) {
      console.log('\n  ! 기존 대상 데이터를 비웁니다. (--force)');
      await client.query('TRUNCATE transactions, daily_notes, audit_logs, sessions, password_resets, users RESTART IDENTITY CASCADE');
    }

    console.log('\n[3/5] 사용자 이전');
    const userIdBySupabaseId = new Map();
    const counts = { admin: 0, approved: 0, pending: 0, noPassword: 0 };
    for (const authUser of authUsers) {
      const email = authUser.email;
      const approval = approvalByEmail.get(email);
      const isAdmin = Boolean(config.adminEmail) && email === config.adminEmail;
      const status = isAdmin || approval?.is_approved ? 'approved' : 'pending';
      const hash = authUser.encrypted_password && authUser.encrypted_password.startsWith('$2')
        ? authUser.encrypted_password
        : '!no-password';
      if (hash === '!no-password') counts.noPassword += 1;

      const { rows } = await client.query(
        `INSERT INTO users (email, password_hash, role, status, created_at, approved_at, last_login_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          email,
          hash,
          isAdmin ? 'admin' : 'member',
          status,
          authUser.created_at || new Date(),
          status === 'approved' ? approval?.updated_at || authUser.created_at || new Date() : null,
          authUser.last_sign_in_at
        ]
      );
      userIdBySupabaseId.set(authUser.id, rows[0].id);
      if (isAdmin) counts.admin += 1;
      counts[status] += 1;
    }
    const orphanApprovals = [...approvalByEmail.keys()].filter((email) => !authUsers.some((user) => user.email === email));
    console.log(`  - 관리자 ${counts.admin}명 / 승인 ${counts.approved}명 / 대기 ${counts.pending}명`);
    if (counts.admin === 0) {
      console.warn(`  ! ADMIN_EMAIL(${config.adminEmail || '미설정'}) 과 일치하는 계정이 없어 관리자가 없습니다.`);
      console.warn('    이전 후 node scripts/create-admin.js <이메일> <비밀번호> 로 관리자를 지정하세요.');
    }
    if (counts.noPassword) console.warn(`  ! 비밀번호 해시가 없는 계정 ${counts.noPassword}명은 관리자 비밀번호 초기화가 필요합니다.`);
    if (orphanApprovals.length) console.warn(`  ! 로그인 계정이 없는 승인 명단은 건너뜀: ${orphanApprovals.join(', ')}`);

    console.log('\n[4/5] 정산 내역 / 특기사항 이전');
    const ownerColumn = ['created_by', 'user_id'].find((column) => transactions.columns.includes(column));
    const sortedTransactions = [...transactions.rows].sort((a, b) => {
      const left = `${toDateKey(a.transaction_date)}|${a.created_at ? new Date(a.created_at).toISOString() : ''}|${String(a.id).padStart(20, '0')}`;
      const right = `${toDateKey(b.transaction_date)}|${b.created_at ? new Date(b.created_at).toISOString() : ''}|${String(b.id).padStart(20, '0')}`;
      return left.localeCompare(right);
    });

    let skippedTx = 0;
    for (const tx of sortedTransactions) {
      const date = toDateKey(tx.transaction_date);
      if (!date) {
        skippedTx += 1;
        continue;
      }
      await client.query(
        `INSERT INTO transactions
           (transaction_date, description, customer_count, cash_income, cash_expense, card_income,
            remark1, remark2, created_by, created_at, updated_at, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          date,
          toText(tx.description),
          toInt(tx.customer_count),
          toInt(tx.cash_income),
          toInt(tx.cash_expense),
          toInt(tx.card_income),
          toText(tx.remark1),
          toText(tx.remark2),
          ownerColumn ? userIdBySupabaseId.get(String(tx[ownerColumn])) ?? null : null,
          tx.created_at || new Date(),
          tx.updated_at || null,
          tx.deleted_at || null
        ]
      );
    }
    console.log(`  - 정산 내역 ${(sortedTransactions.length - skippedTx).toLocaleString()}건 (보관 삭제 포함)`);
    if (skippedTx) console.warn(`  ! 날짜가 없는 내역 ${skippedTx}건은 건너뜀`);

    let noteCount = 0;
    for (const note of notes.rows) {
      const date = toDateKey(note.note_date);
      if (!date) continue;
      await client.query(
        `INSERT INTO daily_notes (note_date, special_note, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (note_date) DO UPDATE SET special_note = EXCLUDED.special_note`,
        [date, toText(note.special_note), note.updated_at || note.created_at || new Date()]
      );
      noteCount += 1;
    }
    console.log(`  - 특기사항 ${noteCount.toLocaleString()}건`);

    await client.query(
      `INSERT INTO audit_logs (action, label, details) VALUES ('데이터 이전', 'Supabase → 자체 서버', $1)`,
      [JSON.stringify([`사용자 ${authUsers.length}명`, `내역 ${sortedTransactions.length - skippedTx}건`, `특기사항 ${noteCount}건`])]
    );

    console.log('\n[5/5] 원본과 합계 비교 (삭제 보관분 제외)');
    const [before, after] = [await sourceTotals(), await targetTotals(client)];
    const labels = { rows: '건수', cash: '현금 수입', card: '카드 수입', expense: '현금 지출', people: '인원' };
    let mismatch = false;
    for (const [key, label] of Object.entries(labels)) {
      const ok = Number(before[key]) === Number(after[key]);
      if (!ok) mismatch = true;
      console.log(`  ${ok ? '✔' : '✘'} ${label}: 원본 ${Number(before[key]).toLocaleString()} / 이전 ${Number(after[key]).toLocaleString()}`);
    }

    if (mismatch) {
      await client.query('ROLLBACK');
      console.error('\n합계가 일치하지 않아 이전을 취소했습니다. 위 경고 메시지를 확인해 주세요.');
      process.exitCode = 1;
    } else if (DRY_RUN) {
      await client.query('ROLLBACK');
      console.log('\n검증 완료 - 문제 없음. (--dry-run 이므로 저장하지 않았습니다. 옵션 없이 다시 실행하면 실제로 이전합니다.)');
    } else {
      await client.query('COMMIT');
      console.log('\n이전 완료! 기존 Supabase 비밀번호로 그대로 로그인할 수 있습니다.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error('\n이전 실패:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([source.end(), target.end()]);
  });
