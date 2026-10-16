# E2E 테스트

GitHub 에 push 하면 `CI` 워크플로의 `e2e` 작업이 자동으로 돌립니다. 실패하면 화면 캡처가 Actions 결과물(e2e-screenshots)로 남습니다.

| 파일 | 내용 |
| --- | --- |
| `app.e2e.mjs` | 로그인 · 입력/수정/삭제 · 월간/통계 · 권한 · 모바일 · PWA · 앱 다운로드 |
| `ai.e2e.mjs` | AI 월간 리포트 (가짜 Gemini 서버) |
| `features.e2e.mjs` | 적요 묶기 · 자동완성 · 월말 예상 · 품목 시즌 · 오프라인 입력 · 마감 입력 알림 · AI 자동 생성 |
| `seed.sql` | 오늘 기준 시험 데이터 (올해 · 작년) |
| `mock-gemini.mjs` | 가짜 Gemini · 가짜 웹 푸시 서버 |
| `run-ci.sh` | 빈 DB → 마이그레이션 → 시험 데이터 → 서버 기동 → 테스트 |

## 내 PC 에서 돌리기

빈 Postgres 와 빌드된 화면이 필요합니다.

```bash
docker run -d --name dailydash-test-pg -e POSTGRES_USER=dailydash -e POSTGRES_PASSWORD=testpass \
  -e POSTGRES_DB=dailydash -p 127.0.0.1:55432:5432 postgres:17-alpine
npm run build
DATABASE_URL=postgres://dailydash:testpass@127.0.0.1:55432/dailydash \
  E2E_BROWSER_CHANNEL=msedge npm run test:e2e        # 설치된 Edge 사용 (CI 는 Chromium)
docker rm -f dailydash-test-pg                       # 다 쓰면 정리
```

일부만 돌리려면 `E2E_SPECS="features"` 처럼 지정합니다. 서버의 순수 함수 테스트는 `npm --prefix server test` 입니다.
