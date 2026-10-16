-- E2E 시험 데이터: 오늘 기준 최근 약 11주(월요일 휴무)와 작년 같은 시기(월·화 휴무).
-- 같은 상품을 다르게 적은 적요("돌배즙"/"돌배즙 판매"/"돌배즙외 판매")와 결제수단 적요("카드")도 섞어 둔다.
WITH items(name, price) AS (VALUES
  ('미숫가루', 5000), ('돌배즙', 6000), ('돌배즙 판매', 6000), ('식혜', 4000),
  ('대추차', 5500), ('쌍화차', 6500), ('돌배즙외 판매', 6000), ('오미자차', 6000)
),
numbered AS (SELECT name, price, row_number() OVER () AS n FROM items),
days AS (
  SELECT d::date AS day FROM generate_series((now() AT TIME ZONE 'Asia/Seoul')::date - 76, (now() AT TIME ZONE 'Asia/Seoul')::date - 1, interval '1 day') d
  WHERE extract(dow FROM d) <> 1
),
rows AS (SELECT day, g FROM days, generate_series(1, 3 + abs(hashtext(day::text)) % 7) g)
INSERT INTO transactions (transaction_date, description, customer_count, cash_income, card_income, cash_expense, remark1, remark2, created_at)
SELECT r.day, i.name, c.n,
       CASE WHEN r.g % 2 = 0 THEN i.price * c.n ELSE 0 END,
       CASE WHEN r.g % 2 = 1 THEN (i.price + 500) * c.n ELSE 0 END,
       CASE WHEN abs(hashtext(r.day::text || 'e')) % 15 = 0 AND r.g = 1 THEN 10000 ELSE 0 END,
       CASE WHEN r.g = 2 AND abs(hashtext(r.day::text)) % 9 = 0 THEN '단체' ELSE '' END,
       '',
       r.day + interval '9 hours' + r.g * interval '37 minutes'
FROM rows r
JOIN numbered i ON i.n = 1 + abs(hashtext(r.day::text || r.g::text)) % 8
CROSS JOIN LATERAL (SELECT 1 + abs(hashtext(r.day::text || r.g::text || 'c')) % 4 AS n) c;

-- 작년 같은 시기 (전년 비교 · 월말 예상 · 시즌 비교용)
WITH days AS (
  SELECT d::date AS day
  FROM generate_series(((now() AT TIME ZONE 'Asia/Seoul')::date - interval '1 year')::date - 76, ((now() AT TIME ZONE 'Asia/Seoul')::date - interval '1 year')::date + 45, interval '1 day') d
  WHERE extract(dow FROM d) NOT IN (1, 2)
),
rows AS (SELECT day, g FROM days, generate_series(1, 4 + abs(hashtext(day::text)) % 6) g)
INSERT INTO transactions (transaction_date, description, customer_count, cash_income, card_income, cash_expense, remark1, remark2, created_at)
SELECT r.day,
       (ARRAY['미숫가루', '돌배즙', '식혜', '대추차'])[1 + abs(hashtext(r.day::text || r.g::text)) % 4],
       c.n,
       CASE WHEN r.g % 2 = 0 THEN 5000 * c.n ELSE 0 END,
       CASE WHEN r.g % 2 = 1 THEN 5500 * c.n ELSE 0 END,
       0, '', '',
       r.day + interval '9 hours' + r.g * interval '37 minutes'
FROM rows r
CROSS JOIN LATERAL (SELECT 1 + abs(hashtext(r.day::text || r.g::text || 'c')) % 4 AS n) c;

-- 이번 달 1일: 상세 모달 확인용 미숫가루 + 개인정보(비고) 제외 확인용 이름 + 결제수단 적요
INSERT INTO transactions (transaction_date, description, customer_count, cash_income, card_income, remark2)
VALUES (date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul')::date)::date, '미숫가루', 3, 15000, 12000, '홍길동'),
       (date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul')::date)::date, '카드', 0, 0, 8000, '');
