// 적요(품목 이름) 정리 규칙: 묶음 추천 키, 결제수단처럼 보이는 적요, 대표 이름 적용 SQL
export const NOT_AN_ITEM = '(품목 아님)';

// 결제수단·메모처럼 품목이 아닌 적요
const NON_ITEM_WORDS = new Set(['카드', '현금', '계좌', '이체', '계좌이체', '카드결제', '현금결제', '기타', '메모']);

// "돌배즙 판매", "돌배즙외 판매", "돌배즙 외" → "돌배즙"
export function suggestionKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()[\]·.,!~'"]/g, '')
    .replace(/(판매|외|등)+$/u, '');
}

export function looksLikeNonItem(name) {
  return NON_ITEM_WORDS.has(String(name || '').replace(/\s+/g, ''));
}

// transactions(t) 의 적요를 대표 이름으로 바꾼 식. description_aliases(a) 를 LEFT JOIN 해서 쓴다.
export const CANONICAL_SQL = 'COALESCE(a.canonical, btrim(t.description))';
export const ALIAS_JOIN_SQL = 'LEFT JOIN description_aliases a ON a.alias = btrim(t.description)';
