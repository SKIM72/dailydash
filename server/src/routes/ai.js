import { Router } from 'express';
import { kstToday } from '../ai/facts.js';
import { NoSalesError, REPORT_COLUMNS, createMonthlyReport, toReport } from '../ai/reports.js';
import { requireAdmin, requireUser } from '../auth.js';
import { config, isAiEnabled } from '../config.js';
import { query } from '../db.js';
import { badRequest } from '../http.js';
import { createRateLimiter } from '../rateLimit.js';

const router = Router();

// 무료 사용량을 지키기 위해 관리자 한 명당 10분에 5번까지만 만든다.
const generateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5,
  key: (req) => `ai:${req.user?.id}`,
  message: 'AI 리포트는 10분에 5번까지 만들 수 있습니다. 잠시 후 다시 시도해 주세요.'
});

function parseMonth(value, today) {
  const month = String(value || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw badRequest('월 형식이 올바르지 않습니다. (예: 2026-10)');
  if (month > today.slice(0, 7)) throw badRequest('아직 오지 않은 달은 리포트를 만들 수 없습니다.');
  return month;
}

router.get('/status', requireUser, (req, res) => {
  res.json({ enabled: isAiEnabled, provider: 'Google Gemini', model: isAiEnabled ? config.gemini.model : null });
});

router.get('/monthly-report', requireUser, async (req, res) => {
  const month = parseMonth(req.query.month, kstToday());
  const { rows } = await query(
    `SELECT ${REPORT_COLUMNS}
       FROM ai_reports r LEFT JOIN users u ON u.id = r.created_by
      WHERE r.report_month = $1
      ORDER BY r.created_at DESC
      LIMIT 1`,
    [month]
  );
  res.json({ report: rows[0] ? toReport(rows[0]) : null });
});

router.post('/monthly-report', requireAdmin, generateLimiter, async (req, res) => {
  const today = kstToday();
  const month = parseMonth(req.body?.month, today);
  try {
    const result = await createMonthlyReport({ month, user: req.user, today });
    res.status(result.cached ? 200 : 201).json(result);
  } catch (err) {
    if (err instanceof NoSalesError) throw badRequest(err.message);
    throw err;
  }
});

export default router;
