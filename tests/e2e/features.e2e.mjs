// 새 기능 E2E: 적요 묶기 · 자동완성 · 월말 예상 · 품목 시즌 · 오프라인 입력 · 알림 설정
import { BASE, SHOTS, closeDb, createReporter, launchBrowser, login, sql } from './config.mjs';

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

const browser = await launchBrowser();
try {
  await testDescriptionAliases(browser);
  await testMemberCannotEditAliases(browser);
} catch (err) {
  reporter.fail(err);
} finally {
  await browser.close();
  await closeDb();
  reporter.finish();
}
