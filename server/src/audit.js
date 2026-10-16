import { query } from './db.js';

export async function writeAudit(db, user, action, label, details = [], snapshot = null) {
  await (db || { query }).query(
    `INSERT INTO audit_logs (user_id, user_email, action, label, details, snapshot)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      user?.id ?? null,
      user?.email ?? null,
      action,
      label || '',
      JSON.stringify(details.filter(Boolean)),
      snapshot ? JSON.stringify(snapshot) : null
    ]
  );
}

export function describeTransaction(tx) {
  const sales = Number(tx.cash_income || 0) + Number(tx.card_income || 0);
  return {
    label: `${tx.transaction_date} · ${tx.description || '적요 없음'}`,
    details: [
      `총매출 ${sales.toLocaleString('ko-KR')}원`,
      `인원 ${Number(tx.customer_count || 0).toLocaleString('ko-KR')}명`
    ]
  };
}
