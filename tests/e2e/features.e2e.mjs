// 새 기능 E2E: 적요 묶기 · 자동완성 · 월말 예상 · 품목 시즌 · 오프라인 입력 · 알림 설정
import { BASE, SHOTS, closeDb, createReporter, kstToday, launchBrowser, login, sql } from './config.mjs';

const reporter = createReporter('새 기능');
const { check, watch } = reporter;

async function testDescriptionAliases(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  const page = await login(ctx);
  watch(page, 'admin-items');

  // 자동완성
  await page.waitForFunction(() => document.querySelectorAll('#descSuggestions option').length > 0);
  const options = await page.$$eval('#descSuggestions option', (list) => list.map((option) => option.value));
  check('자동완성: 적요 입력칸에 최근 적요 목록 연결', options.includes('돌배즙') && (await page.getAttribute('#desc', 'list')) === 'descSuggestions', `${options.length}개`);

  const [{ count: rawBefore }] = await sql("SELECT COUNT(*)::int AS count FROM transactions WHERE description = '돌배즙 판매'");

  // 적요 정리 탭
  await page.click('#myPageBtn');
  await page.click('[data-tab="items"]');
  const group = page.locator('.item-group', { hasText: '돌배즙외 판매' });
  await group.waitFor();
  check('적요 정리: "돌배즙/돌배즙 판매/돌배즙외 판매"를 한 묶음으로 추천', (await group.innerText()).includes('돌배즙 판매'));
  await group.locator('.item-input').fill('돌배즙');
  await group.locator('button', { hasText: '하나로 묶기' }).click();
  await page.locator('.toast-message', { hasText: '"돌배즙"(으)로 묶었어요' }).waitFor();
  const mappedRow = page.locator('.item-row--mapped', { hasText: '돌배즙외 판매' });
  await mappedRow.waitFor();
  check('적요 정리: 묶은 뒤 "묶어 둔 적요"에 표시', (await mappedRow.innerText()).includes('돌배즙 판매'));

  const nonItem = page.locator('.item-row', { hasText: '카드 ·' });
  await nonItem.waitFor();
  await nonItem.locator('button', { hasText: '품목 아님' }).click();
  await page.locator('.toast-message', { hasText: '품목 분석에서 빼요' }).waitFor();
  check('적요 정리: 결제수단 적요("카드")를 품목 아님으로 표시', true);
  await page.screenshot({ path: `${SHOTS}items-tab.png` });

  const [{ count: rawAfter }] = await sql("SELECT COUNT(*)::int AS count FROM transactions WHERE description = '돌배즙 판매'");
  check('원본 내역은 그대로 (적요 이름 안 바뀜)', rawBefore === rawAfter && rawAfter > 0, `${rawBefore} → ${rawAfter}`);
  const aliases = await sql('SELECT alias, canonical FROM description_aliases ORDER BY alias');
  check('묶음표 저장', aliases.some((a) => a.alias === '돌배즙 판매' && a.canonical === '돌배즙') && aliases.some((a) => a.alias === '카드'), aliases.map((a) => `${a.alias}→${a.canonical}`).join(', '));

  // 분석 반영: 통계 분석(최근 90일)의 적요 순위
  await page.keyboard.press('Escape');
  await page.click('#tabTotal');
  await page.click('[data-range-preset="last90"]');
  await page.waitForFunction(() => document.querySelector('#rangeTotalSales').textContent !== '0');
  await page.locator('#rangeDescriptionRanking .ranking-item').first().waitFor();
  const rankedNames = (await page.locator('#rangeDescriptionRanking .ranking-head strong').allInnerTexts()).map((text) => text.replace(/^\d+\.\s*/, ''));
  check('분석 반영: 순위에 "돌배즙 판매"·"카드"가 따로 나오지 않음', rankedNames.includes('돌배즙') && !rankedNames.some((name) => ['돌배즙 판매', '돌배즙외 판매', '카드'].includes(name)), rankedNames.join(', '));

  // 관리자 묶기 API
  const staffStatus = await page.evaluate(async () => {
    const res = await fetch('api/descriptions/aliases', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aliases: [{ alias: 'x', canonical: 'y' }] }) });
    return res.status;
  });
  check('관리자는 묶기 API 사용 가능', staffStatus === 200, String(staffStatus));
  await sql("DELETE FROM description_aliases WHERE alias = 'x'");

  // 묶음 풀기
  await page.click('#myPageBtn');
  await page.click('[data-tab="items"]');
  const chip = page.locator('.item-row--mapped .item-chip', { hasText: '돌배즙외 판매' });
  await chip.waitFor();
  await chip.locator('.item-chip__remove').click();
  await page.locator('.toast-message', { hasText: '묶음을 풀었어요' }).waitFor();
  const [{ count: stillMapped }] = await sql("SELECT COUNT(*)::int AS count FROM description_aliases WHERE alias = '돌배즙외 판매'");
  check('묶음 풀기', stillMapped === 0);
  await page.keyboard.press('Escape');
  await ctx.close();
}

async function testMemberCannotEditAliases(browser) {
  const email = `staff-items-${Date.now()}@dailydash.test`;
  await fetch(`${BASE}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'staffpass1' }) });
  await sql("UPDATE users SET status = 'approved', approved_at = now() WHERE email = $1", [email]);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR' });
  const page = await login(ctx, email, 'staffpass1');
  watch(page, 'staff-items');
  const status = await page.evaluate(async () => (await fetch('api/descriptions/aliases', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aliases: [{ alias: 'a', canonical: 'b' }] }) })).status);
  check('직원: 적요 묶기 API 거부(403)', status === 403, String(status));
  await page.tap('.bottom-nav__item[data-action="mypage"]');
  await page.locator('#myPageTabs').waitFor();
  check('직원: 적요 정리 탭 숨김', await page.locator('#itemsTabBtn').isHidden());
  await ctx.close();
}

async function testForecastAndSeasons(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR' });
  const page = await login(ctx);
  watch(page, 'admin-forecast');

  // 월말 예상: 이번 달 마지막 날이 아니면 기간 비교에 "이번 달 예상 마감" 카드가 있다.
  await page.click('#tabMonthly');
  await page.locator('#monthCompareList .compare-row').nth(2).waitFor();
  const today = kstToday();
  const isLastDay = kstToday(1).slice(8, 10) === '01';
  const forecast = page.locator('#monthCompareList .compare-row--forecast');
  if (isLastDay) {
    check('월말 예상: 마지막 날에는 예상 카드 없음', (await forecast.count()) === 0);
  } else {
    const text = await forecast.innerText();
    check('월말 예상: "이번 달 예상 마감" 카드 표시', text.includes('이번 달 예상 마감') && text.includes('예상 매출') && text.includes('추정치'), text.replace(/\n/g, ' / '));
    check('월말 예상: 작년 같은 달과 비교 칩', /작년 \d+월보다 [+-]\d+%/.test(text));
  }
  await page.locator('#monthCompareList').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}forecast.png` });

  // 품목 시즌 비교
  await page.click('#tabTotal');
  await page.locator('#seasonTable tbody tr').first().waitFor();
  const yearRows = await page.locator('#seasonTable tbody tr').count();
  const monthHeaders = await page.locator('#seasonTable thead th').count();
  const peaks = await page.locator('#seasonTable thead th.is-peak').count();
  check('시즌 비교: 3개 연도 × 12개월 표 + 성수기 표시', yearRows === 3 && monthHeaders === 14 && peaks >= 1 && peaks <= 3, `${yearRows}행, 머리 ${monthHeaders}칸, 성수기 ${peaks}개`);
  const options = await page.$$eval('#seasonItemSelect option', (list) => list.map((option) => option.value));
  check('시즌 비교: 품목 선택 목록 (대표 이름 기준)', options.length >= 3 && !options.includes('카드'), options.slice(0, 6).join(', '));
  const otherItem = options.find((name) => name !== options[0]);
  await page.selectOption('#seasonItemSelect', otherItem);
  await page.waitForFunction((name) => document.getElementById('seasonSummary').textContent.startsWith(name), otherItem);
  check('시즌 비교: 품목을 바꾸면 표와 설명이 바뀜', (await page.inputValue('#seasonItemSelect')) === otherItem, otherItem);
  const [{ sales: dbThisMonth }] = await sql(
    `SELECT COALESCE(SUM(t.cash_income + t.card_income), 0) AS sales
       FROM transactions t LEFT JOIN description_aliases a ON a.alias = btrim(t.description)
      WHERE t.deleted_at IS NULL AND COALESCE(a.canonical, btrim(t.description)) = $1
        AND t.transaction_date BETWEEN $2 AND $3`,
    [otherItem, `${today.slice(0, 7)}-01`, today]
  );
  const thisYearRow = page.locator('#seasonTable tbody tr').last();
  const monthCell = await thisYearRow.locator('td').nth(Number(today.slice(5, 7)) - 1).innerText();
  check('시즌 비교: 이번 달 칸이 DB 합계와 맞음', dbThisMonth === 0 ? monthCell === '-' : monthCell !== '-' && monthCell !== '·', `${monthCell} / DB ${dbThisMonth}`);
  await page.locator('.season-panel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}seasons.png` });
  check('시즌 비교: 가로 넘침 없음(표는 안에서만 스크롤)', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await ctx.close();
}

async function submitEntry(page, description, amount) {
  if (!(await page.locator('#entryPanel.is-open').count())) {
    await page.click('#entryFab');
    await page.locator('#entryPanel.is-open').waitFor();
  }
  await page.fill('#desc', description);
  await page.fill('#count', '1');
  await page.fill('#cashIn', String(amount));
  await page.click('#submitTransactionBtn');
  await page.locator('#custom-confirm-modal').waitFor({ state: 'visible' });
  await page.click('#confirm-yes-btn');
}

async function testOfflineOutbox(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR' });
  const page = await login(ctx);
  watch(page, 'offline');
  await page.locator('#txList .list-item, #txList .empty-state').first().waitFor();
  const stamp = Date.now() % 100000;
  const offlineDesc = `오프라인식혜${stamp}`;
  const lostDesc = `응답분실${stamp}`;

  // 1) 연결이 끊긴 채 저장 → 휴대폰 보관함
  await ctx.setOffline(true);
  await submitEntry(page, offlineDesc, 4000);
  await page.locator('.toast-message', { hasText: '휴대폰에 임시 저장' }).waitFor();
  await page.locator('#outboxBanner').waitFor({ state: 'visible' });
  check('오프라인: 저장하면 휴대폰에 임시 저장 + 대기 배너', (await page.innerText('#outboxTitle')).includes('1건'));
  await page.screenshot({ path: `${SHOTS}offline-outbox.png` });

  // 다시 연결되면 자동으로 보낸다.
  await ctx.setOffline(false);
  await page.locator('.toast-message', { hasText: '서버로 보냈어요' }).waitFor({ timeout: 15000 });
  await page.waitForFunction(() => (localStorage.getItem('dailydash-outbox-v1') || '[]') === '[]');
  check('다시 연결되면 자동 전송 + 보관함 비움', await page.locator('#outboxBanner').isHidden());

  // 2) 요청은 서버에 닿았는데 응답만 잃어버린 경우 → 다시 보내도 한 번만 저장
  await page.route('**/api/transactions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = route.request().postDataJSON();
    if (body.description !== lostDesc) return route.continue();
    await route.fetch();
    await route.abort('failed');
  });
  await submitEntry(page, lostDesc, 5000);
  await page.waitForFunction((desc) => (localStorage.getItem('dailydash-outbox-v1') || '').includes(desc), lostDesc);
  await page.unrouteAll({ behavior: 'wait' });
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('dailydash-outbox-v1') || '[]').map((item) => item.values.description));
  check('응답 분실: 보관함에 들어감 (서버에는 이미 저장된 상태)', queued.length === 1 && queued[0] === lostDesc, queued.join(', '));

  // 3) 다시 연결 → 자동/수동 전송 → 서버에 한 번씩만 저장 (연속 입력용으로 열려 있는 시트를 닫고)
  await page.click('.entry-panel__close');
  await page.locator('#entryPanel.is-open').waitFor({ state: 'detached' });
  if (await page.locator('#outboxBanner').isVisible()) await page.click('#outboxSendBtn');
  await page.locator('#outboxBanner').waitFor({ state: 'hidden', timeout: 15000 });
  const rows = await sql('SELECT description, COUNT(*)::int AS count, COUNT(client_id)::int AS with_id FROM transactions WHERE description = ANY($1) GROUP BY description', [[offlineDesc, lostDesc]]);
  const counts = Object.fromEntries(rows.map((row) => [row.description, row.count]));
  check('다시 연결되면 전송 → 각각 정확히 1건 (중복 없음)', counts[offlineDesc] === 1 && counts[lostDesc] === 1, JSON.stringify(counts));
  check('오프라인 입력에 고유 번호(client_id) 저장', rows.every((row) => row.with_id === 1));
  await page.locator('#txList .list-item', { hasText: offlineDesc }).waitFor();
  check('전송 후 오늘 목록에 표시', true);

  // 4) 서버에 닿지 않는 상태로 앱 열기 → 마지막 계정으로 열리고 입력 가능
  await page.route('**/api/**', (route) => route.abort('failed'));
  await page.reload();
  await page.locator('.toast-message', { hasText: '인터넷이 끊겨 있어요' }).waitFor();
  check('오프라인으로 앱 열기: 마지막 계정으로 열림', page.url().includes('index.html'));
  check('오프라인으로 앱 열기: 연결 끊김 배너 표시', await page.locator('#networkBanner').isVisible());
  await page.unroute('**/api/**');

  // 5) 직접 보내기(중복 번호)는 서버가 200 으로 기존 내역을 돌려준다
  const duplicateStatus = await page.evaluate(async (desc) => {
    const clientId = crypto.randomUUID();
    const body = JSON.stringify({ transaction_date: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), description: desc, customer_count: 1, cash_income: 1000, card_income: 0, cash_expense: 0, remark1: '', remark2: '', client_id: clientId });
    const first = await fetch('api/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const second = await fetch('api/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    return `${first.status}/${second.status}/${(await second.json()).duplicate}`;
  }, `중복확인${stamp}`);
  check('같은 번호로 두 번 보내면 두 번째는 저장 안 함', duplicateStatus === '201/200/true', duplicateStatus);
  await ctx.close();
}

const browser = await launchBrowser();
try {
  await testDescriptionAliases(browser);
  await testMemberCannotEditAliases(browser);
  await testForecastAndSeasons(browser);
  await testOfflineOutbox(browser);
} catch (err) {
  reporter.fail(err);
} finally {
  await browser.close();
  await closeDb();
  reporter.finish();
}
