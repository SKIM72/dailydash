# 백업 · 외부 백업 · 복구

## 1. 자동 백업 (서버 안)

- `backup` 컨테이너가 **하루 한 번** DB 전체를 `dailydash-날짜-시각.sql.gz` 로 저장합니다.
- 저장 위치는 `.env` 의 `BACKUP_DIR` (지금은 1TB HDD 의 `dailydash-backups` 폴더), 30일 지난 파일은 지웁니다.
- 큰 작업(배포·데이터 이전) 전에는 수동으로 한 번 더 받습니다. (`docs/DEPLOY-SAFETY.md`)

## 2. 외부 백업 (Google Drive, 암호화)

서버 PC 가 고장 나거나 도난·화재가 나도 데이터를 지킬 수 있도록, 매일 최근 백업 파일을 **암호화해서** Google Drive 로 복사합니다.

- `offsite` 컨테이너(rclone)가 하루 한 번 최근 7일치 백업을 Drive 의 `DailyDash-backups` 폴더로 복사하고, 90일 지난 것은 지웁니다.
- 파일 이름과 내용이 모두 암호화되어, Drive 를 누가 보더라도 내용을 알 수 없습니다.
- rclone 은 자기가 만든 파일만 볼 수 있는 권한(`drive.file`)으로 연결되어, Drive 의 다른 파일에는 손대지 못합니다.
- 설정 파일은 서버 `~/dailydash/offsite/rclone.conf` 에 있고(저장소에 올리지 않음), **암호 사본은 `C:\Users\aa\DailyDash-Android-Key\offsite-backup.txt`** 에 있습니다.
  서버가 통째로 없어지면 이 암호가 있어야 Drive 의 백업을 풀 수 있으니, 이 폴더를 USB 등에 꼭 백업해 두세요.

동작 확인: `docker compose logs --tail 20 offsite` 에 "외부 백업 복사 완료" 가 보이면 정상입니다.

## 3. 복구 연습 (분기마다 권장)

```bash
cd ~/dailydash
bash scripts/restore-drill.sh
```

가장 최근 백업을 **네트워크가 없는 임시 DB** 에 실제로 되살려 운영 DB 와 건수·합계를 비교하고, 끝나면 임시 DB 를 지웁니다.
운영 DB 는 읽기만 합니다. "결과: 일치" 가 나오면 백업으로 그대로 되살릴 수 있다는 뜻입니다.
(2026-10-17 첫 연습: 내역 10,339건 · 매출 합계 503,708,058원 · 계정 4개 모두 일치)

## 4. 실제로 복구해야 할 때

### 서버 백업 파일로 (서버 PC 는 살아 있을 때)

```bash
cd ~/dailydash
docker compose stop app
docker compose exec -T backup sh -c 'ls -1t /backups/dailydash-*.sql.gz | head -5'   # 되살릴 파일 고르기
docker compose exec -T db psql -U dailydash -d postgres -c 'DROP DATABASE dailydash' -c 'CREATE DATABASE dailydash OWNER dailydash'
docker compose exec -T backup sh -c 'gunzip -c /backups/고른파일.sql.gz' | docker compose exec -T db psql -U dailydash -d dailydash -v ON_ERROR_STOP=1
docker compose start app
```

### Google Drive 백업으로 (새 서버에서)

1. 새 서버에 `docs/SERVER-SETUP.md` 대로 DailyDash 를 설치하고 `docker compose stop app` 합니다.
2. `offsite-backup.txt` 에 적힌 대로 `~/dailydash/offsite/rclone.conf` 를 다시 만듭니다.
3. Drive 에서 최근 백업을 내려받습니다.
   ```bash
   docker compose run --rm --entrypoint rclone offsite copy dailydash-offsite: /restore --max-age 3d
   ```
   (`/restore` 대신 내려받을 폴더를 `-v ~/restore:/restore` 로 연결해 쓰면 편합니다)
4. 위 "서버 백업 파일로" 의 DROP/CREATE 와 `gunzip | psql` 순서로 되살리고 `docker compose start app` 합니다.
