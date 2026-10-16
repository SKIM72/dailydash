// AI 월간 리포트 만들기 - 관리자 버튼(POST /api/ai/monthly-report)과 매월 자동 생성이 같이 쓴다.
import { createHash } from 'node:crypto';
import { writeAudit } from '../audit.js';
import { config } from '../config.js';
import { query } from '../db.js';
import { buildMonthlyFacts, kstToday } from './facts.js';
import { generateReport } from './gemini.js';

export const REPORT_COLUMNS = 'r.id, r.report_month, r.data_through, r.model, r.content, r.created_at, u.email AS created_by_email';

export function toReport(row) {
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

export class NoSalesError extends Error {}

// user 가 없으면 자동 생성(system)으로 기록한다.
export async function createMonthlyReport({ month, user = null, today = kstToday() }) {
  const facts = await buildMonthlyFacts(month, today);
  if (facts.current.operatingDays === 0) throw new NoSalesError('이 달에는 입력된 매출이 없어 리포트를 만들 수 없습니다.');

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
  if (existing.rows[0]) return { report: toReport(existing.rows[0]), cached: true };

  const { report, model } = await generateReport(facts);
  const { rows } = await query(
    `INSERT INTO ai_reports (report_month, data_through, input_digest, input_facts, content, model, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, report_month, data_through, model, content, created_at`,
    [month, facts.current.range[1], digest, JSON.stringify(facts), JSON.stringify(report), model, user?.id ?? null]
  );
  await writeAudit(null, user || { id: null, email: 'system (자동)' }, 'AI 리포트 생성', month, [model, user ? '' : '매월 자동']);
  return { report: toReport({ ...rows[0], created_by_email: user?.email || null }), cached: false };
}
