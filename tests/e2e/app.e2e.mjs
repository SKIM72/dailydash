// DailyDash 핵심 화면 E2E: 로그인 · 입력/수정/삭제 · 월간/통계 · 권한 · 모바일 · PWA · 앱 다운로드
// 실행: tests/e2e/run-ci.sh (README.md 참고)
import { API, ADMIN_EMAIL, ADMIN_PASSWORD, BASE, SHOTS, createReporter, kstToday, launchBrowser } from './config.mjs';

const reporter = createReporter('핵심 화면');
const { check, watch } = reporter;
const DESC = `식혜${Date.now() % 100000}`;
const FIRST_OF_MONTH = `${kstToday().slice(0, 7)}-01`;

async function confirmModal(page, { accept = true } = {}) {
  const modal = page.locator('#custom-confirm-modal');
  await modal.waitFor({ state: 'visible' });
  const text = await page.locator('#confirm-message').innerText();
  await page.click(accept ? '#confirm-yes-btn' : '#confirm-no-btn');
  await modal.waitFor({ state: 'hidden' });
  return text;
}

async function alertModal(page) {
  const modal = page.locator('#custom-alert-modal');
  await modal.waitFor({ state: 'visible' });
  const text = await page.locator('#alert-message').innerText();
  await page.click('#alert-ok-btn');
  await modal.waitFor({ state: 'hidden' });
  return text;
}

async function waitToast(page, contains) {
  const toast = page.locator('.toast', { hasText: contains }).last();
  await toast.waitFor({ state: 'visible', timeout: 5000 });
  return toast;
}

const browser = await launchBrowser();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, locale: 'ko-KR', ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  watch(page, 'admin');

  // 1. 미로그인 상태로 메인 접근 → 로그인 페이지로
  await page.goto(`${BASE}/index.html`);
  await page.waitForURL(/login\.html/);
  check('미로그인 시 index → login 리다이렉트', page.url().includes('login.html'));
  await page.screenshot({ path: `${SHOTS}01-login.png` });

  // 2. 잘못된 비밀번호
  await page.fill('#loginEmail', ADMIN_EMAIL);
  await page.fill('#loginPassword', 'wrong-password');
  await page.click('#loginBtn');
  await page.waitForFunction(() => document.getElementById('loginError').textContent.length > 0);
  const loginFail = await page.innerText('#loginError');
  const fieldError = await page.locator('#loginPasswordField.has-error').count();
  check('잘못된 비밀번호 → 입력칸 아래 오류 표시 (텍스트 필드 오류 상태)', loginFail.includes('올바르지 않습니다') && fieldError === 1, loginFail);

  // 3. 비밀번호 찾기 화면: SMTP 미설정 안내
  await page.click('button[data-view="reset"]');
  await page.waitForTimeout(200);
  const noticeVisible = await page.locator('#resetDisabledNotice').isVisible();
  check('메일 미설정 서버의 비밀번호 찾기 안내', noticeVisible);
  await page.click('#reset-view button[data-view="login"]');

  // 4. 이전된 관리자 계정($2a 해시)으로 로그인
  await page.fill('#loginPassword', ADMIN_PASSWORD);
  await page.click('#loginBtn');
  await page.waitForURL(/index\.html/);
  await page.locator('#tableBody tr').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('#tableBody')?.innerText.includes('불러오는 중'));
  check('관리자 로그인 성공', page.url().includes('index.html'));

  // 5. 내역 입력 (빠른 금액 버튼 + Enter 로 확인)
  await page.fill('#desc', DESC);
  await page.fill('#count', '2');
  await page.click('.quick-amount-btn[data-target="cashIn"][data-amount="10000"]');
  await page.click('.quick-amount-btn[data-target="cashIn"][data-amount="5000"]');
  await page.fill('#cardIn', '7000');
  await page.fill('#remark2', '단골');
  check('입력 미리보기 계산', (await page.innerText('#entrySalesPreview')) === '22,000원', await page.innerText('#entrySalesPreview'));
  await page.click('#submitTransactionBtn');
  await page.locator('#custom-confirm-modal').waitFor({ state: 'visible' });
  const focusedId = await page.evaluate(() => document.activeElement?.id);
  check('저장 확인창은 확인 버튼에 포커스 (Enter 로 저장)', focusedId === 'confirm-yes-btn', focusedId);
  await page.keyboard.press('Enter');
  await waitToast(page, '입력 완료');
  await page.locator('#tableBody tr', { hasText: DESC }).waitFor();
  check('입력 후 토스트 + 표 반영 (알림창 클릭 불필요)', true);
  check('입력 후 폼 초기화', (await page.inputValue('#desc')) === '' && (await page.inputValue('#cashIn')) === '');
  await page.screenshot({ path: `${SHOTS}02-daily.png`, fullPage: true });

  // 6. 수정
  const row = page.locator('#tableBody tr', { hasText: DESC });
  await row.locator('.btn-edit').click();
  check('수정 모드 진입 (폼 채움)', (await page.inputValue('#desc')) === DESC && (await page.inputValue('#cashIn')) === '15,000');
  check('수정 모드 제목', (await page.innerText('#transactionFormTitle')).includes('내역 수정'));
  await page.screenshot({ path: `${SHOTS}03-edit-mode.png`, clip: { x: 0, y: 0, width: 1440, height: 500 } });
  await page.fill('#cashIn', '18000');
  await page.click('#submitTransactionBtn');
  const editConfirm = await confirmModal(page);
  check('수정 확인창에 변경 내역 표시', editConfirm.includes('현금 수입: 15,000원 → 18,000원'), editConfirm.replace(/\n/g, ' / '));
  await waitToast(page, '수정했습니다');
  await page.locator('#tableBody tr', { hasText: DESC }).filter({ hasText: '18,000' }).waitFor();
  check('수정 반영 + 수정 모드 해제', !(await page.locator('#cancelEditBtn').isVisible()));

  // 7. 삭제 → 되돌리기
  await page.locator('#tableBody tr', { hasText: DESC }).locator('.btn-danger').click();
  await page.locator('#custom-confirm-modal').waitFor({ state: 'visible' });
  const dangerFocus = await page.evaluate(() => document.activeElement?.id);
  check('삭제 확인창은 취소 버튼에 포커스', dangerFocus === 'confirm-no-btn', dangerFocus);
  await page.click('#confirm-yes-btn');
  const undoToast = await waitToast(page, '삭제했습니다');
  await page.waitForFunction((d) => !document.querySelector('#tableBody').innerText.includes(d), DESC);
  await undoToast.locator('.toast-action').click();
  await waitToast(page, '삭제를 취소했습니다');
  await page.locator('#tableBody tr', { hasText: DESC }).waitFor();
  check('삭제 후 되돌리기 복원', true);

  // 8. 특기사항: 저장 안 한 상태로 날짜 이동 시 보호
  await page.fill('#dailyNote', '오후에 비');
  check('특기사항 변경 표시', (await page.innerText('#noteStatus')).includes('저장되지 않은'));
  const beforeDate = await page.inputValue('#currentDate');
  await page.click('#prevDayBtn');
  await confirmModal(page, { accept: false });
  check('저장 안 한 특기사항이 있으면 날짜 이동 확인', (await page.inputValue('#currentDate')) === beforeDate);
  await page.click('#saveNoteBtn');
  await confirmModal(page);
  await waitToast(page, '특기사항을 저장했습니다');
  check('특기사항 저장 상태', (await page.innerText('#noteStatus')) === '저장됨');

  // 9. 날짜 이동 (버튼, 단축키, 오늘)
  await page.click('#prevDayBtn');
  await page.waitForTimeout(300);
  const prevDate = await page.inputValue('#currentDate');
  check('전날 버튼', prevDate < beforeDate, `${beforeDate} → ${prevDate}`);
  await page.locator('#desc').focus();
  await page.keyboard.press('Alt+ArrowRight');
  await page.waitForTimeout(300);
  check('Alt+→ 단축키로 다음날', (await page.inputValue('#currentDate')) === beforeDate);
  await page.click('#todayBtn');

  // 10. 월간 탭 + 상세 모달 + Esc
  await page.click('#tabMonthly');
  await page.locator('#monthlyTableBody tr.clickable-row').first().waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.querySelector('#monthTotalSales').textContent !== '0');
  const monthTotal = await page.innerText('#monthTotalSales');
  check('월간 총매출 집계', monthTotal !== '0', monthTotal);
  await page.locator('#monthCompareList .compare-row').nth(2).waitFor();
  const compareLabels = await page.locator('#monthCompareList .compare-row strong').allInnerTexts();
  check('기간 비교: 이번 달은 전월·전년 "같은 기간"과 비교', compareLabels.includes('전월 같은 기간') && compareLabels.includes('전년 같은 기간'), compareLabels.join(', '));
  const currentPeriod = await page.innerText('#monthCompareList .compare-row--current small');
  const today = kstToday();
  check('기간 비교: 이번 달은 오늘까지만 집계', currentPeriod.endsWith(today.slice(5).replace('-', '.')), currentPeriod);
  await page.locator('details#monthlyDetailFold > summary').click();
  await page.locator('#monthlyTableBody tr', { hasText: FIRST_OF_MONTH }).click();
  await page.locator('#detailModalTableBody tr', { hasText: '미숫가루' }).first().waitFor();
  check('일자 상세 모달', true);
  await page.keyboard.press('Escape');
  await page.locator('#dailyDetailModal').waitFor({ state: 'hidden' });
  check('Esc 로 상세 모달 닫힘', true);
  await page.screenshot({ path: `${SHOTS}04-monthly.png`, fullPage: true });

  // 11. 총 통계 + 기간 프리셋 + 차트 + 엑셀
  await page.click('#tabTotal');
  await page.click('[data-range-preset="last30"]');
  await page.waitForFunction(() => document.querySelector('#rangeTotalSales').textContent !== '0');
  await page.waitForFunction(() => {
    const canvas = document.getElementById('totalTrendChart');
    return canvas && canvas.width > 0 && canvas.getContext('2d') && window.getComputedStyle(canvas).display !== 'none';
  });
  await page.waitForTimeout(1500);
  const chartDrawn = await page.evaluate(() => {
    const canvas = document.getElementById('totalTrendChart');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let i = 3; i < data.length; i += 4 * 50) if (data[i] > 0) painted += 1;
    return painted;
  });
  check('기간 프리셋 조회 + 차트 그려짐 (지연 로딩)', chartDrawn > 10, `painted samples ${chartDrawn}`);
  await page.locator('details#rangeDetailFold > summary').click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#downloadTotalExcelBtn')
  ]);
  check('엑셀 다운로드 (지연 로딩)', download.suggestedFilename().endsWith('.xlsx'), download.suggestedFilename());
  await page.screenshot({ path: `${SHOTS}05-total.png`, fullPage: true });

  // 12. 마이페이지: 서버 작업 이력 + 사용자 관리 + 다크 모드
  await page.click('#myPageBtn');
  await page.click('[data-tab="history"]');
  await page.locator('#operationHistoryList .operation-history-item').first().waitFor();
  const historyText = await page.innerText('#operationHistoryList');
  check('탭: 작업 이력 탭에 입력/수정/삭제/복원/엑셀 기록', ['내역 입력', '내역 수정', '내역 삭제', '내역 복원', '엑셀 백업'].every((t) => historyText.includes(t)));
  await page.click('[data-tab="users"]');
  await page.locator('#approvalListBody tr', { hasText: '@' }).first().waitFor();
  check('탭: 관리자 사용자 관리', (await page.innerText('#approvalListBody')).includes(ADMIN_EMAIL));
  await page.click('[data-tab="settings"]');
  await page.click('[data-theme-option="dark"]');
  check('세그먼트 버튼: 다크 모드 적용', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await page.screenshot({ path: `${SHOTS}06-mypage-dark.png` });
  await page.keyboard.press('Escape');
  await page.locator('#myPageModal').waitFor({ state: 'hidden' });
  await page.click('#tabTotal');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}07-total-dark.png`, fullPage: true });
  await page.click('#tabDaily');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}08-daily-dark.png` });

  // 13. 새 사용자 가입 → 관리자 승인 → 일반 사용자 권한 확인 (별도 브라우저)
  const memberCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
  const member = await memberCtx.newPage();
  watch(member, 'member');
  const memberEmail = `staff${Date.now()}@test.com`;
  await member.goto(`${BASE}/login.html`);
  await member.click('button[data-view="signup"]');
  await member.fill('#signupEmail', memberEmail);
  await member.fill('#signupPassword', 'staffpass1');
  await member.fill('#signupConfirmPassword', 'staffpass1');
  await member.click('#signupBtn');
  const signupMsg = await alertModal(member);
  check('회원가입 → 승인 대기 안내', signupMsg.includes('승인'), signupMsg.split('\n')[0]);
  await member.fill('#loginPassword', 'staffpass1');
  await member.click('#loginBtn');
  const pendingMsg = await alertModal(member);
  check('승인 전 로그인 차단', pendingMsg.includes('승인'), pendingMsg.split('\n')[0]);

  await page.click('#myPageBtn');
  await page.click('[data-tab="users"]');
  const memberRow = page.locator('#approvalListBody tr', { hasText: memberEmail });
  await memberRow.waitFor();
  await memberRow.locator('.user-action-btn.is-approve').click();
  await confirmModal(page);
  await waitToast(page, '승인했습니다');
  check('관리자 승인 처리', (await page.locator('#approvalListBody tr', { hasText: memberEmail }).innerText()).includes('사용 중'));
  await page.keyboard.press('Escape');

  await member.click('#loginBtn');
  await member.waitForURL(/index\.html/);
  await member.waitForFunction(() => !document.querySelector('#tableBody')?.innerText.includes('불러오는 중'));
  const memberCanEdit = await member.locator('#tableBody .btn-edit').count();
  const lockCount = await member.locator('#tableBody .sensitive-locked').count();
  check('일반 사용자는 수정/삭제 버튼 없음', memberCanEdit === 0 && lockCount > 0, `edit=${memberCanEdit} lock=${lockCount}`);
  await member.screenshot({ path: `${SHOTS}09-member-mobile.png`, fullPage: true });
  const forbidden = await member.evaluate(async (api) => {
    const token = localStorage.getItem('dailydash-session-token');
    const res = await fetch(`${api}/api/transactions/6`, { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return res.status;
  }, API);
  check('일반 사용자 API 직접 삭제 차단 (서버 권한)', forbidden === 403, `status ${forbidden}`);

  // 13-b. 새 컴포넌트 (데스크톱): 계정 메뉴 · 스위치 · 슬라이더 · 배너
  await page.keyboard.press('Escape').catch(() => {});
  await page.click('#tabDaily');
  await page.click('#accountMenuBtn');
  await page.locator('#accountMenu').waitFor({ state: 'visible' });
  check('메뉴: 계정 메뉴 열림 (이메일 표시)', (await page.innerText('#accountMenu')).includes(ADMIN_EMAIL));
  await page.keyboard.press('Escape');
  await page.locator('#accountMenu').waitFor({ state: 'hidden' });
  check('메뉴: Esc 로 닫힘', true);

  await page.click('#accountMenu [data-action="settings"]', { force: true }).catch(async () => {
    await page.click('#accountMenuBtn');
    await page.click('#accountMenu [data-action="settings"]');
  });
  await page.locator('[data-tab-panel="settings"]').waitFor({ state: 'visible' });
  const slider = page.locator('#textScaleSlider');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const scale = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--text-scale').trim());
  check('슬라이더: 글자 크기 110%', scale === '1.1' && (await page.innerText('#textScaleValue')) === '110%', `scale=${scale}`);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.click('.switch');
  check('스위치: 저장 전 확인창 끔', !(await page.isChecked('#confirmBeforeSaveSwitch')));
  await page.keyboard.press('Escape');
  await page.fill('#desc', `${DESC}-빠른입력`);
  await page.fill('#cashIn', '3000');
  await page.click('#submitTransactionBtn');
  await waitToast(page, '입력 완료');
  check('스위치 끔 → 확인창 없이 바로 저장', !(await page.locator('#custom-confirm-modal').isVisible()));
  await page.click('#accountMenuBtn');
  await page.click('#accountMenu [data-action="settings"]');
  await page.click('.switch');
  check('스위치: 다시 켬', await page.isChecked('#confirmBeforeSaveSwitch'));
  await page.keyboard.press('Escape');

  await page.route('**/api/**', (route) => route.abort());
  await page.click('#refreshViewBtn');
  await page.locator('#networkBanner').waitFor({ state: 'visible' });
  check('배너: 서버 연결 끊기면 표시', true);
  await page.screenshot({ path: `${SHOTS}12-banner.png`, clip: { x: 0, y: 0, width: 1440, height: 420 } });
  await page.unroute('**/api/**');
  await page.click('#networkRetryBtn');
  await page.locator('#networkBanner').waitFor({ state: 'hidden' });
  check('배너: 다시 시도 → 연결되면 사라짐', true);

  // 13-c. 새 컴포넌트 (모바일 관리자): FAB · 바텀시트 · 리스트 · 동작 메뉴 · 드로어 · 하단 내비게이션
  const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
  const mobile = await mobileCtx.newPage();
  watch(mobile, 'mobile-admin');
  await mobile.goto(`${BASE}/login.html`);
  await mobile.fill('#loginEmail', ADMIN_EMAIL);
  await mobile.fill('#loginPassword', ADMIN_PASSWORD);
  await mobile.click('#loginBtn');
  await mobile.waitForURL(/index\.html/);
  await mobile.locator('#txList .list-item, #txList .empty-state').first().waitFor();
  check('모바일: 표 대신 리스트 표시', (await mobile.locator('#txList').isVisible()) && !(await mobile.locator('#transactionTable').isVisible()));
  await mobile.click('#entryFab');
  await mobile.locator('#entryPanel.is-open').waitFor();
  check('FAB: 입력 바텀시트 열림', true);
  await mobile.fill('#desc', `${DESC}-모바일`);
  await mobile.fill('#count', '1');
  await mobile.click('.quick-amount-btn[data-target="cardIn"][data-amount="5000"]');
  await mobile.click('#submitTransactionBtn');
  await confirmModal(mobile);
  await waitToast(mobile, '입력 완료');
  check('바텀시트: 저장 후 연속 입력 위해 열린 상태 유지', await mobile.locator('#entryPanel.is-open').count() === 1);
  await mobile.click('.entry-panel__close');
  await mobile.locator('#entryPanel.is-open').waitFor({ state: 'detached' });
  const mobileItem = mobile.locator('#txList .list-item', { hasText: `${DESC}-모바일` });
  await mobileItem.waitFor();
  check('리스트: 새 항목 표시 (금액 포함)', (await mobileItem.innerText()).includes('5,000원'));
  await mobileItem.locator('.icon-btn').click();
  await mobile.locator('body > .menu').waitFor();
  await mobile.locator('body > .menu .menu-item', { hasText: '수정' }).click();
  await mobile.locator('#entryPanel.is-open').waitFor();
  check('동작 메뉴 → 수정: 시트가 수정 모드로 열림', (await mobile.inputValue('#desc')) === `${DESC}-모바일` && (await mobile.innerText('#transactionFormTitle')).includes('수정'));
  await mobile.fill('#cardIn', '6000');
  await mobile.click('#submitTransactionBtn');
  await confirmModal(mobile);
  await waitToast(mobile, '수정했습니다');
  await mobile.locator('#entryPanel.is-open').waitFor({ state: 'detached' });
  check('수정 저장 후 시트 닫힘 + 반영', (await mobileItem.innerText()).includes('6,000원'));
  await mobile.click('.top-app-bar__menu');
  await mobile.locator('#navDrawer.is-open').waitFor();
  await mobile.click('#navDrawer [data-nav="monthly"]');
  await mobile.locator('#navDrawer.is-open').waitFor({ state: 'detached' });
  await mobile.waitForFunction(() => document.getElementById('pageTitle').textContent === '월간 요약', null, { timeout: 5000 }).catch(() => {});
  check('드로어: 열고 월간 요약으로 이동', (await mobile.innerText('#pageTitle')) === '월간 요약');
  await mobile.click('.bottom-nav__item[data-nav="total"]');
  await mobile.waitForFunction(() => document.getElementById('pageTitle').textContent === '통계 분석');
  check('하단 내비게이션: 통계 분석으로 이동 + FAB 숨김', await mobile.locator('#entryFab.is-hidden').count() === 1);
  await mobileCtx.close();

  // 13-d. PWA · 앱 설치 · 바로가기 · 전환 방향
  const manifest = await page.evaluate(async (base) => (await fetch(`${base}/manifest.json`)).json(), API === BASE ? BASE : BASE);
  const iconStatuses = await page.evaluate(async ({ base, icons }) => Promise.all(icons.map(async (icon) => (await fetch(`${base}/${icon}`)).status)), { base: BASE, icons: [...manifest.icons.map((i) => i.src), 'icons/apple-touch-icon.png', 'icons/favicon-32.png'] });
  check('매니페스트: 아이콘 6종 모두 존재 + 마스크형 포함', iconStatuses.every((s) => s === 200) && manifest.icons.some((i) => i.purpose === 'maskable'), iconStatuses.join(','));
  check('매니페스트: 앱 바로가기 3개', manifest.shortcuts?.length === 3);
  const iconSize = await page.evaluate(async (base) => {
    const img = new Image();
    img.src = `${base}/icons/icon-512.png`;
    await img.decode();
    return `${img.naturalWidth}x${img.naturalHeight}`;
  }, BASE);
  check('앱 아이콘: 정사각형 512×512', iconSize === '512x512', iconSize);

  await page.goto(`${BASE}/index.html?view=monthly`);
  await page.waitForFunction(() => document.getElementById('pageTitle').textContent === '월간 요약');
  check('바로가기 ?view=monthly → 월간 요약으로 시작 + 주소 정리', !page.url().includes('?'), page.url());
  await page.click('#tabTotal');
  check('전환 방향: 오른쪽 메뉴로 → forward', await page.evaluate(() => document.documentElement.dataset.navDirection) === 'forward');
  await page.click('#tabDaily');
  check('전환 방향: 왼쪽 메뉴로 → back', await page.evaluate(() => document.documentElement.dataset.navDirection) === 'back');
  await page.waitForTimeout(500);
  check('전환 후 화면은 하나만 보임', await page.locator('.view:not(.hidden-view)').count() === 1);
  check('데스크톱 드로어에 앱 설치 메뉴', await page.locator('#navDrawer a[href="install.html"]').isVisible());

  const iosCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
  });
  const ios = await iosCtx.newPage();
  watch(ios, 'ios');
  await ios.goto(`${BASE}/login.html`);
  await ios.click('.auth-install-link a');
  await ios.waitForURL(/install\.html/);
  check('로그인 화면 → 앱 설치 페이지 이동', true);
  const iosGuide = ios.locator('.install-guide[data-platform="ios"]');
  check('설치 페이지: 아이폰 안내가 펼쳐지고 "이 기기" 표시', await iosGuide.evaluate((el) => el.open) && await iosGuide.locator('[data-this-device]').isVisible());
  check('설치 페이지: 아이폰 안내가 맨 위', await ios.evaluate(() => document.querySelector('.install-guides > details').dataset.platform) === 'ios');
  await ios.locator('#qrCode svg path').waitFor({ state: 'attached' });
  check('설치 페이지: QR 코드 생성', true);
  check('아이폰: 상단 APK 다운로드 버튼은 숨김', await ios.locator('#apkBtn').isHidden());
  await iosCtx.close();

  // 13-e. 안드로이드 APK 다운로드 · 앱(TWA) 실행 · 인증 파일
  const apkInfo = await (await fetch(`${BASE}/downloads/dailydash-apk.json`)).json();
  const androidUa = 'Mozilla/5.0 (Linux; Android 15; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
  const androidCtx = await browser.newContext({ viewport: { width: 384, height: 832 }, isMobile: true, hasTouch: true, locale: 'ko-KR', userAgent: androidUa, acceptDownloads: true });
  const android = await androidCtx.newPage();
  watch(android, 'android');
  await android.goto(`${BASE}/install.html`);
  await android.locator('#apkBtn').waitFor({ state: 'visible' });
  check('안드로이드: 상단에 "안드로이드 앱 다운로드" 버튼', (await android.innerText('#apkBtn')).includes('안드로이드 앱 다운로드'));
  const heroMeta = await android.innerText('#apkHeroMeta');
  check('안드로이드: 버전·용량·최소 버전 표시', heroMeta.includes(`버전 ${apkInfo.versionName}`) && /\d\.\dMB/.test(heroMeta) && heroMeta.includes('7.0 이상'), heroMeta);
  check('안드로이드: 브라우저 설치 버튼은 숨김', await android.locator('#installBtn').isHidden());
  check('안드로이드: 안드로이드 안내가 맨 위·펼침', await android.evaluate(() => {
    const first = document.querySelector('.install-guides > details');
    return first.dataset.platform === 'android' && first.open;
  }));
  const [apkDownload] = await Promise.all([android.waitForEvent('download'), android.click('#apkBtn')]);
  const downloadPath = await apkDownload.path();
  const { statSync } = await import('node:fs');
  check('안드로이드: APK 파일 다운로드', apkDownload.suggestedFilename() === `DailyDash-${apkInfo.versionName}.apk` && statSync(downloadPath).size === apkInfo.size, `${apkDownload.suggestedFilename()} ${statSync(downloadPath).size}B`);
  check('안드로이드: 다운로드 안내 스낵바', (await android.locator('.toast-message').last().innerText()).includes('알림에서 파일을 열어'));
  check('FAQ: APK 파일 SHA-256 표시', (await android.locator('#apkSha256').textContent()) === apkInfo.sha256);

  const shortcutIconStatuses = await Promise.all(manifest.shortcuts.flatMap((s) => s.icons.map(async (icon) => (await fetch(`${BASE}/${icon.src}`)).status)));
  check('매니페스트: 바로가기 아이콘 6종 존재', shortcutIconStatuses.length === 6 && shortcutIconStatuses.every((s) => s === 200), shortcutIconStatuses.join(','));

  const assetLinks = await (await fetch(`${API}/.well-known/assetlinks.json`)).json();
  const target = assetLinks[0]?.target || {};
  check('서버: assetlinks.json 이 APK 서명·패키지와 일치', target.package_name === apkInfo.packageId && target.sha256_cert_fingerprints?.includes(apkInfo.certificateSha256), target.package_name);

  // APK 앱이 여는 첫 주소(?source=twa)로 들어오면 로그인 뒤에도 '앱 다운로드' 메뉴를 숨긴다.
  const twa = await androidCtx.newPage();
  watch(twa, 'twa');
  await twa.goto(`${BASE}/index.html?source=twa`);
  await twa.waitForURL(/login\.html/);
  check('앱(TWA): 로그인 화면의 앱 다운로드 링크 숨김', await twa.locator('.auth-install-link').isHidden());
  await twa.fill('#loginEmail', ADMIN_EMAIL);
  await twa.fill('#loginPassword', ADMIN_PASSWORD);
  await twa.click('#loginBtn');
  await twa.waitForURL(/index\.html/);
  await twa.locator('#pageTitle').waitFor();
  check('앱(TWA): 메뉴의 앱 다운로드 항목 숨김', await twa.evaluate(() => [...document.querySelectorAll('[data-install-entry]')].every((el) => el.classList.contains('hidden-view'))));
  await twa.goto(`${BASE}/install.html`);
  await twa.locator('#installedStatus').waitFor({ state: 'visible' });
  check('앱(TWA): 설치 페이지에 "앱으로 실행 중" 표시 + 다운로드 버튼 숨김', await twa.locator('#apkBtn').isHidden());
  await androidCtx.close();

  const shortcutCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', ignoreHTTPSErrors: true });
  const shortcut = await shortcutCtx.newPage();
  await shortcut.goto(`${BASE}/login.html`);
  await shortcut.fill('#loginEmail', ADMIN_EMAIL);
  await shortcut.fill('#loginPassword', ADMIN_PASSWORD);
  await shortcut.click('#loginBtn');
  await shortcut.waitForURL(/index\.html/);
  await shortcut.goto(`${BASE}/index.html?view=daily&action=new`);
  await shortcut.locator('#entryPanel.is-open').waitFor();
  check('바로가기 ?action=new → 모바일 입력 시트 바로 열림', true);
  await shortcutCtx.close();

  // 14. 로그아웃
  const tokenBefore = await page.evaluate(() => localStorage.getItem('dailydash-session-token'));
  if (process.env.API) check('교차 출처 모드: 토큰 저장됨', Boolean(tokenBefore));
  await page.click('#logoutBtn');
  await confirmModal(page);
  await page.waitForURL(/login\.html/);
  const meAfter = await page.evaluate(async ({ api, token }) => {
    const res = await fetch(`${api}/api/auth/me`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return res.status;
  }, { api: API, token: tokenBefore });
  check('로그아웃 후 세션 제거 (이전 토큰도 무효)', meAfter === 401, `status ${meAfter}`);
  if (process.env.API) check('교차 출처 모드: 로그아웃 시 토큰 삭제', !(await page.evaluate(() => localStorage.getItem('dailydash-session-token'))));
  await memberCtx.close();
  await ctx.close();
} catch (err) {
  reporter.fail(err);
} finally {
  await browser.close();
  reporter.finish();
}
