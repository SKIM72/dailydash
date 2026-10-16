// AI 월간 리포트 E2E (가짜 Gemini 서버 사용): 관리자 생성 · 저장본 재사용 · 직원 보기 · 보내는 데이터 · 오류 처리
import { ADMIN_EMAIL, BASE, MOCK_GEMINI, SHOTS, closeDb, createReporter, kstToday, launchBrowser, login, sql } from './config.mjs';

const reporter = createReporter('AI 월간 리포트');
const { check, watch } = reporter;
const mockCalls = async () => (await fetch(`${MOCK_GEMINI}/__calls`)).json();
const setMode = (mode) => fetch(`${MOCK_GEMINI}/__mode`, { method: 'POST', body: JSON.stringify({ mode }) });
const today = kstToday();
const month = today.slice(0, 7);
const lastYear = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;

const browser = await launchBrowser();
try {
  await setMode('ok');
  const callsBefore = (await mockCalls()).length;
  const [{ count: auditBefore }] = await sql("SELECT COUNT(*)::int AS count FROM audit_logs WHERE action = 'AI 리포트 생성'");

  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR' });
  const admin = await login(adminCtx);
  watch(admin, 'admin');
  await admin.click('#tabMonthly');
  await admin.locator('#monthAiReport').waitFor({ state: 'visible' });
  await admin.locator('#aiReportBtn').waitFor({ state: 'visible' });
  check('관리자: AI 리포트 카드와 만들기 버튼 표시', /리포트 만들기|다시 만들기/.test(await admin.innerText('#aiReportBtn')));
  check('관리자: 데이터 전송 안내 표시', (await admin.innerText('#aiReportFoot')).includes('Google Gemini(무료 등급)'));

  await admin.click('#aiReportBtn');
  await admin.locator('.ai-report__headline').waitFor({ timeout: 30000 });
  const sections = await admin.locator('.ai-report__section h3').allInnerTexts();
  check('리포트 표시: 한 줄 요약 + 4개 영역', sections.length === 4, sections.join(', '));
  check('버튼이 "다시 만들기"로 바뀜', (await admin.innerText('#aiReportBtn')).includes('다시 만들기'));

  let calls = (await mockCalls()).slice(callsBefore);
  check('Gemini 호출 1회', calls.length === 1, `${calls.length}회`);
  const request = calls[0].body;
  check('요청 형식: systemInstruction · JSON 스키마', Boolean(request.systemInstruction?.parts?.[0]?.text) && request.generationConfig?.responseMimeType === 'application/json' && request.generationConfig?.responseSchema?.required?.length === 5);
  const factsText = request.contents[0].parts[0].text;
  const facts = JSON.parse(factsText.slice(factsText.indexOf('{')));
  const [{ sales: dbSales }] = await sql(
    'SELECT COALESCE(SUM(cash_income + card_income), 0) AS sales FROM transactions WHERE deleted_at IS NULL AND transaction_date BETWEEN $1 AND $2',
    [`${month}-01`, today]
  );
  const [{ sales: dbLastYear }] = await sql(
    'SELECT COALESCE(SUM(cash_income + card_income), 0) AS sales FROM transactions WHERE deleted_at IS NULL AND transaction_date BETWEEN $1 AND $2',
    [`${lastYear.slice(0, 7)}-01`, lastYear]
  );
  check('보낸 집계: 이번 달 매출이 DB 와 같음', facts.current.sales === dbSales, `${facts.current.sales} / DB ${dbSales}`);
  check('보낸 집계: 전년 같은 기간 매출이 DB 와 같음', facts.lastYearSamePeriod.sales === dbLastYear, `${facts.lastYearSamePeriod.sales} / DB ${dbLastYear}`);
  check('보낸 집계: 증감률을 서버가 미리 계산', 'salesRate' in facts.comparisons.vsLastYearSamePeriod);
  check('개인정보 제외: 비고(홍길동)·이메일 없음', !factsText.includes('홍길동') && !factsText.includes('@'));

  await admin.click('#aiReportBtn');
  await admin.locator('.toast-message', { hasText: '저장된 리포트' }).waitFor({ timeout: 10000 });
  calls = (await mockCalls()).slice(callsBefore);
  check('같은 데이터로 다시 누르면 저장본 사용 (호출 안 늘어남)', calls.length === 1, `${calls.length}회`);

  // 직원 계정은 보기만 가능
  const staffEmail = `staff-ai-${Date.now()}@dailydash.test`;
  await fetch(`${BASE}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: staffEmail, password: 'staffpass1' }) });
  const [{ id: staffId }] = await sql('SELECT id FROM users WHERE email = $1', [staffEmail]);
  await admin.evaluate(async (id) => fetch(`api/admin/users/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), staffId);
  const staffCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR' });
  const staff = await login(staffCtx, staffEmail, 'staffpass1');
  watch(staff, 'staff');
  await staff.tap('.bottom-nav__item[data-nav="monthly"]');
  await staff.locator('.ai-report__headline').waitFor({ timeout: 10000 });
  check('직원: 저장된 리포트 보기', true);
  check('직원: 만들기 버튼 없음', await staff.locator('#aiReportBtn').isHidden());
  const staffPost = await staff.evaluate(async (m) => (await fetch('api/ai/monthly-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month: m }) })).status, month);
  check('직원: 만들기 API 거부(403)', staffPost === 403, String(staffPost));
  check('직원 화면 가로 넘침 없음', await staff.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await staff.locator('#monthAiReport').scrollIntoViewIfNeeded();
  await staff.screenshot({ path: `${SHOTS}ai-report-mobile.png` });

  // 무료 한도(429): 데이터를 바꿔 새로 만들게 한 뒤 한도 응답 → 예비 모델까지 시도 후 안내
  await sql("INSERT INTO transactions (transaction_date, description, customer_count, cash_income, card_income) VALUES ($1, '식혜', 1, 4000, 0)", [today]);
  await setMode('429');
  const before429 = (await mockCalls()).length;
  await admin.click('#aiReportBtn');
  await admin.locator('.toast-message', { hasText: '무료 사용량 한도' }).waitFor({ timeout: 15000 });
  const models429 = (await mockCalls()).slice(before429).map((call) => call.model);
  check('한도 초과(429): 예비 모델까지 시도 후 안내', models429.length === 2 && models429[0] !== models429[1], models429.join(' → '));
  await admin.locator('.ai-report__headline').waitFor({ timeout: 10000 });
  check('실패 후 이전 리포트로 돌아옴', true);

  await setMode('badjson');
  const badStatus = await admin.evaluate(async (m) => {
    const res = await fetch('api/ai/monthly-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month: m }) });
    return `${res.status} ${(await res.json()).error?.code}`;
  }, month);
  check('잘못된 AI 응답 처리(502)', badStatus === '502 AI_BAD_RESPONSE', badStatus);
  await setMode('ok');

  const futureStatus = await admin.evaluate(async () => (await fetch('api/ai/monthly-report?month=2099-01')).status);
  check('미래 달 요청 거부(400)', futureStatus === 400, String(futureStatus));
  const [{ count: auditAfter }] = await sql("SELECT COUNT(*)::int AS count FROM audit_logs WHERE action = 'AI 리포트 생성'");
  check('작업 이력에 AI 리포트 생성 기록', auditAfter - auditBefore === 1, `${auditAfter - auditBefore}건`);
  await admin.locator('#monthAiReport').scrollIntoViewIfNeeded();
  await admin.screenshot({ path: `${SHOTS}ai-report-desktop.png` });
} catch (err) {
  reporter.fail(err);
} finally {
  await browser.close();
  await closeDb();
  reporter.finish();
}
