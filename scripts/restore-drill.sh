#!/usr/bin/env bash
# 백업 복구 연습 (서버의 ~/dailydash 에서 실행): bash scripts/restore-drill.sh
# 가장 최근 백업 파일을 격리된 임시 DB(네트워크 없음)에 실제로 되살려, 운영 DB 와 건수·합계를 비교한다.
# 운영 DB 는 읽기만 하고, 임시 DB 는 끝나면 지운다. (다른 프로젝트 컨테이너는 건드리지 않는다)
set -euo pipefail
cd "${DAILYDASH_DIR:-$(dirname "$0")/..}"

NAME=dailydash-restore-drill
latest=$(docker compose exec -T backup sh -c 'ls -1t /backups/dailydash-*.sql.gz | head -1' </dev/null | tr -d '\r')
[ -n "$latest" ] || { echo "백업 파일이 없습니다."; exit 1; }
echo "[복구 연습] 사용할 백업: $latest"

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --network none --memory 256m \
  -e POSTGRES_USER=dailydash -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=dailydash \
  --tmpfs /var/lib/postgresql/data postgres:17-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U dailydash -d dailydash >/dev/null 2>&1 && break
  sleep 1
done
sleep 2

docker compose exec -T backup sh -c "cat '$latest'" </dev/null | gunzip \
  | docker exec -i "$NAME" psql -q -U dailydash -d dailydash -v ON_ERROR_STOP=1 >/dev/null
echo "[복구 연습] 임시 DB 로 되살리기 성공"

QUERY="SELECT 'transactions', COUNT(*), COALESCE(SUM(cash_income + card_income), 0), COALESCE(MAX(transaction_date)::text, '-') FROM transactions WHERE deleted_at IS NULL
UNION ALL SELECT 'users', COUNT(*), 0, '-' FROM users
UNION ALL SELECT 'daily_notes', COUNT(*), 0, COALESCE(MAX(note_date)::text, '-') FROM daily_notes"
restored=$(docker exec "$NAME" psql -U dailydash -d dailydash -At -F ' | ' -c "$QUERY")
live=$(docker compose exec -T db psql -U dailydash -d dailydash -At -F ' | ' -c "$QUERY" </dev/null)

echo
echo "표            | 건수 | 매출 합계 | 마지막 날짜"
echo "[되살린 백업]"; echo "$restored"
echo "[운영 DB]";     echo "$live"
echo
if [ "$restored" = "$live" ]; then
  echo "결과: 일치 - 백업으로 운영 데이터를 그대로 되살릴 수 있습니다."
else
  echo "결과: 차이 있음 - 백업 뒤에 새로 입력된 내역이 있으면 정상입니다. 백업 시각과 마지막 날짜를 확인하세요."
fi
