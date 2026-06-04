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

function isOperatingDay(day) {
  return day.count > 0 || day.cash > 0 || day.card > 0 || day.total > 0 || day.expense > 0;
}

function getAverageTicket(day) {
  return day.count > 0 ? Math.round(day.total / day.count) : 0;
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

    const cash = toNumber(row.total_cash);
    const card = toNumber(row.total_card);
    const expense = toNumber(row.total_expense);
    const reportedTotal = toNumber(row.total_sales);
    const computedTotal = cash + card;
    const total = computedTotal > 0 ? computedTotal : reportedTotal;

    dailySummary[dateStr].count = toNumber(row.total_people);
    dailySummary[dateStr].cash = cash;
    dailySummary[dateStr].expense = expense;
    dailySummary[dateStr].card = card;
    dailySummary[dateStr].total = total;
    dailySummary[dateStr].net = total > 0 || expense > 0 ? total - expense : toNumber(row.net_sales);
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

    const isOperating = isOperatingDay(day);
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

export function summarizeWeekdayPerformance(dailySummary, transactions = []) {
  const weekdayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  const totalSales = Object.values(dailySummary).reduce((sum, day) => sum + day.total, 0);
  const rows = weekdayNames.map((name, index) => ({
    index,
    name,
    total: 0,
    operatingDays: 0,
    average: 0,
    ratio: 0,
    recentFourAverage: 0,
    lastDate: '-',
    lastTotal: 0,
    previousDate: '-',
    previousTotal: 0,
    lastVsPreviousDiff: 0,
    lastVsPreviousRate: null,
    topDescription: null,
    days: []
  }));

  Object.entries(dailySummary).forEach(([dateStr, day]) => {
    const index = parseDateKey(dateStr).getDay();
    const isOperating = isOperatingDay(day);
    rows[index].total += day.total;
    if (isOperating) {
      rows[index].operatingDays += 1;
      rows[index].days.push({
        date: dateStr,
        total: day.total,
        count: day.count
      });
    }
  });

  const descriptionMap = new Map();
  transactions.forEach((tx) => {
    const dateStr = tx.transaction_date;
    if (!dateStr || !dailySummary[dateStr]) return;

    const sales = toNumber(tx.cash_income) + toNumber(tx.card_income);
    if (sales <= 0) return;

    const index = parseDateKey(dateStr).getDay();
    const description = (tx.description || '미입력').trim() || '미입력';
    const key = `${index}::${description}`;

    if (!descriptionMap.has(key)) {
      descriptionMap.set(key, {
        weekdayIndex: index,
        description,
        total: 0,
        people: 0,
        rowCount: 0
      });
    }

    const item = descriptionMap.get(key);
    item.total += sales;
    item.people += toNumber(tx.customer_count);
    item.rowCount += 1;
  });

  const descriptions = [...descriptionMap.values()];
  rows.forEach((row) => {
    row.average = row.operatingDays > 0 ? Math.round(row.total / row.operatingDays) : 0;
    row.ratio = totalSales > 0 ? (row.total / totalSales) * 100 : 0;

    const recentDays = row.days.slice(-4);
    row.recentFourAverage = recentDays.length > 0
      ? Math.round(recentDays.reduce((sum, day) => sum + day.total, 0) / recentDays.length)
      : 0;

    const last = row.days[row.days.length - 1] || null;
    const previous = row.days[row.days.length - 2] || null;
    if (last) {
      row.lastDate = last.date;
      row.lastTotal = last.total;
    }
    if (previous) {
      row.previousDate = previous.date;
      row.previousTotal = previous.total;
      row.lastVsPreviousDiff = last.total - previous.total;
      row.lastVsPreviousRate = previous.total > 0 ? (row.lastVsPreviousDiff / previous.total) * 100 : null;
    }

    row.topDescription = descriptions
      .filter((item) => item.weekdayIndex === row.index)
      .sort((a, b) => b.total - a.total || b.people - a.people || b.rowCount - a.rowCount)[0] || null;
  });

  const activeRows = rows.filter((row) => row.operatingDays > 0);
  const byAverageDesc = [...activeRows].sort((a, b) => b.average - a.average);
  const byAverageAsc = [...activeRows].sort((a, b) => a.average - b.average);

  return {
    rows,
    activeRows,
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

export function analyzeSalesFlow(dailySummary) {
  const rows = Object.keys(dailySummary).sort().map((date) => ({
    date,
    ...dailySummary[date],
    averageTicket: getAverageTicket(dailySummary[date])
  }));
  const activeRows = rows.filter(isOperatingDay);
  const totalSales = rows.reduce((sum, day) => sum + day.total, 0);

  if (activeRows.length === 0) {
    return {
      badges: [{ label: '데이터 없음', tone: 'neutral' }],
      highlights: [],
      messages: [{
        tone: 'neutral',
        title: '분석 대기',
        body: '조회 기간에 입력된 매출 데이터가 없어 차트 해석을 만들 수 없습니다.'
      }]
    };
  }

  const bySalesDesc = [...activeRows].sort((a, b) => b.total - a.total);
  const maxDay = bySalesDesc[0];
  const minDay = [...activeRows].sort((a, b) => a.total - b.total)[0];
  const concentrationRate = totalSales > 0 ? (maxDay.total / totalSales) * 100 : 0;
  const activeRowIndexes = activeRows.map((day) => rows.findIndex((row) => row.date === day.date));
  const lastActiveIndex = activeRowIndexes[activeRowIndexes.length - 1];
  const trailingEmptyDays = rows.slice(lastActiveIndex + 1).filter((day) => !isOperatingDay(day)).length;

  const changes = [];
  for (let index = 1; index < activeRows.length; index += 1) {
    const previous = activeRows[index - 1];
    const current = activeRows[index];
    const diff = current.total - previous.total;
    changes.push({
      from: previous.date,
      to: current.date,
      diff,
      rate: previous.total > 0 ? (diff / previous.total) * 100 : null,
      previous,
      current
    });
  }

  const biggestRise = changes.filter((change) => change.diff > 0).sort((a, b) => b.diff - a.diff)[0] || null;
  const biggestDrop = changes.filter((change) => change.diff < 0).sort((a, b) => a.diff - b.diff)[0] || null;
  const ticketRows = activeRows.filter((day) => day.averageTicket > 0);
  const firstTicketDay = ticketRows[0] || null;
  const lastTicketDay = ticketRows[ticketRows.length - 1] || null;
  const ticketDiff = firstTicketDay && lastTicketDay ? lastTicketDay.averageTicket - firstTicketDay.averageTicket : 0;
  const ticketRate = firstTicketDay?.averageTicket > 0 ? (ticketDiff / firstTicketDay.averageTicket) * 100 : null;
  const cardMissingDays = activeRows.filter((day) => day.total > 0 && day.card === 0).length;
  const cashMissingDays = activeRows.filter((day) => day.total > 0 && day.cash === 0).length;
  const expenseHeavyDays = activeRows.filter((day) => day.total > 0 && (day.expense / day.total) >= 0.3);
  const latestActiveDay = activeRows[activeRows.length - 1];
  const latestIndex = rows.findIndex((day) => day.date === latestActiveDay.date);
  const recentSevenRows = rows
    .slice(Math.max(0, latestIndex - 6), latestIndex + 1)
    .filter(isOperatingDay);
  const previousSevenRows = rows
    .slice(Math.max(0, latestIndex - 13), Math.max(0, latestIndex - 6))
    .filter(isOperatingDay);
  const recentSevenAverage = recentSevenRows.length > 0
    ? Math.round(recentSevenRows.reduce((sum, day) => sum + day.total, 0) / recentSevenRows.length)
    : 0;
  const previousSevenAverage = previousSevenRows.length > 0
    ? Math.round(previousSevenRows.reduce((sum, day) => sum + day.total, 0) / previousSevenRows.length)
    : 0;
  const recentAverageDiff = previousSevenAverage > 0 ? recentSevenAverage - previousSevenAverage : null;
  const recentAverageRate = previousSevenAverage > 0 ? (recentAverageDiff / previousSevenAverage) * 100 : null;
  const sameWeekdayDay = [...activeRows]
    .filter((day) => day.date < latestActiveDay.date && parseDateKey(day.date).getDay() === parseDateKey(latestActiveDay.date).getDay())
    .pop();
  const sameWeekdayDiff = sameWeekdayDay ? latestActiveDay.total - sameWeekdayDay.total : null;
  const sameWeekdayRate = sameWeekdayDay?.total > 0 ? (sameWeekdayDiff / sameWeekdayDay.total) * 100 : null;

  const badges = [];
  if (concentrationRate >= 60) badges.push({ label: '매출 집중', tone: 'warning' });
  if (recentAverageRate >= 20) badges.push({ label: '7일 평균 상승', tone: 'success' });
  if (recentAverageRate <= -20) badges.push({ label: '7일 평균 하락', tone: 'warning' });
  if (sameWeekdayRate >= 30) badges.push({ label: '동요일 상승', tone: 'success' });
  if (sameWeekdayRate <= -30) badges.push({ label: '동요일 하락', tone: 'warning' });
  if (biggestDrop?.rate <= -40) badges.push({ label: '급락 확인', tone: 'danger' });
  if (trailingEmptyDays > 0) badges.push({ label: '입력 공백', tone: 'warning' });
  if (expenseHeavyDays.length > 0) badges.push({ label: '지출 비중 높음', tone: 'danger' });
  if (badges.length === 0) badges.push({ label: '흐름 안정', tone: 'success' });

  const highlights = [
    {
      label: '최고 매출일',
      value: maxDay.date,
      amount: maxDay.total,
      meta: `전체 매출의 ${Math.round(concentrationRate).toLocaleString()}%`
    },
    {
      label: '최저 입력일',
      value: minDay.date,
      amount: minDay.total,
      meta: `${activeRows.length.toLocaleString()}영업일 기준`
    }
  ];

  if (recentSevenAverage > 0) {
    highlights.push({
      label: '7일 평균',
      value: '최근 흐름',
      amount: recentSevenAverage,
      meta: `${recentSevenRows.length.toLocaleString()}영업일 기준`
    });
  }

  if (biggestRise) {
    highlights.push({
      label: '최대 증가',
      value: `${biggestRise.from.slice(5)} → ${biggestRise.to.slice(5)}`,
      amount: biggestRise.diff,
      meta: biggestRise.rate === null ? '비교 없음' : `+${Math.round(biggestRise.rate).toLocaleString()}%`
    });
  }

  if (biggestDrop) {
    highlights.push({
      label: '최대 감소',
      value: `${biggestDrop.from.slice(5)} → ${biggestDrop.to.slice(5)}`,
      amount: biggestDrop.diff,
      meta: biggestDrop.rate === null ? '비교 없음' : `${Math.round(biggestDrop.rate).toLocaleString()}%`
    });
  }

  const messages = [];
  if (concentrationRate >= 60) {
    messages.push({
      tone: 'warning',
      title: '특정 일자 매출 집중',
      body: `${maxDay.date.slice(5)} 하루가 전체 매출의 ${Math.round(concentrationRate).toLocaleString()}%를 차지합니다. 행사, 단체 주문, 입력 몰림 여부를 확인해보세요.`
    });
  } else {
    messages.push({
      tone: 'success',
      title: '매출 분포',
      body: `최고 매출일 비중은 ${Math.round(concentrationRate).toLocaleString()}%입니다. 특정 일자에 과도하게 몰린 흐름은 아닙니다.`
    });
  }

  if (recentSevenAverage > 0) {
    const trendText = recentAverageRate === null
      ? '이전 7일과 비교할 데이터가 아직 부족합니다.'
      : `이전 7일 영업평균 대비 ${Math.abs(Math.round(recentAverageRate)).toLocaleString()}% ${recentAverageDiff >= 0 ? '상승' : '하락'}했습니다.`;
    messages.push({
      tone: recentAverageDiff === null ? 'neutral' : recentAverageDiff >= 0 ? 'success' : 'warning',
      title: '7일 평균선',
      body: `최근 7일 영업평균은 ${recentSevenAverage.toLocaleString()}원입니다. ${trendText}`
    });
  }

  if (sameWeekdayDay && sameWeekdayRate !== null) {
    messages.push({
      tone: sameWeekdayDiff >= 0 ? 'success' : 'warning',
      title: '동요일 비교',
      body: `${latestActiveDay.date.slice(5)} 매출은 직전 같은 요일(${sameWeekdayDay.date.slice(5)}) 대비 ${Math.abs(Math.round(sameWeekdayRate)).toLocaleString()}% ${sameWeekdayDiff >= 0 ? '증가' : '감소'}했습니다. 요일 패턴 변화로 보기 좋습니다.`
    });
  }

  if (biggestDrop?.rate <= -40) {
    messages.push({
      tone: 'danger',
      title: '급락 구간',
      body: `${biggestDrop.from.slice(5)}에서 ${biggestDrop.to.slice(5)}로 이동하며 매출이 ${Math.abs(Math.round(biggestDrop.rate)).toLocaleString()}% 감소했습니다. 휴무, 날씨, 입력 누락을 같이 확인하면 좋습니다.`
    });
  }

  if (biggestRise?.rate >= 50) {
    messages.push({
      tone: 'success',
      title: '급증 구간',
      body: `${biggestRise.from.slice(5)}에서 ${biggestRise.to.slice(5)}로 매출이 ${Math.round(biggestRise.rate).toLocaleString()}% 증가했습니다. 해당일 적요 TOP 항목과 같이 보면 원인을 찾기 쉽습니다.`
    });
  }

  if (trailingEmptyDays > 0) {
    messages.push({
      tone: 'warning',
      title: '최근 입력 공백',
      body: `${activeRows[activeRows.length - 1].date.slice(5)} 이후 ${trailingEmptyDays.toLocaleString()}일 동안 매출 입력이 없습니다. 아직 영업 전인지, 입력이 빠졌는지 확인해보세요.`
    });
  }

  if (ticketRate !== null && Math.abs(ticketRate) >= 20) {
    const direction = ticketDiff >= 0 ? '상승' : '하락';
    messages.push({
      tone: ticketDiff >= 0 ? 'success' : 'warning',
      title: '객단가 변화',
      body: `첫 입력일 대비 마지막 입력일 객단가가 ${Math.abs(Math.round(ticketRate)).toLocaleString()}% ${direction}했습니다. 방문 인원 변화와 함께 보면 판매 단가 흐름을 볼 수 있습니다.`
    });
  }

  if (cardMissingDays >= Math.ceil(activeRows.length * 0.6)) {
    messages.push({
      tone: 'warning',
      title: '카드 매출 확인',
      body: `매출이 있는 ${cardMissingDays.toLocaleString()}일에 카드 매출이 0원입니다. 카드 결제가 실제로 없었는지 입력 누락인지 확인해보세요.`
    });
  }

  if (cashMissingDays >= Math.ceil(activeRows.length * 0.6)) {
    messages.push({
      tone: 'warning',
      title: '현금 매출 확인',
      body: `매출이 있는 ${cashMissingDays.toLocaleString()}일에 현금 매출이 0원입니다. 현금 입력 방식이 일관적인지 확인해보세요.`
    });
  }

  if (expenseHeavyDays.length > 0) {
    messages.push({
      tone: 'danger',
      title: '지출 비중 높은 날',
      body: `${expenseHeavyDays[0].date.slice(5)} 지출이 매출 대비 30% 이상입니다. 재료비, 기타 지출 메모를 함께 확인하면 좋습니다.`
    });
  }

  return {
    badges,
    highlights: highlights.slice(0, 5),
    messages: messages.slice(0, 6)
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
    if (signals.weekday.best.recentFourAverage > 0) {
      messages.push(`최근 4회 기준 ${signals.weekday.best.name} 평균은 ${signals.weekday.best.recentFourAverage.toLocaleString()}원입니다.`);
    }
    if (signals.weekday.best.topDescription) {
      messages.push(`${signals.weekday.best.name} TOP 적요는 "${signals.weekday.best.topDescription.description}"이며 ${signals.weekday.best.topDescription.total.toLocaleString()}원입니다.`);
    }
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
