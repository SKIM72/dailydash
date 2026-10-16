// 안드로이드 앱(APK)을 빌드·서명해 public/downloads 에 넣는다. 사용법: npm run apk
// 서명 키는 저장소 밖(기본: 사용자 폴더의 DailyDash-Android-Key)에 둔다. 자세한 내용은 docs/ANDROID-APP.md 참고.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_DIR = path.join(ROOT, 'android');
const KEY_DIR = process.env.DAILYDASH_KEY_DIR || path.join(os.homedir(), 'DailyDash-Android-Key');
const DOWNLOAD_DIR = path.join(ROOT, 'public', 'downloads');
const ASSET_LINKS = path.join(ROOT, 'public', '.well-known', 'assetlinks.json');
const APK_NAME = 'dailydash.apk';
// 설치 페이지에 '안드로이드 7.0 이상' 처럼 보여 주기 위한 API 레벨 → 버전 이름
const ANDROID_RELEASES = { 24: '7.0', 25: '7.1', 26: '8.0', 27: '8.1', 28: '9', 29: '10', 30: '11' };

function fail(message) {
  console.error(`\n[apk] ${message}`);
  process.exit(1);
}

function run(command, args, { env, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: ANDROID_DIR,
    env: { ...process.env, ...env },
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8'
  });
  if (result.error) fail(`${path.basename(command)} 실행 실패: ${result.error.message}`);
  if (result.status !== 0) fail(`${path.basename(command)} 가 실패했습니다. (종료 코드 ${result.status})`);
  return result.stdout;
}

function readProperties(file) {
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()])
  );
}

function findAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    path.join(os.homedir(), 'Library', 'Android', 'sdk'),
    path.join(os.homedir(), 'Android', 'Sdk')
  ].filter(Boolean);
  const sdk = candidates.find((dir) => existsSync(path.join(dir, 'build-tools')));
  if (!sdk) fail('Android SDK 를 찾지 못했습니다. ANDROID_HOME 환경 변수를 설정하세요.');
  return sdk;
}

function latestBuildTools(sdk) {
  const versions = readdirSync(path.join(sdk, 'build-tools'))
    .filter((name) => existsSync(path.join(sdk, 'build-tools', name, 'lib', 'apksigner.jar')))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  if (!versions.length) fail('apksigner 가 있는 build-tools 를 찾지 못했습니다.');
  return path.join(sdk, 'build-tools', versions[0]);
}

function toFingerprint(hex) {
  return hex.toUpperCase().match(/.{2}/g).join(':');
}

// 1. 서명 키 확인
const propertiesFile = path.join(KEY_DIR, 'keystore.properties');
if (!existsSync(propertiesFile)) {
  fail(`서명 키 정보가 없습니다: ${propertiesFile}\n      키 폴더를 복원하거나 DAILYDASH_KEY_DIR 로 위치를 알려 주세요.`);
}
const signing = readProperties(propertiesFile);
const keystore = path.resolve(KEY_DIR, signing.storeFile || '');
if (!existsSync(keystore)) fail(`서명 키 파일이 없습니다: ${keystore}`);

const gradleFile = readFileSync(path.join(ANDROID_DIR, 'app', 'build.gradle'), 'utf8');
const packageId = gradleFile.match(/applicationId "([^"]+)"/)?.[1];
const versionName = gradleFile.match(/versionName "([^"]+)"/)?.[1];
const versionCode = Number(gradleFile.match(/versionCode (\d+)/)?.[1]);
const minSdk = Number(gradleFile.match(/minSdkVersion (\d+)/)?.[1]);
if (!packageId || !versionName || !versionCode) fail('android/app/build.gradle 에서 패키지 이름이나 버전을 읽지 못했습니다.');

const sdk = findAndroidSdk();
const buildTools = latestBuildTools(sdk);
console.log(`[apk] ${packageId} ${versionName} (${versionCode}) 빌드 시작 · SDK ${sdk}`);

// 2. 빌드 (gradlew 와 같은 동작을 java 로 직접 실행해 운영체제별 스크립트 차이를 피한다)
run('java', [
  '-Dorg.gradle.appname=gradlew',
  '-classpath', path.join(ANDROID_DIR, 'gradle', 'wrapper', 'gradle-wrapper.jar'),
  'org.gradle.wrapper.GradleWrapperMain',
  'assembleRelease', '--console=plain'
], { env: { ANDROID_HOME: sdk } });

// 3. 정렬 · 서명
const outputDir = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'release');
const unsigned = path.join(outputDir, 'app-release-unsigned.apk');
const aligned = path.join(outputDir, 'app-release-aligned.apk');
const signed = path.join(outputDir, 'app-release-signed.apk');
if (!existsSync(unsigned)) fail(`빌드 결과가 없습니다: ${unsigned}`);

const zipalign = path.join(buildTools, process.platform === 'win32' ? 'zipalign.exe' : 'zipalign');
run(zipalign, ['-p', '-f', '4', unsigned, aligned]);
const apksigner = path.join(buildTools, 'lib', 'apksigner.jar');
run('java', [
  '-jar', apksigner, 'sign',
  '--ks', keystore,
  '--ks-key-alias', signing.keyAlias,
  '--ks-pass', 'env:DD_STORE_PASS',
  '--key-pass', 'env:DD_KEY_PASS',
  '--out', signed,
  aligned
], { env: { DD_STORE_PASS: signing.storePassword, DD_KEY_PASS: signing.keyPassword || signing.storePassword } });

// 4. 서명 확인 → 웹사이트 인증 파일(assetlinks.json)과 지문이 같은지 검사
const verifyOutput = run('java', ['-jar', apksigner, 'verify', '--print-certs', signed], { capture: true });
const digest = verifyOutput.match(/certificate SHA-256 digest: ([0-9a-f]{64})/i)?.[1];
if (!digest) fail('APK 서명 확인에 실패했습니다.');
const fingerprint = toFingerprint(digest);

const assetLinks = [{
  relation: ['delegate_permission/common.handle_all_urls'],
  target: { namespace: 'android_app', package_name: packageId, sha256_cert_fingerprints: [fingerprint] }
}];
const assetLinksText = `${JSON.stringify(assetLinks, null, 2)}\n`;
const previousAssetLinks = existsSync(ASSET_LINKS) ? readFileSync(ASSET_LINKS, 'utf8') : '';
if (previousAssetLinks !== assetLinksText) {
  mkdirSync(path.dirname(ASSET_LINKS), { recursive: true });
  writeFileSync(ASSET_LINKS, assetLinksText);
  console.warn('[apk] public/.well-known/assetlinks.json 을 새로 썼습니다. 서버에도 다시 배포해야 주소창 없이 열립니다.');
}

// 5. 다운로드 폴더로 복사 + 설치 페이지가 읽는 정보 파일
mkdirSync(DOWNLOAD_DIR, { recursive: true });
const target = path.join(DOWNLOAD_DIR, APK_NAME);
copyFileSync(signed, target);
const bytes = readFileSync(target);
const info = {
  file: APK_NAME,
  packageId,
  versionName,
  versionCode,
  size: statSync(target).size,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  certificateSha256: fingerprint,
  minAndroid: ANDROID_RELEASES[minSdk] || `API ${minSdk}`,
  builtAt: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
};
writeFileSync(path.join(DOWNLOAD_DIR, 'dailydash-apk.json'), `${JSON.stringify(info, null, 2)}\n`);

console.log(`\n[apk] 완료: public/downloads/${APK_NAME} (${(info.size / 1024 / 1024).toFixed(2)}MB)`);
console.log(`[apk] 서명 지문 ${fingerprint}`);
console.log('[apk] 웹사이트와 서버를 배포하면 설치 페이지에서 받을 수 있습니다.');
