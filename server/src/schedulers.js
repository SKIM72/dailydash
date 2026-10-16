// 서버 안에서 주기적으로 도는 일: 매월 AI 리포트 자동 생성 · 마감 입력 알림
import { lastDayOfMonth } from './dates.js';
import { NoSalesError, createMonthlyReport } from './ai/reports.js';
import { isAiEnabled } from './config.js';
import { query } from './db.js';
import { getPushPublicKey, sendPush } from './push.js';

function kstNow(now = new Date()) {
  const iso = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), day: Number(iso.slice(8, 10)), hour: Number(iso.slice(11, 13)) };
}

function previousMonth(date) {
  const [year, month] = date.split('-').map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

// 매월 1~5일 오전 6시 이후, 지난달을 마감 기준으로 정리한 리포트가 없으면 자동으로 만든다. (실패하면 다음 확인 때 다시)
export async function runMonthlyReportCheck(now = new Date()) {
  if (!isAiEnabled) return { skipped: 'ai-disabled' };
  const { date, day, hour } = kstNow(now);
  if (day > 5 || hour < 6) return { skipped: 'not-due' };
  const month = previousMonth(date);
  const [year, monthNumber] = month.split('-').map(Number);
  const monthEnd = `${month}-${String(lastDayOfMonth(year, monthNumber)).padStart(2, '0')}`;
  const { rows } = await query('SELECT 1 FROM ai_reports WHERE report_month = $1 AND data_through = $2 LIMIT 1', [month, monthEnd]);
  if (rows.length) return { skipped: 'exists', month };
  try {
    const result = await createMonthlyReport({ month, today: date });
    console.log(`[ai] ${month} 월간 리포트 자동 생성 (${result.report.model}${result.cached ? ', 저장본' : ''})`);
    return { created: !result.cached, month };
  } catch (err) {
    if (err instanceof NoSalesError) return { skipped: 'no-sales', month };
    console.error(`[ai] ${month} 월간 리포트 자동 생성 실패 - 다음 확인 때 다시 시도합니다.`, err.message);
    return { failed: true, month };
  }
}

// 알림 시각이 지났는데 오늘 입력이 하나도 없으면 하루 한 번 알린다.
export async function runReminderCheck(now = new Date()) {
  if (!getPushPublicKey()) return { sent: 0 };
  const { date, time } = kstNow(now);
  const { rows: subscriptions } = await query(
    `SELECT s.endpoint, s.p256dh, s.auth
       FROM push_subscriptions s JOIN users u ON u.id = s.user_id
      WHERE u.status = 'approved' AND s.reminder_time <= $1 AND (s.last_sent_on IS NULL OR s.last_sent_on < $2)`,
    [time, date]
  );
  if (subscriptions.length === 0) return { sent: 0 };
  const { rows: [{ entries }] } = await query(
    'SELECT COUNT(*)::int AS entries FROM transactions WHERE deleted_at IS NULL AND transaction_date = $1',
    [date]
  );
  let sent = 0;
  for (const subscription of subscriptions) {
    if (entries === 0) {
      try {
        const result = await sendPush(subscription, {
          title: 'DailyDash 마감 입력',
          body: '오늘 매출이 아직 입력되지 않았어요. 마감 전에 입력해 주세요.',
          url: 'index.html?view=daily&action=new',
          tag: `dailydash-reminder-${date}`
        });
        if (result.ok) sent += 1;
      } catch (err) {
        console.error('[push] 알림 전송 실패', err.message);
      }
    }
    // 입력이 이미 있으면 보내지 않고, 오늘 확인은 끝낸 것으로 표시한다.
    await query('UPDATE push_subscriptions SET last_sent_on = $1 WHERE endpoint = $2', [date, subscription.endpoint]);
  }
  return { sent, checked: subscriptions.length, entries };
}

export function startSchedulers() {
  const safely = (label, fn) => () => fn().catch((err) => console.error(`[scheduler] ${label}`, err));
  setInterval(safely('알림', runReminderCheck), 5 * 60 * 1000).unref();
  setInterval(safely('AI 리포트', runMonthlyReportCheck), 30 * 60 * 1000).unref();
  safely('AI 리포트', runMonthlyReportCheck)();
}
