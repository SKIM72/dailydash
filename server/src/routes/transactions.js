import { Router } from 'express';
import { describeTransaction, writeAudit } from '../audit.js';
import { requireAdmin, requireUser } from '../auth.js';
import { query, withTransaction } from '../db.js';
import { badRequest, notFound, parseAmount, parseDate, parseDateRange, parseId, parseText } from '../http.js';

const router = Router();

const TX_COLUMNS = `id, transaction_date, description, customer_count, cash_income, cash_expense,
  card_income, remark1, remark2, created_at, updated_at`;

const EDITABLE_FIELDS = {
  transaction_date: (value) => parseDate(value, '거래일'),
  description: (value) => parseText(value, '적요'),
  customer_count: (value) => parseAmount(value, '인원', { max: 1_000_000 }),
  cash_income: (value) => parseAmount(value, '현금 수입'),
  cash_expense: (value) => parseAmount(value, '현금 지출'),
  card_income: (value) => parseAmount(value, '카드 수입'),
  remark1: (value) => parseText(value, '비고 1'),
  remark2: (value) => parseText(value, '비고 2')
};

function parseTransactionBody(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object') throw badRequest('요청 형식이 올바르지 않습니다.');
  const values = {};
  for (const [field, parse] of Object.entries(EDITABLE_FIELDS)) {
    if (partial && !(field in body)) continue;
    values[field] = parse(body[field]);
  }
  if (!partial && !values.description) throw badRequest('적요를 입력해 주세요.');
  if (partial && 'description' in values && !values.description) throw badRequest('적요를 입력해 주세요.');
  return values;
}

router.use(requireUser);

// GET /api/transactions?date=YYYY-MM-DD  또는  ?start=...&end=...
router.get('/', async (req, res) => {
  let start;
  let end;
  if (req.query.date) {
    start = end = parseDate(req.query.date);
  } else {
    ({ start, end } = parseDateRange(req.query.start, req.query.end));
  }

  const { rows } = await query(
    `SELECT ${TX_COLUMNS} FROM transactions
      WHERE transaction_date BETWEEN $1 AND $2 AND deleted_at IS NULL
      ORDER BY transaction_date, created_at, id
      LIMIT 20000`,
    [start, end]
  );
  res.json({ transactions: rows });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post('/', async (req, res) => {
  const values = parseTransactionBody(req.body);
  // 오프라인으로 모아 둔 입력은 휴대폰이 붙인 고유 번호(client_id)와 함께 온다.
  // 응답만 못 받고 다시 보내는 경우가 있어, 같은 번호면 새로 저장하지 않고 저장된 내역을 돌려준다.
  const clientId = req.body?.client_id == null || req.body.client_id === '' ? null : String(req.body.client_id);
  if (clientId !== null && !UUID_RE.test(clientId)) throw badRequest('client_id 형식이 올바르지 않습니다.');

  const result = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO transactions
         (transaction_date, description, customer_count, cash_income, cash_expense, card_income, remark1, remark2, created_by, client_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (client_id) DO NOTHING
       RETURNING ${TX_COLUMNS}`,
      [
        values.transaction_date,
        values.description,
        values.customer_count,
        values.cash_income,
        values.cash_expense,
        values.card_income,
        values.remark1,
        values.remark2,
        req.user.id,
        clientId
      ]
    );
    if (!rows.length) {
      const existing = await db.query(`SELECT ${TX_COLUMNS} FROM transactions WHERE client_id = $1`, [clientId]);
      return { transaction: existing.rows[0], duplicate: true };
    }
    const { label, details } = describeTransaction(rows[0]);
    await writeAudit(db, req.user, '내역 입력', label, details, { after: rows[0] });
    return { transaction: rows[0], duplicate: false };
  });
  res.status(result.duplicate ? 200 : 201).json(result);
});

router.patch('/:id', requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  const values = parseTransactionBody(req.body, { partial: true });
  const fields = Object.keys(values);
  if (!fields.length) throw badRequest('수정할 항목이 없습니다.');

  const row = await withTransaction(async (db) => {
    const before = await db.query(
      `SELECT ${TX_COLUMNS} FROM transactions WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id]
    );
    if (!before.rows.length) throw notFound('수정할 내역을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.');

    const assignments = fields.map((field, index) => `${field} = $${index + 2}`);
    const { rows } = await db.query(
      `UPDATE transactions SET ${assignments.join(', ')}, updated_at = now()
        WHERE id = $1
        RETURNING ${TX_COLUMNS}`,
      [id, ...fields.map((field) => values[field])]
    );
    const { label, details } = describeTransaction(rows[0]);
    const changed = fields.filter((field) => String(before.rows[0][field]) !== String(rows[0][field]));
    await writeAudit(db, req.user, '내역 수정', label, [...details, changed.length ? `변경 ${changed.length}개 항목` : '변경 없음'], {
      before: before.rows[0],
      after: rows[0]
    });
    return rows[0];
  });
  res.json({ transaction: row });
});

// 실제 삭제가 아닌 deleted_at 보관(소프트 삭제). 되돌리기는 /restore 로 한다.
router.delete('/:id', requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  const row = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `UPDATE transactions SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING ${TX_COLUMNS}`,
      [id]
    );
    if (!rows.length) throw notFound('삭제할 내역을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.');
    const { label, details } = describeTransaction(rows[0]);
    await writeAudit(db, req.user, '내역 삭제', label, details, { before: rows[0] });
    return rows[0];
  });
  res.json({ transaction: row });
});

router.post('/:id/restore', requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  const row = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `UPDATE transactions SET deleted_at = NULL
        WHERE id = $1 AND deleted_at IS NOT NULL
        RETURNING ${TX_COLUMNS}`,
      [id]
    );
    if (!rows.length) throw notFound('복원할 내역을 찾을 수 없습니다.');
    const { label, details } = describeTransaction(rows[0]);
    await writeAudit(db, req.user, '내역 복원', label, details, { after: rows[0] });
    return rows[0];
  });
  res.json({ transaction: row });
});

export default router;
