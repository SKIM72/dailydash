# DailyDash 운영 반영 체크리스트

1. Supabase에서 `transactions`, `daily_notes`, `user_approvals`를 먼저 백업합니다.
2. 운영 배포 전에는 새 작업본으로 로그인, 조회, 입력, 소프트 삭제, 엑셀 다운로드를 각각 한 번씩 검증합니다.
3. 프론트엔드에서는 삭제 보관 데이터를 물리 삭제하지 않습니다.
4. Supabase RLS 정책에서 승인 사용자만 `transactions`와 `daily_notes`에 접근 가능한지 확인합니다.
5. 운영 배포 후 서비스워커 캐시가 남아 있으면 브라우저 새로고침 또는 앱 재설치를 안내합니다.
