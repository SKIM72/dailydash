# DailyDash 안드로이드 앱(APK)

DailyDash 안드로이드 앱은 구글이 PWA 를 앱으로 만들 때 권하는 **TWA(Trusted Web Activity)** 방식입니다.
앱을 열면 휴대폰의 Chrome 엔진이 `https://dailydash.duckdns.org` 화면을 주소창 없이 전체 화면으로 띄웁니다.

- 화면·기능은 서버에서 불러오므로 **서버를 배포하면 앱도 자동으로 최신**이 됩니다. APK 를 다시 받을 필요가 없습니다.
- 앱 이름·아이콘·시작 주소를 바꾸거나 안드로이드 라이브러리를 올릴 때만 APK 를 새로 만듭니다.
- 직원은 [앱 다운로드 페이지](https://skim72.github.io/dailydash/install.html) 에서 받습니다. (서버 주소의 `/install.html` 도 같습니다)

| 항목 | 값 |
| --- | --- |
| 패키지 이름 | `org.duckdns.dailydash.twa` (한 번 정하면 바꾸지 않습니다) |
| 시작 주소 | `https://dailydash.duckdns.org/index.html?source=twa` |
| 최소 버전 | Android 7.0 (API 24) |
| 서명 키 | `C:\Users\aa\DailyDash-Android-Key\` (저장소 밖) |

## 관련 파일

| 파일 | 역할 |
| --- | --- |
| `android/` | 안드로이드 프로젝트 (Bubblewrap 1.27 로 생성) |
| `android/twa-manifest.json` | 앱 설정 원본. `bubblewrap update` 로 프로젝트를 다시 만들 때 사용 |
| `scripts/build-apk.mjs` | `npm run apk` — 빌드 → 서명 → `public/downloads/` 로 복사 |
| `public/downloads/dailydash.apk` | 다운로드 페이지에서 받는 APK |
| `public/downloads/dailydash-apk.json` | 다운로드 페이지에 보여 줄 버전·용량·SHA-256 |
| `public/.well-known/assetlinks.json` | "이 사이트와 앱은 같은 주인" 인증 파일. 서버가 `/.well-known/assetlinks.json` 으로 제공 |

## 서명 키 (가장 중요)

`C:\Users\aa\DailyDash-Android-Key\` 폴더에 서명 키(`dailydash-release.jks`)와 비밀번호(`keystore.properties`)가 있습니다.

- **USB·외장 하드 등에 한 부 더 백업하세요.** 키를 잃어버리면 새로 만든 APK 를 기존 앱 위에 업데이트할 수 없어,
  직원 휴대폰에서 앱을 지우고 다시 설치해야 합니다. (키를 새로 만들면 `assetlinks.json` 도 바뀝니다)
- GitHub 에 올리거나 다른 사람에게 보내지 마세요. `.gitignore` 에 `*.jks`, `keystore.properties` 가 막혀 있습니다.
- 다른 PC 에서 빌드할 때는 이 폴더를 복사하고 `DAILYDASH_KEY_DIR` 환경 변수로 위치를 알려 줍니다.

## APK 다시 만들기

준비물: JDK 17 이상, Android SDK(Android Studio 설치 시 함께 설치됨 — build-tools, Android 16(API 36) 플랫폼).

1. `android/app/build.gradle` 의 `versionCode` 를 1 올리고 `versionName` 을 바꿉니다. (같은 `android/twa-manifest.json` 의 `appVersionCode`·`appVersionName` 도 맞춰 둡니다)
2. 프로젝트 폴더에서 실행합니다.
   ```bash
   npm run apk
   ```
   빌드·서명이 끝나면 `public/downloads/dailydash.apk` 와 정보 파일이 갱신되고, 서명 지문이 `assetlinks.json` 과 같은지 검사합니다.
3. GitHub 에 push 해 Pages 를 배포하고, 서버도 `docker compose up -d --build` 로 다시 빌드합니다.

## 주소창이 보일 때 (인증 확인)

앱 위쪽에 주소창이 보이면 Chrome 이 사이트와 앱의 연결을 확인하지 못한 것입니다.

1. `https://dailydash.duckdns.org/.well-known/assetlinks.json` 이 열리고 지문이 `dailydash-apk.json` 의 `certificateSha256` 과 같은지 확인합니다.
2. 구글 확인 도구로 검사합니다. `linked: true` 가 나오면 정상입니다.
   ```
   https://digitalassetlinks.googleapis.com/v1/assetlinks:check?source.web.site=https://dailydash.duckdns.org&relation=delegate_permission/common.handle_all_urls&target.android_app.package_name=org.duckdns.dailydash.twa&target.android_app.certificate.sha256_fingerprint=<지문>
   ```
3. 휴대폰의 Chrome 을 최신으로 업데이트하고 앱을 완전히 닫았다가 다시 엽니다.
