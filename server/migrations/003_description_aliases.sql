-- 적요 묶기: 같은 상품을 다르게 적은 적요("돌배즙 판매", "돌배즙외 판매")를 대표 이름("돌배즙")으로 묶는다.
-- 원본 내역은 바꾸지 않고, 분석·자동완성에서만 대표 이름을 쓴다. 대표 이름이 '(품목 아님)' 이면 품목 분석에서 뺀다.
CREATE TABLE description_aliases (
  alias TEXT PRIMARY KEY CHECK (alias = btrim(alias) AND alias <> ''),
  canonical TEXT NOT NULL CHECK (canonical = btrim(canonical) AND canonical <> ''),
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (alias <> canonical)
);
CREATE INDEX description_aliases_canonical_idx ON description_aliases (canonical);
