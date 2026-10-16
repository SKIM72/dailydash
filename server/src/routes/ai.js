import { createHash } from 'node:crypto';
import { Router } from 'express';
import { buildMonthlyFacts, kstToday } from '../ai/facts.js';
import { generateReport } from '../ai/gemini.js';
import { writeAudit } from '../audit.js';
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

const REPORT_COLUMNS = `r.id, r.report_month, r.data_through, r.model, r.content, r.created_at, u.email AS created_by_email`;

function parseMonth(value, today) {
  const month = String(value || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw badRequest('월 형식이 올바르지 않습니다. (예: 2026-10)');
  if (month > today.slice(0, 7)) throw badRequest('아직 오지 않은 달은 리포트를 만들 수 없습니다.');
  return month;
}

function toReport(row) {
  return {
    id: row.id,
    month: row.report_month,
    dataThrough: row.data_through,
    model: row.model,
    content: row.content,
    createdAt: row.created_at,
    createdBy: row.created_by_email || null
  };
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
  const facts = await buildMonthlyFacts(month, today);
  if (facts.current.operatingDays === 0) throw badRequest('이 달에는 입력된 매출이 없어 리포트를 만들 수 없습니다.');

  // 같은 데이터·같은 모델로 이미 만든 리포트가 있으면 AI 를 다시 부르지 않는다. (오늘 날짜는 마감된 달에 영향이 없으므로 제외)
  const digest = createHash('sha256')
    .update(JSON.stringify({ model: config.gemini.model, facts: { ...facts, today: facts.inProgress ? facts.today : null } }))
    .digest('hex');
  const existing = await query(
    `SELECT ${REPORT_COLUMNS}
       FROM ai_reports r LEFT JOIN users u ON u.id = r.created_by
      WHERE r.input_digest = $1
      ORDER BY r.created_at DESC
      LIMIT 1`,
    [digest]
  );
  if (existing.rows[0]) return res.json({ report: toReport(existing.rows[0]), cached: true });

  const { report, model } = await generateReport(facts);
  const { rows } = await query(
    `INSERT INTO ai_reports (report_month, data_through, input_digest, input_facts, content, model, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, report_month, data_through, model, content, created_at`,
    [month, facts.current.range[1], digest, JSON.stringify(facts), JSON.stringify(report), model, req.user.id]
  );
  await writeAudit(null, req.user, 'AI 리포트 생성', month, [model]);
  res.status(201).json({ report: toReport({ ...rows[0], created_by_email: req.user.email }), cached: false });
});

export default router;
