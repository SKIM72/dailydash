-- DailyDash 자체 서버 초기 스키마
-- Supabase의 auth.users + user_approvals 를 users 테이블 하나로 합쳤다.

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY, -- 세션 토큰의 SHA-256 해시 (원본 토큰은 쿠키에만 존재)
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE TABLE transactions (
  id BIGSERIAL PRIMARY KEY,
  transaction_date DATE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  customer_count INTEGER NOT NULL DEFAULT 0 CHECK (customer_count >= 0),
  cash_income BIGINT NOT NULL DEFAULT 0 CHECK (cash_income >= 0),
  cash_expense BIGINT NOT NULL DEFAULT 0 CHECK (cash_expense >= 0),
  card_income BIGINT NOT NULL DEFAULT 0 CHECK (card_income >= 0),
  remark1 TEXT NOT NULL DEFAULT '',
  remark2 TEXT NOT NULL DEFAULT '',
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
CREATE INDEX transactions_active_date_idx ON transactions (transaction_date) WHERE deleted_at IS NULL;

CREATE TABLE daily_notes (
  note_date DATE PRIMARY KEY,
  special_note TEXT NOT NULL DEFAULT '',
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 기존에는 브라우저 localStorage 에만 남던 작업 이력을 서버에 영구 보관한다.
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT,
  action TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  details JSONB NOT NULL DEFAULT '[]'::jsonb,
  snapshot JSONB
);
CREATE INDEX audit_logs_at_idx ON audit_logs (at DESC);
CREATE INDEX audit_logs_user_idx ON audit_logs (user_id, at DESC);

-- Supabase 시절과 같은 컬럼 구성을 유지해 프론트 집계 로직을 그대로 쓴다.
CREATE VIEW v_daily_sales_summary AS
SELECT
  transaction_date,
  COUNT(*)::int AS row_count,
  COALESCE(SUM(customer_count), 0)::bigint AS total_people,
  COALESCE(SUM(cash_income), 0)::bigint AS total_cash,
  COALESCE(SUM(card_income), 0)::bigint AS total_card,
  COALESCE(SUM(cash_expense), 0)::bigint AS total_expense,
  COALESCE(SUM(cash_income + card_income), 0)::bigint AS total_sales,
  COALESCE(SUM(cash_income + card_income - cash_expense), 0)::bigint AS net_sales,
  CASE
    WHEN COALESCE(SUM(customer_count), 0) > 0
      THEN ROUND(SUM(cash_income + card_income)::numeric / SUM(customer_count))::bigint
    ELSE 0
  END AS average_ticket
FROM transactions
WHERE deleted_at IS NULL
GROUP BY transaction_date;
