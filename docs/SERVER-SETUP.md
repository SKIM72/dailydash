# DailyDash 자체 서버 운영 가이드

화면은 지금처럼 **GitHub Pages** 에서 띄우고, 데이터(API + DB)는 **집 PC 서버**에서 처리하는 구성입니다.
Supabase 는 쓰지 않습니다. 위에서부터 순서대로 따라 하면 됩니다.

```
휴대폰/PC 브라우저
   │ ① 화면:  https://skim72.github.io/dailydash/        (GitHub Pages)
   │ ② 데이터: https://dailydash.duckdns.org/api/...      (DuckDNS → 집 공인 IP, 공유기 포트포워딩 80/443)
   ▼
┌──────────────────────── 집 PC (192.168.0.11) ──────────────────────────┐
│  Caddy  : HTTPS 인증서 자동 발급·갱신 (neulremote 프로젝트의 공용 Caddy) │
│    │      dailydash.duckdns.org → dailydash-app:3000                     │
│  app    : API (Node.js) ── 로그인, 권한 검사, 작업 이력                   │
│    │                                                                    │
│  db     : PostgreSQL (SSD, dailydash_pgdata 볼륨)                        │
│  backup : 매일 DB 백업 → 1TB 하드 (30일 보관)                             │
│  duckdns: 공인 IP 가 바뀌면 dailydash.duckdns.org 를 자동 갱신             │
└────────────────────────────────────────────────────────────────────────┘
```

**왜 API 도 HTTPS 여야 하나요?** GitHub Pages 는 https 라서, 브라우저는 그 화면이 http 주소를 호출하는 것을 차단합니다.
DuckDNS 주소에 대해 Caddy 가 Let's Encrypt 인증서를 자동으로 받아 갱신합니다.
(도메인 없이 공인 IP 로도 인증서를 받을 수 있지만, 이 서버는 공용 Caddy 를 쓰므로 DuckDNS 방식을 택했습니다)

**로그인은 어떻게 유지되나요?** github.io 와 집 서버는 서로 다른 사이트라 아이폰 Safari 가 쿠키를 막습니다.
그래서 이 구성에서는 로그인 토큰을 브라우저에 저장해 요청마다 보냅니다(기존 Supabase 와 같은 방식). 서버 쪽 세션이라
로그아웃·비밀번호 변경·사용 중지 시 즉시 무효화됩니다.

---

## 0. 준비물

- 24시간 켜둘 집 PC (Ubuntu 22.04 / 24.04 권장, RAM 1GB·디스크 10GB 이상)
- 공유기 포트포워딩: TCP **80, 443** → 집 PC 내부 IP (예: `192.168.0.11`)
  - 80 은 인증서 발급 확인용, 443 은 실제 접속용입니다. 둘 다 필요합니다.
  - 집 PC 내부 IP 가 바뀌지 않도록 공유기에서 "고정 IP 할당(DHCP 예약)"을 해 두세요.
- 공인 IP 확인: 서버에서 `curl https://api.ipify.org`

## 1. Docker 설치 (Ubuntu 기준)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# 로그아웃 후 다시 로그인한 뒤 확인
docker compose version
```

> **다른 프로젝트와 같은 서버를 쓰는 경우**: DailyDash 는 프로젝트 이름 `dailydash` 로 컨테이너·네트워크·볼륨이 분리되고,
> DB 포트는 열지 않으며, 앱은 서버 내부(`127.0.0.1:3780`)에만 열립니다. 메모리 상한(DB 512MB, 앱 256MB)도 걸려 있습니다.
> 다른 프로젝트를 건드리는 명령(`docker system prune`, 다른 컨테이너 재시작 등)은 이 가이드에서 쓰지 않습니다.

## 2. 코드 받기 & 설정 파일 작성

```bash
git clone https://github.com/<내계정>/<저장소이름>.git ~/dailydash
cd ~/dailydash
cp .env.example .env
nano .env
```

| 항목 | 예시 | 설명 |
|---|---|---|
| `DOMAIN` | `dailydash.duckdns.org` | API 주소 (공인 IP 를 직접 써도 됨) |
| `ALLOWED_ORIGINS` | `https://skim72.github.io` | GitHub Pages 주소의 **출처만** (경로 없이) |
| `APP_URL` | `https://skim72.github.io/dailydash` | 화면 주소 (비밀번호 재설정 메일 링크용) |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` 결과 | DB 비밀번호. 길고 무작위로 |
| `ADMIN_EMAIL` | `eowert72@gmail.com` | 이 계정이 관리자 권한을 받음 |
| `APP_HOST_PORT` | `3780` | 서버 내부에서 앱이 쓰는 포트(점검용). 다른 프로그램이 쓰고 있으면 변경 |
| `BACKUP_DIR` | `/srv/neulremote-data/dailydash-backups` | 백업 위치. DB(SSD)와 다른 디스크 권장 |
| `COMPOSE_FILE` / `PROXY_NETWORK` | 3-1절 참고 | 공용 Caddy 와 연결할 때 |
| `COMPOSE_PROFILES` | `duckdns` | DuckDNS 자동 갱신 켜기 |
| `DUCKDNS_SUBDOMAIN` / `DUCKDNS_TOKEN` | `dailydash` / duckdns.org 화면의 token | |

> `.env` 에는 비밀번호가 들어갑니다. GitHub 에 올리지 마세요. (`.gitignore` 에 이미 제외되어 있습니다)

## 3. 실행

```bash
docker compose up -d --build
docker compose ps                          # app(healthy), db(healthy), backup 이 Up 이면 정상
curl http://127.0.0.1:3780/api/health       # {"ok":true,...}
```

## 3-1. HTTPS 연결 (둘 중 하나)

**A. 같은 서버의 다른 프로젝트 Caddy 를 함께 쓰는 경우** (현재 집 서버: neulremote 의 Caddy)

DuckDNS 등 DailyDash 전용 주소를 만들고, `.env` 에 아래를 넣으면 앱 컨테이너만 그 Caddy 의 Docker 네트워크에
`dailydash-app` 이라는 이름으로 참여합니다. (DB·백업은 DailyDash 전용 네트워크에만 있음)

```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.shared-proxy.yml
PROXY_NETWORK=neulremote_default
```

그다음 그 Caddy 설정 파일 **맨 끝에 사이트 블록 하나만 추가**합니다. 기존 사이트 블록은 건드리지 않습니다.
(그 Caddy 를 관리하는 쪽과 합의한 뒤 진행하세요)

```caddyfile
# DailyDash managed domain: dailydash.duckdns.org
dailydash.duckdns.org {
	encode zstd gzip
	reverse_proxy dailydash-app:3000
}
```

1. 수정 전 원본을 날짜를 붙여 복사해 둡니다.
2. 파일을 통째로 바꾸지 말고 **끝에 덧붙입니다**(`>>`). 컨테이너에 파일 하나만 연결된 경우, 파일을 새로 만들면 컨테이너가 변경을 못 봅니다.
3. `docker exec <caddy컨테이너> caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` 로 검사합니다.
4. 통과하면 `docker exec <caddy컨테이너> caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile` 로 반영합니다(무중단, 설정이 틀리면 기존 설정 유지).
5. 반영 전후로 기존 서비스의 상태 확인 주소가 똑같이 응답하는지 비교합니다.

**B. 80/443 을 DailyDash 혼자 쓰는 서버** — `.env` 에 `COMPOSE_PROFILES=caddy` 를 넣고 `docker compose up -d` 하면
포함된 Caddy 가 인증서를 받아 연결합니다. (`docker compose logs -f caddy` 에서 "certificate obtained successfully" 확인)

어느 쪽이든 휴대폰 LTE(와이파이 끄고)로 `https://dailydash.duckdns.org/api/health` 접속 → `{"ok":true,...}` 가 보이면 성공입니다.

> **아직 회원가입하지 마세요.** 다음 단계에서 Supabase 의 기존 계정을 그대로 옮겨옵니다.

## 4. Supabase 데이터 옮기기

기존 계정의 **비밀번호 해시까지 그대로** 옮기므로, 모든 사용자가 쓰던 비밀번호로 바로 로그인할 수 있습니다.
옮기는 것: 사용자/가입 승인 상태, 정산 내역(삭제 보관분 포함), 일일 특기사항.

### 4-1. Supabase 접속 주소 복사

1. Supabase 대시보드 → DailyDash 프로젝트 → 상단 **Connect** 버튼
2. **Session pooler** 항목의 주소를 복사
   `postgresql://postgres.lbwlodnguwuudbbaqmuz:[YOUR-PASSWORD]@aws-0-<지역>.pooler.supabase.com:5432/postgres` 형태
3. `[YOUR-PASSWORD]` 를 DB 비밀번호로 바꿉니다.
   - 기억나지 않으면: Project Settings → Database → **Reset database password**
   - 비밀번호에 `@ # / ?` 같은 특수문자가 있으면 오류가 나므로, 영문+숫자 비밀번호로 재설정하는 것이 편합니다.

> "Direct connection" 주소(`db.xxx.supabase.co`)는 IPv6 전용이라 대부분의 집 인터넷에서 연결되지 않습니다. 꼭 **Session pooler** 를 쓰세요.

### 4-2. 먼저 검증만 (저장하지 않음)

```bash
cd ~/dailydash
docker compose exec -e SUPABASE_DB_URL='위에서 만든 주소' app \
  node scripts/migrate-from-supabase.js --dry-run
```

마지막에 `✔ 건수 / 현금 수입 / 카드 수입 / 현금 지출 / 인원` 이 모두 일치하고 **검증 완료 - 문제 없음** 이 나오면 됩니다.
`!` 로 시작하는 줄은 참고용 경고입니다(옮기지 않는 컬럼, 계정 없는 승인 명단 등).

### 4-3. 실제 이전

```bash
docker compose exec -e SUPABASE_DB_URL='위에서 만든 주소' app \
  node scripts/migrate-from-supabase.js
```

합계가 하나라도 다르면 스크립트가 **자동으로 취소**하고 아무것도 저장하지 않습니다.

> 이전 후에 Supabase 쪽에 입력이 더 생겼다면 `--force` 를 붙여 다시 실행하면 됩니다.
> 단, `--force` 는 새 서버의 데이터를 **모두 지우고** Supabase 기준으로 다시 채우므로, 새 서버에서 입력을 시작한 뒤에는 쓰지 마세요.

## 5. GitHub Pages 를 새 서버에 연결

1. GitHub 저장소 → **Settings → Secrets and variables → Actions → Variables** 탭 → **New repository variable**
   - Name: `API_BASE_URL` / Value: `https://dailydash.duckdns.org`
2. **Settings → Pages → Build and deployment → Source** 가 **GitHub Actions** 인지 확인
3. 새 코드를 `main` 에 push 하면 `Deploy DailyDash to GitHub Pages` 워크플로가 새 화면을 배포합니다.
   (Actions 탭에서 수동 실행도 가능)

배포가 끝나면 Pages 주소로 접속해 기존 계정으로 로그인하고 숫자를 확인합니다.
새 화면이 올라가는 순간부터 Supabase 대신 집 서버로 입력되므로, **4단계 이전 → 5단계 배포를 연달아** 진행하세요.

## 6. 공인 IP 가 바뀌었을 때

DuckDNS 주소를 쓰므로 따로 할 일이 없습니다. `duckdns` 컨테이너가 5분마다 `dailydash.duckdns.org` 를 새 IP 로 갱신합니다.
확인: `docker compose logs --tail 5 duckdns` 에서 `OK` 가 보이면 정상입니다.

> DuckDNS 없이 공인 IP 를 `DOMAIN`/`API_BASE_URL` 에 직접 쓰는 경우에만, IP 가 바뀌면 서버 `.env` 의 `DOMAIN` 과
> GitHub Variables 의 `API_BASE_URL` 을 새 IP 로 바꾸고 Pages 워크플로를 다시 실행해야 합니다.

## 7. 코드 업데이트 방법

### 서버(API)

```bash
cd ~/dailydash
git pull
docker compose up -d --build
```

DB 구조 변경(마이그레이션)은 앱이 시작할 때 자동으로 적용됩니다. 화면은 push 하면 GitHub Pages 가 알아서 배포합니다.

### push 하면 서버도 자동 배포 (선택)

`.github/workflows/deploy-server.yml` 이 준비되어 있습니다. 집 PC 의 SSH(22) 포트를 인터넷에 열어야 하므로,
켤 경우 **비밀번호 로그인을 끄고 키 로그인만 허용**한 뒤 사용하세요. 부담스러우면 수동 업데이트만으로 충분합니다.

1. 배포 전용 SSH 키 만들기: `ssh-keygen -t ed25519 -f dailydash_deploy -N ""`
2. 서버의 `~/.ssh/authorized_keys` 에 `dailydash_deploy.pub` 내용을 한 줄 추가
3. GitHub 저장소 → Settings → Secrets and variables → Actions
   - **Secrets**: `SERVER_HOST`(공인 IP 또는 DuckDNS 주소), `SERVER_USER`(예: `ksl`), `SERVER_SSH_KEY`(`dailydash_deploy` 파일 내용 전체)
     — 필요하면 `SERVER_PORT`, `DEPLOY_PATH`(기본 `~/dailydash`)
   - **Variables**: `DEPLOY_ENABLED` = `true`

push 할 때마다 `CI` 워크플로가 빌드와 서버 기동(실제 Postgres)을 자동 검사합니다.

## 8. 백업과 복구

- **자동 백업**: 매일 한 번 `~/dailydash/backups/dailydash-날짜-시간.sql.gz` 생성, `BACKUP_KEEP_DAYS`(기본 30일)보다 오래된 파일은 삭제.
- 집 PC 디스크가 고장 나면 백업도 함께 사라집니다. **가끔 다른 곳(외장 디스크, 구글 드라이브 등)에 복사**해 두세요.

지금 바로 백업:

```bash
docker compose exec backup sh -c 'pg_dump --no-owner | gzip > /backups/dailydash-manual.sql.gz'
```

백업에서 복구 (현재 DB 를 지우고 백업 시점으로 되돌림):

```bash
docker compose stop app
docker compose exec -T db psql -U dailydash -d postgres \
  -c "DROP DATABASE dailydash WITH (FORCE)" -c "CREATE DATABASE dailydash OWNER dailydash"
gunzip -c backups/복구할파일.sql.gz | docker compose exec -T db psql -U dailydash -d dailydash
docker compose start app
```

## 9. 계정 관리

| 상황 | 방법 |
|---|---|
| 직원 가입 승인 / 사용 중지 / 거절 | 마이페이지 → 사용자 관리 |
| 직원이 비밀번호를 잊음 | 마이페이지 → 사용자 관리 → **비번 초기화** → 임시 비밀번호 전달 → 직원이 로그인 후 마이페이지에서 변경 |
| 관리자 본인이 비밀번호를 잊음 | 서버에서 `docker compose exec app node scripts/create-admin.js 이메일 새비밀번호` |
| 메일로 "비밀번호 찾기"를 쓰고 싶음 | `.env` 의 `SMTP_*` 설정 후 `docker compose up -d` (Gmail 은 2단계 인증 → 앱 비밀번호 사용, 포트 465) |

작업 이력(입력·수정·삭제·복원·승인·엑셀 백업)은 서버 DB 에 남아 어느 기기에서든 마이페이지에서 볼 수 있습니다.

## 10. 내 PC 에서 개발하기

```bash
# 1) 개발용 DB
docker run -d --name dailydash-dev-db -e POSTGRES_USER=dailydash -e POSTGRES_PASSWORD=dailydash \
  -e POSTGRES_DB=dailydash -p 127.0.0.1:5432:5432 postgres:17-alpine

# 2) 의존성 설치 + 개발용 관리자 계정
npm install
npm --prefix server install
npm --prefix server run create-admin -- admin@example.com devpassword1

# 3) 터미널 두 개에서 각각 실행
npm run dev:server     # API  → http://127.0.0.1:3000
npm run dev            # 화면 → http://127.0.0.1:5173  (/api 는 3000 번으로 자동 전달)
```

## 11. 문제 해결

| 증상 | 확인할 것 |
|---|---|
| 화면에서 "서버에 연결할 수 없습니다" | 집 PC 가 켜져 있는지 / `docker compose ps` / 공인 IP 가 바뀌지 않았는지(6단계) / `.env` 의 `ALLOWED_ORIGINS` 가 Pages 주소와 정확히 같은지 |
| HTTPS 인증서가 안 받아짐 | `docker compose logs caddy` / 80·443 포트포워딩 / 다른 프로그램이 80·443 을 쓰고 있지 않은지 |
| 집 와이파이에서만 접속이 안 됨 | 공유기가 "내부에서 공인 IP 로 접속(NAT 루프백)"을 지원하지 않는 경우. 휴대폰 LTE 로는 되는지 확인 |
| 화면이 옛날 버전 그대로 | 새로고침 두 번, 그래도 안 되면 홈 화면 앱 삭제 후 다시 추가 (서비스워커 캐시) |
| "로그인 시도가 너무 많습니다" | 같은 계정으로 15분 안에 10번 이상 틀린 경우. 15분 뒤 다시 시도 |
| 서버 오류 메시지 | `docker compose logs --tail 100 app` |
| 전체 재시작 | `docker compose restart` |
