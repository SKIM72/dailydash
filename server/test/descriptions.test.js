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
