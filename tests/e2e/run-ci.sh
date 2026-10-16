#!/usr/bin/env bash
# E2E 실행기 (CI·로컬 공용)
# 빈 Postgres(DATABASE_URL) → 마이그레이션 → 시험 데이터 → 관리자 → 가짜 Gemini + 서버 기동 → E2E 실행 → 정리
# 화면은 미리 빌드(npm run build)되어 있어야 한다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
: "${DATABASE_URL:?DATABASE_URL 이 필요합니다 (빈 시험용 DB)}"
PORT="${E2E_PORT:-3100}"
MOCK_PORT="${MOCK_GEMINI_PORT:-4999}"
export BASE="${BASE:-http://127.0.0.1:${PORT}}"
export MOCK_GEMINI="http://127.0.0.1:${MOCK_PORT}"
export E2E_ADMIN_EMAIL="${E2E_ADMIN_EMAIL:-admin@dailydash.test}"
export E2E_ADMIN_PASSWORD="${E2E_ADMIN_PASSWORD:-adminpass1}"

PIDS=()
cleanup() { for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT

cd "$ROOT/server"
node --input-type=module -e "
  import { readFileSync } from 'node:fs';
  const { pool, runMigrations, waitForDatabase } = await import('./src/db.js');
  await waitForDatabase();
  await runMigrations();
  await pool.query(readFileSync('../tests/e2e/seed.sql', 'utf8'));
  await pool.end();
  console.log('[e2e] 마이그레이션 · 시험 데이터 준비 완료');
"
node scripts/create-admin.js "$E2E_ADMIN_EMAIL" "$E2E_ADMIN_PASSWORD"

MOCK_GEMINI_PORT="$MOCK_PORT" node "$ROOT/tests/e2e/mock-gemini.mjs" &
PIDS+=($!)

PORT="$PORT" HOST=127.0.0.1 STATIC_DIR="$ROOT/dist" ADMIN_EMAIL="$E2E_ADMIN_EMAIL" COOKIE_SECURE=false \
  GEMINI_API_KEY=test-key GEMINI_API_BASE="http://127.0.0.1:${MOCK_PORT}/v1beta" DISABLE_SCHEDULERS=1 \
  node src/index.js &
PIDS+=($!)

for i in $(seq 1 30); do
  curl -fsS "$BASE/api/health" >/dev/null 2>&1 && break
  sleep 1
done

cd "$ROOT"
status=0
for spec in ${E2E_SPECS:-app ai features}; do
  node "tests/e2e/${spec}.e2e.mjs" || status=1
done
exit "$status"
