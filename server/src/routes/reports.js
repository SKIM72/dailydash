import { Router } from 'express';
import { writeAudit } from '../audit.js';
import { requireAdmin, requireUser } from '../auth.js';
import { query, withTransaction } from '../db.js';
import { parseDate, parseDateRange, parseText } from '../http.js';

const router = Router();

router.get('/notes/:date', requireUser, async (req, res) => {
  const date = parseDate(req.params.date);
  const { rows } = await query(
    'SELECT note_date, special_note, updated_at FROM daily_notes WHERE note_date = $1',
    [date]
  );
  res.json({ note: rows[0] || { note_date: date, special_note: '', updated_at: null } });
});

router.put('/notes/:date', requireUser, async (req, res) => {
  const date = parseDate(req.params.date);
  const note = parseText(req.body?.special_note, '특기사항', { max: 5000 });
  const row = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO daily_notes (note_date, special_note, updated_by, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (note_date) DO UPDATE
         SET special_note = EXCLUDED.special_note, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING note_date, special_note, updated_at`,
      [date, note, req.user.id]
    );
    await writeAudit(db, req.user, '특기사항 저장', date, [`${note.length.toLocaleString('ko-KR')}자`]);
    return rows[0];
  });
  res.json({ note: row });
});

router.get('/summary/daily', requireUser, async (req, res) => {
  const { start, end } = parseDateRange(req.query.start, req.query.end);
  const { rows } = await query(
    `SELECT transaction_date, row_count, total_people, total_cash, total_card, total_expense,
            total_sales, net_sales, average_ticket
       FROM v_daily_sales_summary
      WHERE transaction_date BETWEEN $1 AND $2
      ORDER BY transaction_date`,
    [start, end]
  );
  res.json({ days: rows });
});

// 엑셀 내보내기는 브라우저에서 만들어지므로 완료 후 이력만 따로 남긴다.
router.post('/audit-logs/export', requireAdmin, async (req, res) => {
  const label = parseText(req.body?.label, '대상', { max: 100 });
  const details = Array.isArray(req.body?.details)
    ? req.body.details.slice(0, 5).map((item) => String(item).slice(0, 100))
    : [];
  await writeAudit(null, req.user, '엑셀 백업', label, details);
  res.status(201).json({ ok: true });
});

// 관리자는 전체 이력을, 일반 사용자는 자기 작업만 본다.
router.get('/audit-logs', requireUser, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 200);
  const isAdmin = req.user.role === 'admin';
  const { rows } = await query(
    `SELECT id, at, user_email, action, label, details
       FROM audit_logs
      WHERE ($1::boolean OR user_id = $2)
      ORDER BY at DESC, id DESC
      LIMIT $3`,
    [isAdmin, req.user.id, limit]
  );
  res.json({ logs: rows });
});

export default router;
