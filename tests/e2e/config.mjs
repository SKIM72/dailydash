// E2E 공용 설정 · 도우미. 환경 변수로 주소·계정·브라우저를 바꿀 수 있다. (tests/e2e/README.md)
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const BASE = process.env.BASE || 'http://127.0.0.1:3100';
export const API = process.env.API || BASE;
export const MOCK_GEMINI = process.env.MOCK_GEMINI || 'http://127.0.0.1:4999';
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@dailydash.test';
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'adminpass1';
export const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

// 서버 폴더의 pg 를 빌려 DB 를 직접 확인한다. (E2E 전용 의존성을 늘리지 않기 위해)
const serverRequire = createRequire(new URL('../../server/package.json', import.meta.url));
const pg = serverRequire('pg');
pg.types.setTypeParser(20, Number);
pg.types.setTypeParser(1700, Number);
pg.types.setTypeParser(1082, (value) => value);
let pool = null;
export async function sql(text, params = []) {
  pool ||= new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(text, params);
  return rows;
}
export async function closeDb() {
  await pool?.end();
  pool = null;
}

// 로컬은 설치된 Edge(E2E_BROWSER_CHANNEL=msedge), CI 는 Playwright 의 Chromium 을 쓴다.
export function launchBrowser() {
  return chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || undefined, headless: true });
}

export function kstToday(offsetDays = 0) {
  return new Date(Date.now() + 9 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
}

export function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

// 결과를 모아 출력하고, 실패·예외·페이지 스크립트 오류가 있으면 종료 코드를 1로 둔다.
export function createReporter(title) {
  const results = [];
  const failures = [];
  const notes = [];
  return {
    check(name, ok, detail = '') {
      results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
      if (!ok) failures.push(name);
    },
    watch(page, label) {
      page.on('console', (msg) => {
        // 권한 시험(401·403)과 일부러 끊은 네트워크 시험의 콘솔 오류는 참고로만 남긴다.
        if (msg.type() === 'error') notes.push(`[${label} console] ${msg.text()}`);
      });
      page.on('pageerror', (err) => failures.push(`[${label} pageerror] ${err.message}`));
    },
    fail(err) {
      failures.push(`EXCEPTION: ${err.stack || err.message}`);
    },
    finish() {
      console.log(`\n=== ${title} ===`);
      console.log(results.join('\n'));
      const passed = results.filter((r) => r.startsWith('PASS')).length;
      console.log(`\n${passed} passed, ${results.length - passed} failed`);
      if (notes.length) console.log(`(참고: 콘솔 오류 ${notes.length}건 - 권한·네트워크 끊김 시험에서 나는 것)`);
      if (failures.length) {
        console.log('\nFAILURES:');
        failures.forEach((item) => console.log(' -', item));
        process.exitCode = 1;
      }
    }
  };
}

export async function login(context, email = ADMIN_EMAIL, password = ADMIN_PASSWORD) {
  const page = await context.newPage();
  await page.goto(`${BASE}/login.html`);
  await page.fill('#loginEmail', email);
  await page.fill('#loginPassword', password);
  await page.click('#loginBtn');
  await page.waitForURL(/index\.html/);
  return page;
}
