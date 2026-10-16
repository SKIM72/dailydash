import assert from 'node:assert/strict';
import { test } from 'node:test';
import { looksLikeNonItem, suggestionKey } from '../src/descriptions.js';

test('같은 상품을 다르게 적은 적요는 같은 추천 키를 갖는다', () => {
  const key = suggestionKey('돌배즙');
  for (const name of ['돌배즙 판매', '돌배즙외 판매', '돌배즙 외 판매', '돌배즙 외', ' 돌배즙  ']) {
    assert.equal(suggestionKey(name), key, name);
  }
});

test('여러 품목을 함께 적은 적요는 따로 둔다', () => {
  assert.notEqual(suggestionKey('비트즙,돌배즙 판매'), suggestionKey('돌배즙'));
  assert.notEqual(suggestionKey('돌배청 판매'), suggestionKey('돌배즙'));
});

test('결제수단·메모처럼 보이는 적요를 알아본다', () => {
  assert.equal(looksLikeNonItem('카드'), true);
  assert.equal(looksLikeNonItem(' 현금 '), true);
  assert.equal(looksLikeNonItem('계좌 이체'), true);
  assert.equal(looksLikeNonItem('돌배즙'), false);
});

test('성수기는 지난 해들의 월평균이 큰 3개월이다', async () => {
  const { findSeason } = await import('../src/descriptions.js');
  const months = {
    2024: [5, 5, 50, 5, 5, 90, 5, 5, 5, 5, 5, 40],
    2025: [5, 5, 70, 5, 5, 80, 5, 5, 5, 5, 5, 30],
    2026: [5, 5, 99, 5, 5, 0, 0, 0, 0, 0, 0, 0]
  };
  const { peakMonths, seasonTotals } = findSeason(months, [2024, 2025, 2026], 2026);
  assert.deepEqual(peakMonths, [3, 6, 12]);
  assert.equal(seasonTotals[2025], 70 + 80 + 30);
  assert.equal(seasonTotals[2026], 99);
});
