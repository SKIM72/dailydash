-- AI 월간 리포트: Gemini 가 쓴 해석을 저장해 같은 데이터로는 다시 호출하지 않는다. (무료 사용량 절약)
CREATE TABLE ai_reports (
  id BIGSERIAL PRIMARY KEY,
  report_month TEXT NOT NULL CHECK (report_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  data_through DATE NOT NULL,          -- 집계 마지막 날 (진행 중인 달은 만든 날)
  input_digest TEXT NOT NULL,          -- AI 에 보낸 집계의 SHA-256 (같으면 저장된 리포트를 그대로 쓴다)
  input_facts JSONB NOT NULL,          -- AI 에 보낸 집계 그대로 (근거 확인용)
  content JSONB NOT NULL,              -- AI 가 쓴 리포트 (headline, summary, positives, cautions, nextActions)
  model TEXT NOT NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_reports_month_idx ON ai_reports (report_month, created_at DESC);
CREATE INDEX ai_reports_digest_idx ON ai_reports (input_digest);
