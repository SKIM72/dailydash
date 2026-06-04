import { formatDateKey, parseDateKey } from '../shared/date.js';

export function buildDailySummary(startStr, endStr, txs) {
  const start = parseDateKey(startStr);
  const end = parseDateKey(endStr);
  const dailySummary = {};

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = formatDateKey(d);
    dailySummary[dateStr] = { count: 0, cash: 0, expense: 0, card: 0, total: 0, net: 0 };
  }

  txs.forEach((tx) => {
    const d = tx.transaction_date;
    if (!dailySummary[d]) return;
    const cash = tx.cash_income || 0;
    const card = tx.card_income || 0;
    const expense = tx.cash_expense || 0;
    dailySummary[d].count += tx.customer_count || 0;
    dailySummary[d].cash += cash;
    dailySummary[d].expense += expense;
    dailySummary[d].card += card;
    dailySummary[d].total += cash + card;
    dailySummary[d].net += cash + card - expense;
  });

  return dailySummary;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildDailySummaryFromView(startStr, endStr, rows) {
  const start = parseDateKey(startStr);
  const end = parseDateKey(endStr);
  const dailySummary = {};

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = formatDateKey(d);
    dailySummary[dateStr] = { count: 0, cash: 0, expense: 0, card: 0, total: 0, net: 0 };
  }

  rows.forEach((row) => {
    const dateStr = row.transaction_date;
    if (!dailySummary[dateStr]) return;

    dailySummary[dateStr].count = toNumber(row.total_people);
    dailySummary[dateStr].cash = toNumber(row.total_cash);
    dailySummary[dateStr].expense = toNumber(row.total_expense);
    dailySummary[dateStr].card = toNumber(row.total_card);
    dailySummary[dateStr].total = toNumber(row.total_sales);
    dailySummary[dateStr].net = toNumber(row.net_sales);
  });

  return dailySummary;
}

export function summarizeDailyMap(dailySummary) {
  const days = Object.keys(dailySummary).sort();
  const totals = {
    count: 0,
    cash: 0,
    expense: 0,
    card: 0,
    total: 0,
    net: 0,
    operatingDays: 0,
    maxSales: 0,
    maxSalesDay: '-',
    minSales: 0,
    minSalesDay: '-',
    averageSales: 0,
    averageNet: 0,
    averageTicket: 0,
    cashRatio: 0,
    cardRatio: 0
  };

  days.forEach((d) => {
    const day = dailySummary[d];
    totals.count += day.count;
    totals.cash += day.cash;
    totals.expense += day.expense;
    totals.card += day.card;
    totals.total += day.total;
    totals.net += day.net;

    const isOperating = day.count > 0 || day.total > 0 || day.expense > 0;
    if (isOperating) {
      totals.operatingDays += 1;
      if (day.total > totals.maxSales) {
        totals.maxSales = day.total;
        totals.maxSalesDay = d;
      }
      if (totals.minSalesDay === '-' || day.total < totals.minSales) {
        totals.minSales = day.total;
        totals.minSalesDay = d;
      }
    }
  });

  totals.averageSales = totals.operatingDays > 0 ? Math.round(totals.total / totals.operatingDays) : 0;
  totals.averageNet = totals.operatingDays > 0 ? Math.round(totals.net / totals.operatingDays) : 0;
  totals.averageTicket = totals.count > 0 ? Math.round(totals.total / totals.count) : 0;
  totals.cashRatio = totals.total > 0 ? (totals.cash / totals.total) * 100 : 0;
  totals.cardRatio = totals.total > 0 ? (totals.card / totals.total) * 100 : 0;

  return totals;
}

export function compareTotals(current, previous) {
  const diff = current.total - previous.total;
  const rate = previous.total > 0 ? (diff / previous.total) * 100 : null;
  return { diff, rate };
}

export function summarizeWeekdayPerformance(dailySummary) {
  const weekdayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  const totalSales = Object.values(dailySummary).reduce((sum, day) => sum + day.total, 0);
  const rows = weekdayNames.map((name, index) => ({
    index,
    name,
    total: 0,
    operatingDays: 0,
    average: 0,
    ratio: 0
  }));

  Object.entries(dailySummary).forEach(([dateStr, day]) => {
    const index = parseDateKey(dateStr).getDay();
    const isOperating = day.count > 0 || day.total > 0 || day.expense > 0;
    rows[index].total += day.total;
    if (isOperating) rows[index].operatingDays += 1;
  });

  rows.forEach((row) => {
    row.average = row.operatingDays > 0 ? Math.round(row.total / row.operatingDays) : 0;
    row.ratio = totalSales > 0 ? (row.total / totalSales) * 100 : 0;
  });

  const activeRows = rows.filter((row) => row.operatingDays > 0);
  const byAverageDesc = [...activeRows].sort((a, b) => b.average - a.average);
  const byAverageAsc = [...activeRows].sort((a, b) => a.average - b.average);

  return {
    rows,
    best: byAverageDesc[0] || null,
    slowest: byAverageAsc[0] || null
  };
}

export function summarizeDescriptions(transactions, limit = 5) {
  const map = new Map();
  let totalSales = 0;

  transactions.forEach((tx) => {
    const description = (tx.description || '미입력').trim() || '미입력';
    const cash = toNumber(tx.cash_income);
    const card = toNumber(tx.card_income);
    const expense = toNumber(tx.cash_expense);
    const people = toNumber(tx.customer_count);
    const sales = cash + card;

    if (!map.has(description)) {
      map.set(description, {
        description,
        rowCount: 0,
        people: 0,
        cash: 0,
        card: 0,
        expense: 0,
        total: 0,
        net: 0,
        ratio: 0
      });
    }

    const item = map.get(description);
    item.rowCount += 1;
    item.people += people;
    item.cash += cash;
    item.card += card;
    item.expense += expense;
    item.total += sales;
    item.net += sales - expense;
    totalSales += sales;
  });

  const items = [...map.values()]
    .map((item) => ({
      ...item,
      ratio: totalSales > 0 ? (item.total / totalSales) * 100 : 0
    }))
    .sort((a, b) => b.total - a.total || b.people - a.people)
    .slice(0, limit);

  return {
    items,
    top: items[0] || null,
    totalSales
  };
}

export function createInsightMessages(summary, comparison = null, signals = {}) {
  const messages = [];

  if (summary.operatingDays === 0) {
    return ['조회 기간에 입력된 영업 데이터가 없습니다.'];
  }

  messages.push(`영업일 평균 매출은 ${summary.averageSales.toLocaleString()}원, 객단가는 ${summary.averageTicket.toLocaleString()}원입니다.`);

  if (summary.expense > 0) {
    const expenseRatio = summary.total > 0 ? Math.round((summary.expense / summary.total) * 100) : 0;
    messages.push(`현금 지출은 매출 대비 약 ${expenseRatio}% 수준입니다.`);
  }

  if (comparison && comparison.rate !== null) {
    const direction = comparison.diff >= 0 ? '증가' : '감소';
    messages.push(`이전 기간 대비 매출이 ${Math.abs(Math.round(comparison.rate)).toLocaleString()}% ${direction}했습니다.`);
  }

  if (signals.weekday?.best) {
    messages.push(`${signals.weekday.best.name} 평균 매출이 ${signals.weekday.best.average.toLocaleString()}원으로 가장 강합니다.`);
  }

  if (signals.descriptions?.top) {
    messages.push(`적요 기준 매출 1위는 "${signals.descriptions.top.description}"이며 ${signals.descriptions.top.total.toLocaleString()}원입니다.`);
  }

  if (summary.cardRatio >= 65) {
    messages.push('카드 결제 비중이 높습니다. 현금 흐름 확인을 별도 카드로 계속 보여주는 편이 좋습니다.');
  } else if (summary.cashRatio >= 60) {
    messages.push('현금 결제 비중이 높습니다. 현금 지출과 순현금 잔액을 함께 보는 구성이 유효합니다.');
  }

  return messages.slice(0, 6);
}
