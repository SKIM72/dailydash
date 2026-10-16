import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forecastMonthEnd } from '../src/forecast.js';

test('작년 같은 달 흐름 비율로 마감을 예상한다', () => {
  const result = forecastMonthEnd({
    salesToDate: 1_000_000, operatingDaysToDate: 8, elapsedDays: 17, daysInMonth: 31,
    lastYearSalesToDate: 1_000_000, lastYearSalesFullMonth: 2_000_000
  });
  assert.equal(result.method, 'last-year');
  assert.equal(result.sales, 2_000_000);
  assert.equal(result.remainingDays, 14);
});

test('작년 자료가 없으면 지금까지 영업일 평균으로 예상한다', () => {
  const result = forecastMonthEnd({ salesToDate: 800_000, operatingDaysToDate: 8, elapsedDays: 16, daysInMonth: 30 });
  // 영업일 평균 10만원 × 영업 비율 0.5 × 남은 14일 = 70만원
  assert.equal(result.method, 'run-rate');
  assert.equal(result.sales, 1_500_000);
  assert.equal(result.expectedOperatingDays, 7);
});

test('작년 초반 매출이 거의 없어 비율이 지나치면 영업일 평균을 쓴다', () => {
  const result = forecastMonthEnd({
    salesToDate: 500_000, operatingDaysToDate: 5, elapsedDays: 10, daysInMonth: 31,
    lastYearSalesToDate: 10_000, lastYearSalesFullMonth: 3_000_000
  });
  assert.equal(result.method, 'run-rate');
});

test('매출이 없거나 마지막 날이면 그에 맞게 답한다', () => {
  assert.equal(forecastMonthEnd({ salesToDate: 0, operatingDaysToDate: 0, elapsedDays: 5, daysInMonth: 30 }), null);
  assert.deepEqual(forecastMonthEnd({ salesToDate: 900, operatingDaysToDate: 3, elapsedDays: 30, daysInMonth: 30 }), { sales: 900, method: 'actual', remainingDays: 0 });
});
