// AI 월간 리포트에 넘길 집계를 DB 에서 직접 만든다.
// 숫자(증감률 포함)는 모두 여기서 계산하고, AI 는 이 숫자를 해석하는 문장만 쓴다.
// 개인정보가 섞일 수 있는 비고(remark)·특기사항은 보내지 않는다.
import { query } from '../db.js';
import { kstToday, lastDayOfMonth } from '../dates.js';
import { ALIAS_JOIN_SQL, CANONICAL_SQL, NOT_AN_ITEM } from '../descriptions.js';
import { FORECAST_METHOD_LABELS, forecastMonthEnd } from '../forecast.js';

export { kstToday };

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const OPERATING = '(total_people > 0 OR total_sales > 0 OR total_expense > 0)';

const pad = (value) => String(value).padStart(2, '0');
const monthKey = (year, month) => `${year}-${pad(month)}`;

function shiftMonth(year, month, diff) {
  const index = year * 12 + (month - 1) + diff;
  return [Math.floor(index / 12), (index % 12) + 1];
}

function rate(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

async function periodTotals(start, end) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(total_sales), 0) AS sales,
            COALESCE(SUM(total_cash), 0) AS cash,
            COALESCE(SUM(total_card), 0) AS card,
            COALESCE(SUM(total_expense), 0) AS expense,
            COALESCE(SUM(total_people), 0) AS customers,
            COUNT(*) FILTER (WHERE ${OPERATING})::int AS operating_days
       FROM v_daily_sales_summary
      WHERE transaction_date BETWEEN $1 AND $2`,
    [start, end]
  );
  const row = rows[0];
  return {
    range: [start, end],
    sales: row.sales,
    cash: row.cash,
    card: row.card,
    expense: row.expense,
    customers: row.customers,
    operatingDays: row.operating_days,
    salesPerOperatingDay: row.operating_days > 0 ? Math.round(row.sales / row.operating_days) : 0,
    averageTicket: row.customers > 0 ? Math.round(row.sales / row.customers) : 0
  };
}

function compare(current, previous) {
  return {
    salesRate: rate(current.sales, previous.sales),
    salesPerOperatingDayRate: rate(current.salesPerOperatingDay, previous.salesPerOperatingDay),
    operatingDays: `${previous.operatingDays}일 → ${current.operatingDays}일`
  };
}

async function topItems(ranges, limit = 8) {
  const [current, previousMonth, lastYear] = ranges;
  const { rows } = await query(
    `WITH items AS (
       SELECT ${CANONICAL_SQL} AS name,
              t.transaction_date,
              t.cash_income + t.card_income AS sales,
              t.customer_count
         FROM transactions t ${ALIAS_JOIN_SQL}
        WHERE t.deleted_at IS NULL AND btrim(t.description) <> ''
     )
     SELECT name,
            SUM(sales) FILTER (WHERE transaction_date BETWEEN $1 AND $2) AS sales,
            SUM(customer_count) FILTER (WHERE transaction_date BETWEEN $1 AND $2) AS customers,
            COALESCE(SUM(sales) FILTER (WHERE transaction_date BETWEEN $3 AND $4), 0) AS previous_month_sales,
            COALESCE(SUM(sales) FILTER (WHERE transaction_date BETWEEN $5 AND $6), 0) AS last_year_sales
       FROM items
      WHERE name <> $8
        AND (transaction_date BETWEEN $1 AND $2
         OR transaction_date BETWEEN $3 AND $4
         OR transaction_date BETWEEN $5 AND $6)
      GROUP BY name
     HAVING COALESCE(SUM(sales) FILTER (WHERE transaction_date BETWEEN $1 AND $2), 0) > 0
      ORDER BY 2 DESC
      LIMIT $7`,
    [...current, ...previousMonth, ...lastYear, limit, NOT_AN_ITEM]
  );
  return rows;
}

async function namedTopItems(start, end, limit = 5) {
  const { rows } = await query(
    `SELECT ${CANONICAL_SQL} AS name, SUM(t.cash_income + t.card_income) AS sales
       FROM transactions t ${ALIAS_JOIN_SQL}
      WHERE t.deleted_at IS NULL AND btrim(t.description) <> '' AND t.transaction_date BETWEEN $1 AND $2
        AND ${CANONICAL_SQL} <> $4
      GROUP BY 1
     HAVING SUM(t.cash_income + t.card_income) > 0
      ORDER BY 2 DESC
      LIMIT $3`,
    [start, end, limit, NOT_AN_ITEM]
  );
  return rows.map((row) => ({ name: row.name, sales: row.sales }));
}

// month: 'YYYY-MM'. 진행 중인 달은 오늘까지만, 비교 기간도 같은 날짜까지로 맞춘다.
export async function buildMonthlyFacts(month, today = kstToday()) {
  const [year, monthNumber] = month.split('-').map(Number);
  const inProgress = month === today.slice(0, 7);
  const lastDay = lastDayOfMonth(year, monthNumber);
  const cutoffDay = inProgress ? Number(today.slice(8, 10)) : lastDay;
  const start = `${month}-01`;
  const end = `${month}-${pad(cutoffDay)}`;

  const [prevYear, prevMonth] = shiftMonth(year, monthNumber, -1);
  const prevLastDay = lastDayOfMonth(prevYear, prevMonth);
  const prevRange = [`${monthKey(prevYear, prevMonth)}-01`, `${monthKey(prevYear, prevMonth)}-${pad(inProgress ? Math.min(cutoffDay, prevLastDay) : prevLastDay)}`];

  const lastYearLastDay = lastDayOfMonth(year - 1, monthNumber);
  const lastYearMonth = monthKey(year - 1, monthNumber);
  const lastYearRange = [`${lastYearMonth}-01`, `${lastYearMonth}-${pad(inProgress ? Math.min(cutoffDay, lastYearLastDay) : lastYearLastDay)}`];
  const lastYearFullRange = [`${lastYearMonth}-01`, `${lastYearMonth}-${pad(lastYearLastDay)}`];

  const [nextYearOfLastYear, nextMonth] = shiftMonth(year - 1, monthNumber, 1);
  const lastYearNextMonth = monthKey(nextYearOfLastYear, nextMonth);
  const lastYearNextRange = [`${lastYearNextMonth}-01`, `${lastYearNextMonth}-${pad(lastDayOfMonth(nextYearOfLastYear, nextMonth))}`];

  const [historyStartYear, historyStartMonth] = shiftMonth(year, monthNumber, -24);

  const [current, previousMonth, lastYear, lastYearFull, lastYearNext, items, nextItems, historyRows, weekdayRows, dailyRows] = await Promise.all([
    periodTotals(start, end),
    periodTotals(...prevRange),
    periodTotals(...lastYearRange),
    periodTotals(...lastYearFullRange),
    periodTotals(...lastYearNextRange),
    topItems([[start, end], prevRange, lastYearRange]),
    namedTopItems(...lastYearNextRange),
    query(
      `SELECT to_char(date_trunc('month', transaction_date), 'YYYY-MM') AS month,
              SUM(total_sales) AS sales,
              COUNT(*) FILTER (WHERE ${OPERATING})::int AS operating_days
         FROM v_daily_sales_summary
        WHERE transaction_date BETWEEN $1 AND $2
        GROUP BY 1 ORDER BY 1`,
      [`${monthKey(historyStartYear, historyStartMonth)}-01`, end]
    ),
    query(
      `SELECT EXTRACT(DOW FROM transaction_date)::int AS dow,
              COUNT(*) FILTER (WHERE ${OPERATING})::int AS operating_days,
              SUM(total_sales) AS sales
         FROM v_daily_sales_summary
        WHERE transaction_date BETWEEN $1 AND $2
        GROUP BY 1 ORDER BY 1`,
      [start, end]
    ),
    query(
      `SELECT to_char(transaction_date, 'MM-DD') AS date, EXTRACT(DOW FROM transaction_date)::int AS dow,
              total_sales AS sales, total_people AS customers
         FROM v_daily_sales_summary
        WHERE transaction_date BETWEEN $1 AND $2 AND ${OPERATING}
        ORDER BY transaction_date`,
      [start, end]
    )
  ]);

  function buildForecast() {
    const forecast = forecastMonthEnd({
      salesToDate: current.sales,
      operatingDaysToDate: current.operatingDays,
      elapsedDays: cutoffDay,
      daysInMonth: lastDay,
      lastYearSalesToDate: lastYear.sales,
      lastYearSalesFullMonth: lastYearFull.sales
    });
    return forecast && { sales: forecast.sales, basis: FORECAST_METHOD_LABELS[forecast.method], note: '추정치입니다' };
  }

  return {
    shop: '하늘향 (전통차·카페, 계절 상품 판매)',
    month,
    today,
    inProgress,
    note: inProgress ? `진행 중인 달이라 ${pad(cutoffDay)}일(오늘)까지만 집계했고, 비교 기간도 같은 날짜까지로 맞췄습니다.` : '마감된 달입니다.',
    current,
    previousMonthSamePeriod: previousMonth,
    lastYearSamePeriod: lastYear,
    ...(inProgress ? { lastYearFullMonth: lastYearFull, monthEndForecast: buildForecast() } : {}),
    comparisons: {
      vsPreviousMonthSamePeriod: compare(current, previousMonth),
      vsLastYearSamePeriod: compare(current, lastYear)
    },
    lastYearNextMonth: { month: lastYearNextMonth, sales: lastYearNext.sales, operatingDays: lastYearNext.operatingDays, topItems: nextItems },
    monthlyHistory: historyRows.rows.map((row) => ({ month: row.month, sales: row.sales, operatingDays: row.operating_days, partial: row.month === month && inProgress })),
    weekdays: weekdayRows.rows
      .filter((row) => row.operating_days > 0)
      .map((row) => ({ weekday: WEEKDAYS[row.dow], operatingDays: row.operating_days, salesPerOperatingDay: Math.round(row.sales / row.operating_days) })),
    topItems: items.map((row) => ({
      name: row.name,
      sales: row.sales,
      customers: row.customers,
      shareOfSales: current.sales > 0 ? Math.round((row.sales / current.sales) * 1000) / 10 : 0,
      previousMonthSamePeriodSales: row.previous_month_sales,
      lastYearSamePeriodSales: row.last_year_sales
    })),
    dailySales: dailyRows.rows.map((row) => ({ date: row.date, weekday: WEEKDAYS[row.dow], sales: row.sales, customers: row.customers }))
  };
}
