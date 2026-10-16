// 이번 달 마감 매출 예상 - 화면(월간 요약)과 AI 리포트가 같은 계산을 쓰도록 한 곳에 둔다.
// 1) 작년 같은 달의 흐름: 지금까지 매출 × (작년 그달 전체 ÷ 작년 같은 기간)
// 2) 작년 자료가 없거나 비율이 지나치게 크면(작년 초반 매출이 거의 없던 경우): 지금까지 영업일 평균 × 남은 기간의 예상 영업일
const MAX_SEASON_RATIO = 6;

export function forecastMonthEnd({
  salesToDate,
  operatingDaysToDate,
  elapsedDays,
  daysInMonth,
  lastYearSalesToDate = 0,
  lastYearSalesFullMonth = 0
}) {
  if (!(salesToDate > 0) || !(elapsedDays > 0)) return null;
  const remainingDays = Math.max(0, daysInMonth - elapsedDays);
  if (remainingDays === 0) return { sales: salesToDate, method: 'actual', remainingDays };

  const ratio = lastYearSalesToDate > 0 && lastYearSalesFullMonth > 0 ? lastYearSalesFullMonth / lastYearSalesToDate : null;
  if (ratio !== null && ratio <= MAX_SEASON_RATIO) {
    return { sales: Math.round(salesToDate * ratio), method: 'last-year', ratio: Math.round(ratio * 100) / 100, remainingDays };
  }

  const perOperatingDay = operatingDaysToDate > 0 ? salesToDate / operatingDaysToDate : 0;
  const operatingRate = operatingDaysToDate / elapsedDays;
  return {
    sales: Math.round(salesToDate + perOperatingDay * operatingRate * remainingDays),
    method: 'run-rate',
    expectedOperatingDays: Math.round(operatingRate * remainingDays),
    remainingDays
  };
}

export const FORECAST_METHOD_LABELS = {
  'last-year': '작년 같은 달 흐름 기준',
  'run-rate': '지금까지 영업일 평균 기준',
  actual: '마감'
};
