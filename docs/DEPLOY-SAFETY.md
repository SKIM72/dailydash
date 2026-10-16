# DailyDash 운영 반영 체크리스트

1. 반영 전에 DB 를 백업합니다.
   `docker compose exec backup sh -c 'pg_dump --no-owner | gzip > /backups/dailydash-before-deploy.sql.gz'`
2. 운영 반영 전에는 내 PC(또는 테스트 서버)에서 로그인, 조회, 입력, 수정, 삭제·되돌리기, 엑셀 다운로드를 각각 한 번씩 검증합니다.
   GitHub 에 push 하면 `CI` 워크플로가 빌드와 서버 기동을 자동으로 검사하니 초록색인지 확인합니다.
3. 정산 내역은 화면에서도 서버에서도 물리 삭제하지 않습니다. (`deleted_at` 보관 → 되돌리기 가능)
4. 권한은 서버가 검사합니다. 수정·삭제·복원·사용자 관리·엑셀 백업 이력은 관리자(`role = admin`)만 가능하며,
   승인되지 않은(`pending`)·사용 중지된(`disabled`) 계정은 어떤 데이터에도 접근할 수 없습니다.
5. 반영 후 `docker compose ps` 로 app 이 `healthy` 인지, `docker compose logs --tail 50 app` 에 오류가 없는지 확인합니다.
6. 화면을 바꿔 배포할 때는 `public/sw.js` 의 `CACHE_NAME` 을 올립니다. 열려 있던 앱에 새로고침 안내가 뜹니다.
   그래도 옛 화면이 보이면 앱을 완전히 닫았다가 다시 열도록 안내합니다.

전체 운영 방법은 [SERVER-SETUP.md](SERVER-SETUP.md) 를 참고하세요.
