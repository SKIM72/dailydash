import '../style.css';
import { api, getCurrentUser } from './services/api.js';
import { bindDismissibleModal, installModalHandlers } from './shared/modal.js';
import { showToast } from './shared/toast.js';
import { appendCell, setText } from './shared/dom.js';
import { formatCommas, formatPercent, formatWon, parseCommas } from './shared/format.js';
import { formatDateKey, getDayName, getKstToday, getPreviousMonth, parseDateKey } from './shared/date.js';
import { FORECAST_METHOD_LABELS, forecastMonthEnd } from '../server/src/forecast.js';
import {
    analyzeSalesFlow,
    buildDailySummaryFromView,
    compareTotals,
    createInsightMessages,
    summarizeDailyMap,
    summarizeDescriptions,
    summarizeWeekdayPerformance
} from './features/analytics.js';
import { iconElement, iconSvg } from './shared/icons.js';
import { installConfirmSwitch, installTextScaleSlider, isConfirmBeforeSave } from './shared/settings.js';
import { installThemeControls } from './shared/theme.js';
import { hideInstallEntriesWhenStandalone, registerServiceWorker } from './shared/pwa.js';
import { OUTBOX_EVENT, addToOutbox, flushOutbox, newClientId, readOutbox, removeFromOutbox } from './shared/outbox.js';
import { DEFAULT_REMINDER_TIME, disableReminder, enableReminder, getReminderState, isPushSupported, sendTestReminder, updateReminderTime } from './shared/reminders.js';
import {
    createSheet,
    installDrawer,
    installMenus,
    installNavIndicators,
    installTabs,
    isMobileLayout,
    runViewTransition,
    showActionMenu
} from './shared/ui.js';
import { APP_VERSION_LABEL, renderVersionLabels } from './shared/version.js';

installModalHandlers();
installThemeControls();
installMenus();

document.addEventListener('DOMContentLoaded', () => {
    renderVersionLabels();

    // 배포 후 열려 있던 화면에는 새로고침을 안내한다.
    registerServiceWorker({
        onUpdate: () => showToast('새 버전이 준비됐어요.', {
            tone: 'info',
            duration: 10 * 60 * 1000,
            actionLabel: '새로고침',
            onAction: () => window.location.reload()
        })
    });
    hideInstallEntriesWhenStandalone();

    // DOM 요소 캐싱
    const datePicker = document.getElementById('currentDate');
    const form = document.getElementById('transactionForm');
    const submitTransactionBtn = document.getElementById('submitTransactionBtn');
    const tableBody = document.getElementById('tableBody');
    const noteInput = document.getElementById('dailyNote');
    const saveNoteBtn = document.getElementById('saveNoteBtn');
    const elTotalCount = document.getElementById('totalCount');
    const elTotalCashIn = document.getElementById('totalCashIn');
    const elTotalCashOut = document.getElementById('totalCashOut');
    const elTotalCardIn = document.getElementById('totalCardIn');
    
    const tabDaily = document.getElementById('tabDaily');

    const viewDaily = document.getElementById('viewDaily');
    const viewMonthly = document.getElementById('viewMonthly');
    const viewTotal = document.getElementById('viewTotal');
    
    const monthPicker = document.getElementById('currentMonth');
    const monthlyTableBody = document.getElementById('monthlyTableBody');

    // 4번 기능: 총 통계 관리 객체 노드 바인딩
    const totalStartDate = document.getElementById('totalStartDate');
    const totalEndDate = document.getElementById('totalEndDate');
    const loadTotalBtn = document.getElementById('loadTotalBtn');
    const totalTableBody = document.getElementById('totalTableBody');
    const downloadTotalExcelBtn = document.getElementById('downloadTotalExcelBtn');

    const myPageModal = document.getElementById('myPageModal');
    const closeMyPage = document.getElementById('closeMyPage');
    const loggedInEmail = document.getElementById('loggedInEmail');
    const loggedInRole = document.getElementById('loggedInRole');
    const superUserPanel = document.getElementById('superUserPanel');
    const approvalListBody = document.getElementById('approvalListBody');
    const operationHistoryList = document.getElementById('operationHistoryList');
    const refreshOperationHistoryBtn = document.getElementById('refreshOperationHistoryBtn');
    const changePasswordForm = document.getElementById('changePasswordForm');

    const downloadExcelBtn = document.getElementById('downloadExcelBtn');
    const transactionFormTitle = document.getElementById('transactionFormTitle');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const noteStatus = document.getElementById('noteStatus');
    const txList = document.getElementById('txList');
    const entryFab = document.getElementById('entryFab');
    const topAppBar = document.getElementById('topAppBar');
    const networkBanner = document.getElementById('networkBanner');

    const VIEWS = {
        daily: { el: viewDaily, title: '일일 내역' },
        monthly: { el: viewMonthly, title: '월간 요약' },
        total: { el: viewTotal, title: '통계 분석' }
    };
    let currentView = 'daily';

    // 전역 차트 인스턴스 핸들 객체 (중복 생성 방지용)
    let trendChartInstance = null;
    let currentChartMode = 'sales';
    let lastTrendDailySummary = null;
    let currentUser = null;
    let currentUserEmail = '';
    // 관리자가 '수정'을 누른 내역. null 이면 새 내역 입력 모드.
    let editingTransaction = null;
    // 날짜를 빠르게 바꿀 때 늦게 도착한 이전 날짜 응답이 화면을 덮어쓰지 않도록 요청 순번을 둔다.
    let dailyLoadSeq = 0;
    let monthlyLoadSeq = 0;
    let rangeLoadSeq = 0;
    let savedNoteText = '';
    let currentDailyDate = '';
    let detailModalDate = '';

    if (!datePicker || !tabDaily || !tableBody) return;

    const myPageDialog = bindDismissibleModal(myPageModal, closeMyPage);
    const detailDialog = bindDismissibleModal(document.getElementById('dailyDetailModal'), document.getElementById('closeDetailModal'));
    const drawer = installDrawer(document.getElementById('navDrawer'), document.getElementById('drawerScrim'));
    const navIndicators = installNavIndicators();
    const entrySheet = createSheet(document.getElementById('entryPanel'), document.getElementById('sheetScrim'), {
        onOpen: () => document.getElementById('desc')?.focus({ preventScroll: true })
    });
    const myPageTabs = installTabs(document.getElementById('myPageTabs'), myPageModal, {
        onChange: (tab) => {
            if (tab === 'history') loadOperationHistory();
            if (tab === 'users' && isSuperAdmin()) loadUserManagement();
            if (tab === 'items' && isSuperAdmin()) loadItemManagement();
            if (tab === 'settings') loadReminderSetting();
        }
    });
    installTextScaleSlider(document.getElementById('textScaleSlider'), document.getElementById('textScaleValue'));
    installConfirmSwitch(document.getElementById('confirmBeforeSaveSwitch'));

    function isSuperAdmin() {
        return currentUser?.role === 'admin';
    }

    function formatKstDateTime(value = new Date()) {
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return '-';
        return date.toLocaleString('ko-KR', {
            timeZone: 'Asia/Seoul',
            year: '2-digit',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    }

    function getBackupTimestamp(value = new Date()) {
        const kst = new Date(value.getTime() + 9 * 60 * 60 * 1000);
        return kst.toISOString().slice(0, 16).replace(/[-:T]/g, '');
    }

    function sanitizeFilePart(value) {
        return String(value || 'backup').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
    }

    function renderHistoryMessage(text) {
        const message = document.createElement('p');
        message.className = 'operation-history-empty';
        message.textContent = text;
        operationHistoryList.replaceChildren(message);
    }

    // 작업 이력은 서버(audit_logs)에 남는다. 관리자는 전체, 일반 사용자는 본인 작업만 보인다.
    async function loadOperationHistory() {
        if (!operationHistoryList) return;
        renderHistoryMessage('작업 이력을 불러오는 중...');
        let items;
        try {
            items = await api.auditLogs(30);
        } catch (err) {
            renderHistoryMessage(`작업 이력을 불러오지 못했습니다. (${err.message})`);
            return;
        }

        if (!items.length) {
            renderHistoryMessage('아직 기록된 작업이 없습니다.');
            return;
        }

        operationHistoryList.replaceChildren();
        items.forEach((item) => {
            const entry = document.createElement('article');
            entry.className = 'operation-history-item';

            const head = document.createElement('div');
            head.className = 'operation-history-item-head';

            const label = document.createElement('strong');
            label.textContent = item.label || item.action || '작업';
            const type = document.createElement('span');
            type.textContent = item.action || '작업';
            head.append(label, type);

            const meta = document.createElement('small');
            meta.textContent = `${formatKstDateTime(item.at)} · ${item.user_email || '시스템'}`;

            entry.append(head, meta);
            if (Array.isArray(item.details) && item.details.length) {
                const detail = document.createElement('p');
                detail.textContent = item.details.filter(Boolean).join(' · ');
                entry.appendChild(detail);
            }
            operationHistoryList.appendChild(entry);
        });
    }

    function applySensitiveActionGuard() {
        const locked = !isSuperAdmin();
        [downloadExcelBtn, downloadTotalExcelBtn].forEach((button) => {
            if (!button) return;
            button.disabled = locked;
            button.classList.toggle('is-locked', locked);
            button.title = locked ? '관리자만 엑셀 백업을 실행할 수 있습니다.' : '엑셀 백업 다운로드';
        });
    }

    function buildTransactionSummary(tx) {
        const people = getTransactionAmount(tx, 'customer_count');
        const cash = getTransactionAmount(tx, 'cash_income');
        const card = getTransactionAmount(tx, 'card_income');
        const expense = getTransactionAmount(tx, 'cash_expense');
        const sales = cash + card;
        return {
            people,
            cash,
            card,
            expense,
            sales,
            label: `${tx.transaction_date || datePicker.value} · ${tx.description || '적요 없음'}`
        };
    }

    ['count', 'cashIn', 'cardIn', 'cashOut'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', (e) => {
                e.target.value = formatCommas(e.target.value);
                updateEntryPreview();
            });
        }
    });

    document.querySelectorAll('.quick-amount-btn').forEach((button) => {
        button.addEventListener('click', () => {
            const input = document.getElementById(button.dataset.target);
            if (!input) return;

            if (button.dataset.clear === 'true') {
                input.value = '';
            } else {
                const nextValue = parseCommas(input.value) + parseCommas(button.dataset.amount);
                input.value = formatCommas(nextValue);
            }

            updateEntryPreview();
            input.focus();
        });
    });

    document.querySelectorAll('[data-chart-mode]').forEach((button) => {
        button.addEventListener('click', () => {
            currentChartMode = button.dataset.chartMode || 'sales';
            updateChartModeButtons();
            if (lastTrendDailySummary) renderAdvancedAnalytics(lastTrendDailySummary);
        });
    });

    // 커스텀 요일 표기 디스플레이 유틸리티
    function formatKoreanDate(dateStr) {
        const [, month, day] = dateStr.split('-').map(Number);
        return `${month}월 ${day}일 (${getDayName(dateStr)})`;
    }

    function updateDateDisplay(dateStr) {
        if (!dateStr) return;
        const dayName = getDayName(dateStr);
        document.getElementById('dateDisplay').textContent = `${dateStr} (${dayName})`;
        setText('entryDateChip', `기준일 · ${formatKoreanDate(dateStr)}`);
        const isToday = dateStr === getKstToday();
        setText('dailySalesLabel', isToday ? '오늘 총매출' : '이날 총매출');
        setText('txCardTitleText', isToday ? '오늘의 내역' : `${formatKoreanDate(dateStr)} 내역`);
        if (currentView === 'daily') updateAppBar();
    }

    function updateMonthDisplay(monthStr) {
        if (!monthStr) return;
        const parts = monthStr.split('-');
        document.getElementById('monthDisplay').textContent = `${parts[0]}년 ${parts[1]}월`;
        if (currentView === 'monthly') updateAppBar();
    }

    // 상단 앱 바 제목/부제목을 현재 화면에 맞춘다.
    function updateAppBar() {
        setText('pageTitle', VIEWS[currentView].title);
        let subtitle = '';
        if (currentView === 'daily' && datePicker.value) {
            subtitle = datePicker.value === getKstToday() ? `오늘 · ${formatKoreanDate(datePicker.value)}` : formatKoreanDate(datePicker.value);
        } else if (currentView === 'monthly' && monthPicker.value) {
            const [year, month] = monthPicker.value.split('-');
            subtitle = `${year}년 ${Number(month)}월 정산 요약`;
        } else if (currentView === 'total' && totalStartDate.value && totalEndDate.value) {
            subtitle = `${totalStartDate.value} ~ ${totalEndDate.value}`;
        }
        setText('pageSubtitle', subtitle);
        document.title = `${VIEWS[currentView].title} - DailyDash`;
    }

    function updateGenericDateDisplay(inputEl, displayId, defaultText) {
        if (!inputEl.value) {
            document.getElementById(displayId).textContent = defaultText;
            return;
        }
        document.getElementById(displayId).textContent = `${inputEl.value} (${getDayName(inputEl.value)})`;
    }

    function updateEntryPreview() {
        const count = parseCommas(document.getElementById('count')?.value);
        const cashIn = parseCommas(document.getElementById('cashIn')?.value);
        const cardIn = parseCommas(document.getElementById('cardIn')?.value);
        const cashOut = parseCommas(document.getElementById('cashOut')?.value);
        const totalSales = cashIn + cardIn;
        const netCash = cashIn - cashOut;
        const averageTicket = count > 0 ? Math.round(totalSales / count) : 0;

        setText('entrySalesPreview', formatWon(totalSales));
        setText('entryCashPreview', formatWon(netCash));
        setText('entryTicketPreview', formatWon(averageTicket));
        document.getElementById('entryCashPreview')?.classList.toggle('is-negative', netCash < 0);
    }

    function updateChartModeButtons() {
        document.querySelectorAll('[data-chart-mode]').forEach((button) => {
            const isActive = button.dataset.chartMode === currentChartMode;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-selected', String(isActive));
        });
    }

    function fetchDailySalesSummary(startStr, endStr) {
        return api.dailySummary(startStr, endStr);
    }

    // 관리자가 묶어 둔 적요 대표 이름 (분석 전용 - 원본 내역은 그대로)
    let aliasMapPromise = null;
    function getAliasMap() {
        aliasMapPromise ||= api.descriptionAliases()
            .then((data) => ({ map: new Map(Object.entries(data.aliases || {})), notAnItem: data.notAnItem }))
            .catch(() => ({ map: new Map(), notAnItem: '(품목 아님)' }));
        return aliasMapPromise;
    }

    // 분석용 건별 내역: 묶어 둔 적요는 대표 이름으로 바꾸고, '(품목 아님)' 은 품목 분석에서 뺀다.
    async function fetchTransactionsForRange(startStr, endStr) {
        const [transactions, { map, notAnItem }] = await Promise.all([api.listTransactionsInRange(startStr, endStr), getAliasMap()]);
        return transactions
            .map((tx) => {
                const canonical = map.get(String(tx.description || '').trim());
                return canonical ? { ...tx, description: canonical } : tx;
            })
            .filter((tx) => tx.description !== notAnItem);
    }

    // 적요 입력 자동완성 (최근 1년 동안 많이 쓴 대표 이름)
    const descSuggestions = document.getElementById('descSuggestions');
    async function loadDescriptionSuggestions() {
        try {
            const names = await api.descriptionSuggestions();
            descSuggestions?.replaceChildren(...names.map((name) => new Option(name)));
        } catch (err) {
            console.warn('적요 자동완성 목록을 불러오지 못했습니다.', err);
        }
    }

    function rememberDescriptionSuggestion(name) {
        if (!descSuggestions || !name || [...descSuggestions.options].some((option) => option.value === name)) return;
        descSuggestions.prepend(new Option(name));
    }

    // 기간 통계 화면에서 쓰는 4가지 데이터를 동시에 받아온다. (기존엔 순서대로 4번 기다렸음)
    async function fetchPeriodBundle(startStr, endStr, prevStartStr, prevEndStr) {
        const [summaryRows, prevSummaryRows, transactions, previousTransactions] = await Promise.all([
            fetchDailySalesSummary(startStr, endStr),
            fetchDailySalesSummary(prevStartStr, prevEndStr),
            fetchTransactionsForRange(startStr, endStr),
            fetchTransactionsForRange(prevStartStr, prevEndStr)
        ]);
        return { summaryRows, prevSummaryRows, transactions, previousTransactions };
    }

    function shiftDateKey(dateStr, days) {
        const date = parseDateKey(dateStr);
        date.setDate(date.getDate() + days);
        return formatDateKey(date);
    }

    function setEmptyTableMessage(tbody, colspan, message, { tone = '' } = {}) {
        const row = document.createElement('tr');
        const cell = appendCell(row, message);
        cell.colSpan = colspan;
        cell.className = 'empty-msg';
        if (tone === 'danger') cell.style.color = 'var(--danger)';
        tbody.replaceChildren(row);
    }

    function renderInsightList(listId, messages) {
        const list = document.getElementById(listId);
        if (!list) return;
        list.replaceChildren();
        messages.forEach((message) => {
            const item = document.createElement('li');
            item.textContent = message;
            list.appendChild(item);
        });
    }

    function formatComparisonText(comparison) {
        if (!comparison || comparison.rate === null) return '비교 없음';
        const sign = comparison.diff >= 0 ? '+' : '-';
        return `${sign}${Math.abs(Math.round(comparison.rate)).toLocaleString()}%`;
    }

    function formatCompactWon(value) {
        const absValue = Math.abs(Number(value) || 0);
        if (absValue >= 100000000) {
            const amount = absValue / 100000000;
            return `${Number.isInteger(amount) ? amount.toLocaleString() : amount.toFixed(1)}억원`;
        }
        if (absValue >= 10000) {
            const amount = absValue / 10000;
            return `${Number.isInteger(amount) ? amount.toLocaleString() : amount.toFixed(1)}만원`;
        }
        return `${absValue.toLocaleString()}원`;
    }

    function formatComparisonDetail(comparison) {
        if (!comparison || comparison.rate === null) return '비교 없음';
        const sign = comparison.diff >= 0 ? '+' : '-';
        return `${sign}${Math.abs(Math.round(comparison.rate)).toLocaleString()}% · ${sign}${formatCompactWon(comparison.diff)}`;
    }

    function setTrendValue(elementId, comparison) {
        const element = document.getElementById(elementId);
        if (!element) return;
        element.classList.remove('trend-positive', 'trend-negative', 'trend-neutral');
        element.classList.add(comparison?.diff > 0 ? 'trend-positive' : comparison?.diff < 0 ? 'trend-negative' : 'trend-neutral');
        element.textContent = formatComparisonDetail(comparison);
    }

    function isTrendOperatingDay(day) {
        return day.count > 0 || day.cash > 0 || day.card > 0 || day.total > 0 || day.expense > 0;
    }

    function formatSignedRate(diff, baseValue) {
        if (!baseValue) return '비교 없음';
        const rate = Math.round((diff / baseValue) * 100);
        const sign = diff >= 0 ? '+' : '';
        return `${sign}${rate.toLocaleString()}%`;
    }

    function formatSignedAmount(diff) {
        const sign = diff >= 0 ? '+' : '-';
        return `${sign}${formatCompactWon(diff)}`;
    }

    function getTrendTone(diff) {
        if (diff > 0) return 'is-positive';
        if (diff < 0) return 'is-negative';
        return '';
    }

    function buildMovingAverage(values, windowSize = 7) {
        return values.map((_, index) => {
            const windowValues = values.slice(Math.max(0, index - windowSize + 1), index + 1);
            if (windowValues.length === 0) return 0;
            const sum = windowValues.reduce((total, value) => total + value, 0);
            return Math.round(sum / windowValues.length);
        });
    }

    function renderTrendSummary(dailySummary) {
        const container = document.getElementById('trendSummaryStrip');
        if (!container) return;
        container.replaceChildren();

        const rows = Object.keys(dailySummary).sort().map((date) => ({
            date,
            ...dailySummary[date]
        }));
        const activeRows = rows.filter(isTrendOperatingDay);

        if (activeRows.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-compact';
            empty.textContent = '조회 기간에 차트로 해석할 매출 데이터가 없습니다.';
            container.appendChild(empty);
            return;
        }

        const latest = activeRows[activeRows.length - 1];
        const previous = activeRows[activeRows.length - 2] || null;
        const latestIndex = rows.findIndex((row) => row.date === latest.date);
        const sevenDayRows = rows
            .slice(Math.max(0, latestIndex - 6), latestIndex + 1)
            .filter(isTrendOperatingDay);
        const sevenDayAverage = sevenDayRows.length > 0
            ? Math.round(sevenDayRows.reduce((sum, row) => sum + row.total, 0) / sevenDayRows.length)
            : 0;
        const maxDay = [...activeRows].sort((a, b) => b.total - a.total)[0];
        const sameWeekday = [...activeRows]
            .filter((row) => row.date < latest.date && parseDateKey(row.date).getDay() === parseDateKey(latest.date).getDay())
            .pop();
        const previousDiff = previous ? latest.total - previous.total : 0;
        const sameWeekdayDiff = sameWeekday ? latest.total - sameWeekday.total : 0;
        const averageDiff = sevenDayAverage > 0 ? latest.total - sevenDayAverage : 0;

        const cards = [
            {
                label: '최근 영업일',
                value: `${latest.date.slice(5)} · ${formatCompactWon(latest.total)}`,
                meta: previous ? `전 영업일 ${formatSignedRate(previousDiff, previous.total)} · ${formatSignedAmount(previousDiff)}` : '전 영업일 비교 없음',
                tone: getTrendTone(previousDiff)
            },
            {
                label: '7일 영업평균',
                value: formatCompactWon(sevenDayAverage),
                meta: `${sevenDayRows.length.toLocaleString()}영업일 기준 · 최근일 ${formatSignedRate(averageDiff, sevenDayAverage)}`,
                tone: ''
            },
            {
                label: '최고 매출일',
                value: `${maxDay.date.slice(5)} · ${formatCompactWon(maxDay.total)}`,
                meta: maxDay.date === latest.date ? '최근 영업일이 최고점' : `${latest.date.slice(5)} 기준 ${formatSignedAmount(latest.total - maxDay.total)}`,
                tone: maxDay.date === latest.date ? 'is-positive' : ''
            },
            {
                label: '동요일 비교',
                value: sameWeekday ? formatSignedRate(sameWeekdayDiff, sameWeekday.total) : '비교 없음',
                meta: sameWeekday ? `${sameWeekday.date.slice(5)} 대비 ${formatSignedAmount(sameWeekdayDiff)}` : '직전 같은 요일 데이터 부족',
                tone: getTrendTone(sameWeekdayDiff)
            }
        ];

        cards.forEach((card) => {
            const item = document.createElement('div');
            item.className = 'chart-summary-card';

            const label = document.createElement('span');
            label.textContent = card.label;

            const value = document.createElement('strong');
            value.textContent = card.value;
            if (card.tone) value.classList.add(card.tone);

            const meta = document.createElement('small');
            meta.textContent = card.meta;

            item.append(label, value, meta);
            container.appendChild(item);
        });
    }

    function formatWeekdayComparison(row) {
        if (!row || !row.previousDate || row.previousDate === '-') {
            return { text: '비교 데이터 부족', tone: '' };
        }

        if (row.lastVsPreviousRate === null) {
            return {
                text: `${row.previousDate.slice(5)} 대비 ${formatSignedAmount(row.lastVsPreviousDiff)}`,
                tone: getTrendTone(row.lastVsPreviousDiff)
            };
        }

        return {
            text: `${row.previousDate.slice(5)} 대비 ${formatSignedRate(row.lastVsPreviousDiff, row.previousTotal)} · ${formatSignedAmount(row.lastVsPreviousDiff)}`,
            tone: getTrendTone(row.lastVsPreviousDiff)
        };
    }

    function formatDescriptionGrowth(item) {
        if (!item) return '비교 없음';
        if (item.previousTotal === 0 && item.total > 0) return '신규/재등장';
        if (item.growthRate === null) return '비교 없음';
        return `${formatSignedRate(item.growthDiff, item.previousTotal)} · ${formatSignedAmount(item.growthDiff)}`;
    }

    function appendDescriptionSignal(container, label, value, meta, tone = '') {
        const item = document.createElement('div');
        item.className = 'description-signal-item';
        if (tone) item.classList.add(tone);

        const labelNode = document.createElement('span');
        labelNode.textContent = label;

        const valueNode = document.createElement('strong');
        valueNode.textContent = value;

        const metaNode = document.createElement('small');
        metaNode.textContent = meta;

        item.append(labelNode, valueNode, metaNode);
        container.appendChild(item);
    }

    function renderWeekdaySignals(containerId, weekdaySummary) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.replaceChildren();

        if (!weekdaySummary.best) {
            const empty = document.createElement('div');
            empty.className = 'empty-compact';
            empty.textContent = '조회 기간에 요일 분석 데이터가 없습니다.';
            container.appendChild(empty);
            return;
        }

        const signals = [
            {
                label: '강한 요일',
                value: `${weekdaySummary.best.name} · ${formatWon(weekdaySummary.best.average)}`,
                meta: `${weekdaySummary.best.operatingDays.toLocaleString()}영업일 평균`
            }
        ];

        if (weekdaySummary.slowest && weekdaySummary.slowest.name !== weekdaySummary.best.name) {
            signals.push({
                label: '보완 요일',
                value: `${weekdaySummary.slowest.name} · ${formatWon(weekdaySummary.slowest.average)}`,
                meta: `${weekdaySummary.slowest.operatingDays.toLocaleString()}영업일 평균`
            });
        }

        signals.push({
            label: '매출 집중도',
            value: `${Math.round(weekdaySummary.best.ratio).toLocaleString()}%`,
            meta: `${weekdaySummary.best.name} 누적 비중`
        });

        signals.forEach((signal) => {
            const item = document.createElement('div');
            item.className = 'signal-item';

            const label = document.createElement('span');
            label.textContent = signal.label;

            const value = document.createElement('strong');
            value.textContent = signal.value;

            const meta = document.createElement('small');
            meta.textContent = signal.meta;

            item.append(label, value, meta);
            container.appendChild(item);
        });

        const detailList = document.createElement('div');
        detailList.className = 'weekday-detail-list';

        weekdaySummary.activeRows
            .slice()
            .sort((a, b) => b.average - a.average || b.total - a.total)
            .forEach((row) => {
                const compare = formatWeekdayComparison(row);
                const card = document.createElement('article');
                card.className = 'weekday-detail-card';

                const head = document.createElement('div');
                head.className = 'weekday-detail-head';

                const title = document.createElement('strong');
                title.textContent = row.name;

                const average = document.createElement('span');
                average.textContent = `평균 ${formatWon(row.average)}`;

                head.append(title, average);

                const meta = document.createElement('div');
                meta.className = 'weekday-detail-meta';
                meta.textContent = `${row.operatingDays.toLocaleString()}영업일 · 최근 4회 평균 ${formatWon(row.recentFourAverage)}`;

                const comparePill = document.createElement('div');
                comparePill.className = `weekday-compare-pill ${compare.tone}`;
                comparePill.textContent = `직전 같은 요일 ${compare.text}`;

                const description = document.createElement('div');
                description.className = 'weekday-description-line';
                description.textContent = row.topDescription
                    ? `TOP 적요 ${row.topDescription.description} · ${formatWon(row.topDescription.total)}`
                    : 'TOP 적요 데이터 부족';

                card.append(head, meta, comparePill, description);
                detailList.appendChild(card);
            });

        container.appendChild(detailList);
    }

    function renderDescriptionRanking(containerId, descriptionSummary) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.replaceChildren();

        if (!descriptionSummary.items.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-compact';
            empty.textContent = '적요별 매출 데이터가 없습니다.';
            container.appendChild(empty);
            return;
        }

        const signalGrid = document.createElement('div');
        signalGrid.className = 'description-signal-grid';

        if (descriptionSummary.rising) {
            appendDescriptionSignal(
                signalGrid,
                '최근 뜨는 적요',
                descriptionSummary.rising.description,
                `최근 7일 ${formatWon(descriptionSummary.rising.recentTotal)}`
            );
        }

        if (descriptionSummary.growth) {
            appendDescriptionSignal(
                signalGrid,
                descriptionSummary.comparisonLabel,
                descriptionSummary.growth.description,
                formatDescriptionGrowth(descriptionSummary.growth),
                getTrendTone(descriptionSummary.growth.growthDiff)
            );
        }

        appendDescriptionSignal(
            signalGrid,
            '자동 묶음',
            `${descriptionSummary.groupedCount.toLocaleString()}개`,
            descriptionSummary.groupedCount > 0 ? '비슷한 적요를 합산 표시' : '묶을 적요 없음'
        );

        container.appendChild(signalGrid);

        const maxTotal = descriptionSummary.items[0].total || 1;
        descriptionSummary.items.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = 'ranking-item';

            const head = document.createElement('div');
            head.className = 'ranking-head';

            const name = document.createElement('strong');
            name.textContent = `${index + 1}. ${item.description}`;

            const amount = document.createElement('span');
            amount.textContent = formatWon(item.total);

            head.append(name, amount);

            const meta = document.createElement('div');
            meta.className = 'ranking-meta';
            meta.textContent = `${item.people.toLocaleString()}명 · ${item.rowCount.toLocaleString()}건 · 객단가 ${formatWon(item.averageTicket)} · 비중 ${Math.round(item.ratio).toLocaleString()}%`;

            const detail = document.createElement('div');
            detail.className = 'ranking-detail-row';

            const recentPill = document.createElement('span');
            recentPill.textContent = `최근 7일 ${formatWon(item.recentTotal)}`;

            const growthPill = document.createElement('span');
            growthPill.textContent = `${descriptionSummary.comparisonLabel} ${formatDescriptionGrowth(item)}`;
            const growthTone = getTrendTone(item.growthDiff);
            if (growthTone) growthPill.classList.add(growthTone);

            detail.append(recentPill, growthPill);

            let variants = null;
            if (item.variantCount > 1) {
                variants = document.createElement('div');
                variants.className = 'ranking-variants';
                variants.textContent = `자동 묶음: ${item.variants.join(', ')}`;
            }

            const bar = document.createElement('div');
            bar.className = 'ranking-bar';

            const fill = document.createElement('div');
            fill.style.width = `${Math.max(6, Math.round((item.total / maxTotal) * 100))}%`;
            bar.appendChild(fill);

            row.append(head, meta, detail);
            if (variants) row.appendChild(variants);
            row.appendChild(bar);
            container.appendChild(row);
        });
    }

    function renderFlowAnalysis(analysis) {
        const badgeWrap = document.getElementById('rangeFlowBadges');
        const highlightWrap = document.getElementById('rangeFlowHighlights');
        const messageWrap = document.getElementById('rangeFlowMessages');
        if (!badgeWrap || !highlightWrap || !messageWrap) return;

        badgeWrap.replaceChildren();
        highlightWrap.replaceChildren();
        messageWrap.replaceChildren();

        analysis.badges.forEach((badge) => {
            const item = document.createElement('span');
            item.className = `flow-badge flow-${badge.tone}`;
            item.textContent = badge.label;
            badgeWrap.appendChild(item);
        });

        if (!analysis.highlights.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-compact';
            empty.textContent = '차트 하이라이트가 없습니다.';
            highlightWrap.appendChild(empty);
        }

        analysis.highlights.forEach((highlight) => {
            const card = document.createElement('div');
            card.className = 'flow-highlight-card';

            const label = document.createElement('span');
            label.textContent = highlight.label;

            const value = document.createElement('strong');
            value.textContent = highlight.value;

            const amount = document.createElement('b');
            const amountText = typeof highlight.amount === 'number' ? formatWon(Math.abs(highlight.amount)) : '';
            amount.textContent = highlight.amount < 0 ? `-${amountText}` : amountText;
            amount.className = highlight.amount < 0 ? 'is-negative' : '';

            const meta = document.createElement('small');
            meta.textContent = highlight.meta;

            card.append(label, value, amount, meta);
            highlightWrap.appendChild(card);
        });

        analysis.messages.forEach((message) => {
            const item = document.createElement('article');
            item.className = `flow-message flow-${message.tone}`;

            const title = document.createElement('strong');
            title.textContent = message.title;

            const body = document.createElement('p');
            body.textContent = message.body;

            item.append(title, body);
            messageWrap.appendChild(item);
        });
    }

    function getLastDayOfMonth(year, month) {
        return new Date(year, month, 0).getDate();
    }

    // 1년 전 같은 날짜. 2월 29일처럼 작년에 없는 날은 그달 마지막 날로 맞춘다.
    function shiftYearKey(dateStr, years = -1) {
        const year = Number(dateStr.slice(0, 4)) + years;
        const month = Number(dateStr.slice(5, 7));
        const day = Math.min(Number(dateStr.slice(8, 10)), getLastDayOfMonth(year, month));
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    function pickDailyRange(dailySummary, startStr, endStr) {
        return Object.fromEntries(Object.entries(dailySummary).filter(([date]) => date >= startStr && date <= endStr));
    }

    function formatPeriodLabel(startStr, endStr) {
        const full = (date) => date.replaceAll('-', '.');
        if (startStr === endStr) return full(startStr);
        const end = startStr.slice(0, 4) === endStr.slice(0, 4) ? endStr.slice(5).replace('-', '.') : full(endStr);
        return `${full(startStr)} ~ ${end}`;
    }

    function createCompareStat(label, value, delta) {
        const stat = document.createElement('div');
        stat.className = 'compare-stat';
        const caption = document.createElement('small');
        caption.textContent = label;
        const amount = document.createElement('b');
        amount.textContent = value;
        stat.append(caption, amount);
        if (delta) stat.append(delta);
        return stat;
    }

    // "이번 달 -59%" 처럼, 기준 기간 대비 지금 기간이 얼마나 다른지 보여 준다.
    function createCompareDelta(prefix, rate, diff) {
        const chip = document.createElement('span');
        chip.className = `compare-delta ${getTrendTone(diff)}`.trim();
        chip.textContent = rate === null ? '비교 없음' : `${prefix} ${diff >= 0 ? '+' : '-'}${Math.abs(Math.round(rate)).toLocaleString()}%`;
        return chip;
    }

    // rows: [{ label, start, end, summary, comparison?, kind?: 'current' | 'reference', note? }]
    function renderComparePanel(containerId, rows, currentLabel) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.replaceChildren(...rows.map((row) => {
            const item = document.createElement('div');
            item.className = `compare-row${row.kind ? ` compare-row--${row.kind}` : ''}`;
            const head = document.createElement('div');
            head.className = 'compare-row__head';
            const title = document.createElement('strong');
            title.textContent = row.label;
            const period = document.createElement('small');
            period.textContent = formatPeriodLabel(row.start, row.end);
            head.append(title, period);

            const stats = document.createElement('div');
            stats.className = 'compare-row__stats';
            const { summary, comparison } = row;
            if (row.stats) {
                stats.append(...row.stats.map((stat) => createCompareStat(stat.label, stat.value, stat.delta)));
            } else {
                stats.append(
                    createCompareStat('매출', formatCompactWon(summary.total), comparison && createCompareDelta(currentLabel, comparison.rate, comparison.diff)),
                    createCompareStat(
                        `영업일당 · ${summary.operatingDays.toLocaleString()}일`,
                        summary.operatingDays > 0 ? formatCompactWon(summary.averageSales) : '-',
                        comparison && createCompareDelta(currentLabel, comparison.averageRate, comparison.averageDiff)
                    )
                );
            }
            item.append(head, stats);
            if (row.note) {
                const note = document.createElement('p');
                note.className = 'compare-row__note';
                note.textContent = row.note;
                item.append(note);
            }
            return item;
        }));
    }

    // 이번 달 마감 예상 카드 (서버 AI 리포트와 같은 계산: server/src/forecast.js)
    function buildForecastRows({ compareSummary, lastYearSummary, lastYearFullSummary, compareDay, lastDay, month, startDate, endDate }) {
        const forecast = forecastMonthEnd({
            salesToDate: compareSummary.total,
            operatingDaysToDate: compareSummary.operatingDays,
            elapsedDays: compareDay,
            daysInMonth: lastDay,
            lastYearSalesToDate: lastYearSummary.total,
            lastYearSalesFullMonth: lastYearFullSummary.total
        });
        if (!forecast || forecast.method === 'actual') return [];
        const lastYearTotal = lastYearFullSummary.total;
        const diff = forecast.sales - lastYearTotal;
        return [{
            label: '이번 달 예상 마감',
            start: startDate,
            end: endDate,
            kind: 'forecast',
            stats: [
                {
                    label: '예상 매출',
                    value: `약 ${formatCompactWon(forecast.sales)}`,
                    delta: lastYearTotal > 0 ? createCompareDelta(`작년 ${month}월보다`, (diff / lastYearTotal) * 100, diff) : null
                },
                { label: `남은 ${forecast.remainingDays}일 예상`, value: `+${formatCompactWon(forecast.sales - compareSummary.total)}` }
            ],
            note: `${FORECAST_METHOD_LABELS[forecast.method]}으로 계산한 추정치예요.`
        }];
    }

    function getPreviousRange(startStr, endStr) {
        const start = parseDateKey(startStr);
        const end = parseDateKey(endStr);
        const dayLength = Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
        const prevEnd = new Date(start);
        prevEnd.setDate(prevEnd.getDate() - 1);
        const prevStart = new Date(prevEnd);
        prevStart.setDate(prevStart.getDate() - dayLength + 1);
        return { startStr: formatDateKey(prevStart), endStr: formatDateKey(prevEnd) };
    }

    // 3. 앱 초기화
    async function init() {
        let startedOffline = false;
        try {
            currentUser = await getCurrentUser();
            rememberLastUser(currentUser);
        } catch (err) {
            // 인터넷이 끊긴 채로 앱을 열면 마지막으로 로그인한 계정으로 열어 입력만은 할 수 있게 한다. (권한은 서버가 다시 확인)
            const cached = err.code === 'NETWORK_ERROR' ? readLastUser() : null;
            if (!cached) {
                if (err.status !== 401) await window.showAlert(`계정 정보를 확인하지 못했습니다.<br>${err.message}`);
                return;
            }
            currentUser = cached;
            startedOffline = true;
        }
        if (currentUser.status !== 'approved') {
            await window.showAlert('아직 가입 승인이 완료되지 않은 계정입니다. 최고 관리자의 승인을 기다려주세요.');
            await api.logout().catch(() => {});
            window.location.replace('login.html');
            return;
        }
        currentUserEmail = currentUser.email || '';
        applySensitiveActionGuard();
        renderAccountInfo();
        loadDescriptionSuggestions();

        // 운영 데이터 보호: 프론트엔드에서는 삭제 보관분을 물리 삭제하지 않는다.
        // 장기 보관/정리는 Supabase 백업 확인 후 서버 작업이나 스케줄러에서 별도로 처리한다.

        // 한국/일본 시간(UTC+9) 기준으로 현재 날짜 구하기
        const today = getKstToday();
        
        datePicker.value = today;
        updateDateDisplay(today);
        
        monthPicker.value = today.substring(0, 7);
        updateMonthDisplay(monthPicker.value);

        totalStartDate.value = today.substring(0, 8) + "01";
        totalEndDate.value = today;
        updateGenericDateDisplay(totalStartDate, 'startDateDisplay', '시작일 선택');
        updateGenericDateDisplay(totalEndDate, 'endDateDisplay', '종료일 선택');

        // 값 변경 시 날짜 글씨 실시간 업데이트 이벤트 연결
        datePicker.addEventListener('change', () => {
            if (!datePicker.value) return;
            changeDailyDate(datePicker.value);
        });
        document.getElementById('prevDayBtn')?.addEventListener('click', () => changeDailyDate(shiftDateKey(datePicker.value, -1)));
        document.getElementById('nextDayBtn')?.addEventListener('click', () => changeDailyDate(shiftDateKey(datePicker.value, 1)));
        document.getElementById('todayBtn')?.addEventListener('click', () => changeDailyDate(getKstToday()));
        // Alt + ←/→ 로 하루씩 이동 (입력 중에도 동작)
        document.addEventListener('keydown', (event) => {
            if (!event.altKey || currentView !== 'daily') return;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                changeDailyDate(shiftDateKey(datePicker.value, event.key === 'ArrowLeft' ? -1 : 1));
            }
        });
        document.querySelectorAll('[data-range-preset]').forEach((button) => {
            button.addEventListener('click', () => applyRangePreset(button.dataset.rangePreset));
        });
        cancelEditBtn?.addEventListener('click', () => exitEditMode({ resetForm: true }));
        noteInput.addEventListener('input', updateNoteStatus);
        window.addEventListener('beforeunload', (event) => {
            if (isNoteDirty()) event.preventDefault();
        });
        document.getElementById('detailGoToDayBtn')?.addEventListener('click', () => {
            if (!detailModalDate) return;
            detailDialog.close();
            switchTab('daily', { date: detailModalDate });
        });
        monthPicker.addEventListener('change', () => {
            updateMonthDisplay(monthPicker.value);
            loadMonthlyData(monthPicker.value);
        });
        const clearRangePreset = () => {
            document.querySelectorAll('[data-range-preset].active').forEach((button) => button.classList.remove('active'));
        };
        totalStartDate.addEventListener('change', () => {
            updateGenericDateDisplay(totalStartDate, 'startDateDisplay', '시작일 선택');
            clearRangePreset();
        });
        totalEndDate.addEventListener('change', () => {
            updateGenericDateDisplay(totalEndDate, 'endDateDisplay', '종료일 선택');
            clearRangePreset();
        });
        document.getElementById('prevMonthBtn')?.addEventListener('click', () => shiftMonth(-1));
        document.getElementById('nextMonthBtn')?.addEventListener('click', () => shiftMonth(1));

        // 화면 이동 (드로어 · 하단 내비게이션) 과 계정 동작 (드로어 · 계정 메뉴 · 하단 MY)
        document.querySelectorAll('[data-nav]').forEach((button) => {
            button.addEventListener('click', () => switchTab(button.dataset.nav));
        });
        document.querySelectorAll('[data-action]').forEach((button) => {
            button.addEventListener('click', () => {
                drawer.close();
                if (button.dataset.action === 'mypage') openMyPage('account');
                if (button.dataset.action === 'settings') openMyPage('settings');
                if (button.dataset.action === 'logout') window.logout();
            });
        });
        document.getElementById('refreshViewBtn')?.addEventListener('click', () => refreshCurrentView());
        document.getElementById('networkRetryBtn')?.addEventListener('click', () => refreshCurrentView());
        window.addEventListener('dailydash:network', (event) => {
            networkBanner?.classList.toggle('hidden-view', event.detail.reachable);
            if (event.detail.reachable) sendOutbox();
        });
        if (startedOffline) {
            networkBanner?.classList.remove('hidden-view');
            showToast('인터넷이 끊겨 있어요. 입력한 내역은 휴대폰에 임시 저장했다가 연결되면 보낼게요.', { tone: 'info', duration: 6000 });
        }
        installOutbox();
        window.addEventListener('scroll', () => {
            topAppBar?.classList.toggle('is-scrolled', window.scrollY > 4);
        }, { passive: true });
        // 다크/라이트 전환 시 차트 색도 다시 칠한다.
        document.addEventListener('dailydash:theme', () => {
            if (lastTrendDailySummary && currentView === 'total') renderAdvancedAnalytics(lastTrendDailySummary);
        });

        if (loadTotalBtn) loadTotalBtn.addEventListener('click', () => loadTotalRangeData());
        if (downloadExcelBtn) downloadExcelBtn.addEventListener('click', () => downloadStyledExcel('monthlyTable', monthPicker.value));
        if (downloadTotalExcelBtn) downloadTotalExcelBtn.addEventListener('click', () => downloadStyledExcel('totalRangeTable', `${totalStartDate.value}_to_${totalEndDate.value}`));
        refreshOperationHistoryBtn?.addEventListener('click', () => loadOperationHistory());
        changePasswordForm?.addEventListener('submit', handleChangePassword);

        updateAppBar();
        openFromShortcut(today);
    }

    // 홈 화면 아이콘을 길게 눌러 나오는 바로가기(?view=monthly, ?action=new)를 처리한다.
    function openFromShortcut(today) {
        const params = new URLSearchParams(window.location.search);
        const view = params.get('view');
        const action = params.get('action');
        if (params.toString()) history.replaceState(null, '', window.location.pathname);

        if (view && view !== 'daily' && VIEWS[view]) {
            switchTab(view);
            return;
        }
        loadDailyData(today);
        if (action === 'new') {
            if (isMobileLayout()) entrySheet.open();
            else document.getElementById('desc')?.focus();
        }
    }

    function renderAccountInfo() {
        const initial = (currentUserEmail.trim()[0] || 'D').toUpperCase();
        setText('avatarInitial', initial);
        setText('profileInitial', initial);
        setText('accountMenuEmail', currentUserEmail);
        loggedInEmail.textContent = currentUserEmail;
        if (loggedInRole) {
            loggedInRole.textContent = isSuperAdmin() ? '관리자' : '일반 사용자';
            loggedInRole.classList.toggle('is-admin', isSuperAdmin());
        }
        setText('operationHistoryTitle', isSuperAdmin() ? '전체 작업 이력' : '내 작업 이력');
        document.getElementById('usersTabBtn')?.classList.toggle('hidden-view', !isSuperAdmin());
        document.getElementById('itemsTabBtn')?.classList.toggle('hidden-view', !isSuperAdmin());
        superUserPanel?.classList.toggle('hidden-view', !isSuperAdmin());
    }

    function openMyPage(tab = 'account') {
        myPageDialog.open();
        myPageTabs.select(tab);
    }

    function refreshCurrentView() {
        if (currentView === 'daily') loadDailyData(datePicker.value);
        if (currentView === 'monthly') loadMonthlyData(monthPicker.value);
        if (currentView === 'total') loadTotalRangeData();
    }

    function shiftMonth(diff) {
        if (!monthPicker.value) return;
        const [year, month] = monthPicker.value.split('-').map(Number);
        const next = new Date(year, month - 1 + diff, 1);
        monthPicker.value = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
        updateMonthDisplay(monthPicker.value);
        loadMonthlyData(monthPicker.value);
    }

    async function changeDailyDate(dateStr) {
        if (!dateStr || dateStr === currentDailyDate) {
            datePicker.value = currentDailyDate;
            return;
        }
        if (isNoteDirty()) {
            const leave = await window.showConfirm(
                '저장하지 않은 특기사항이 있습니다.\n저장하지 않고 다른 날짜로 이동할까요?',
                { danger: true, confirmLabel: '이동', icon: 'warning' }
            );
            if (!leave) {
                datePicker.value = currentDailyDate;
                return;
            }
        }
        if (editingTransaction) exitEditMode({ resetForm: true });
        datePicker.value = dateStr;
        updateDateDisplay(dateStr);
        loadDailyData(dateStr);
    }

    function applyRangePreset(preset) {
        const today = getKstToday();
        const ranges = {
            thisMonth: () => [`${today.slice(0, 7)}-01`, today],
            lastMonth: () => {
                const prev = getPreviousMonth(today.slice(0, 7));
                const lastDay = new Date(Number(prev.slice(0, 4)), Number(prev.slice(5, 7)), 0).getDate();
                return [`${prev}-01`, `${prev}-${String(lastDay).padStart(2, '0')}`];
            },
            last7: () => [shiftDateKey(today, -6), today],
            last30: () => [shiftDateKey(today, -29), today],
            last90: () => [shiftDateKey(today, -89), today],
            last365: () => [shiftDateKey(today, -364), today],
            thisYear: () => [`${today.slice(0, 4)}-01-01`, today]
        };
        const range = (ranges[preset] || ranges.thisMonth)();
        totalStartDate.value = range[0];
        totalEndDate.value = range[1];
        updateGenericDateDisplay(totalStartDate, 'startDateDisplay', '시작일 선택');
        updateGenericDateDisplay(totalEndDate, 'endDateDisplay', '종료일 선택');
        document.querySelectorAll('[data-range-preset]').forEach((button) => {
            button.classList.toggle('active', button.dataset.rangePreset === preset);
        });
        loadTotalRangeData();
    }

    async function handleChangePassword(event) {
        event.preventDefault();
        const currentPassword = document.getElementById('currentPasswordInput').value;
        const newPassword = document.getElementById('newPasswordInput').value;
        const confirmPassword = document.getElementById('newPasswordConfirmInput').value;
        if (newPassword !== confirmPassword) {
            await window.showAlert('새 비밀번호와 확인 값이 일치하지 않습니다.');
            return;
        }
        const button = document.getElementById('changePasswordBtn');
        button.disabled = true;
        try {
            await api.changePassword(currentPassword, newPassword);
            changePasswordForm.reset();
            changePasswordForm.closest('details')?.removeAttribute('open');
            showToast('비밀번호를 변경했습니다.');
            loadOperationHistory();
        } catch (err) {
            await window.showAlert(`비밀번호 변경 실패: ${err.message}`);
        } finally {
            button.disabled = false;
        }
    }

    const USER_STATUS_LABELS = { pending: '승인 대기', approved: '사용 중', disabled: '사용 중지' };

    function createUserActionButton(label, iconName, className, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `user-action-btn ${className}`;
        button.append(iconElement(iconName), label);
        button.addEventListener('click', onClick);
        return button;
    }

    /* ---------------- 마감 입력 알림 (설정 탭) ---------------- */
    const reminderSwitch = document.getElementById('reminderSwitch');
    const reminderControls = document.getElementById('reminderControls');
    const reminderTimeSelect = document.getElementById('reminderTime');
    const reminderHint = document.getElementById('reminderHint');
    let reminderPublicKey = null;
    const REMINDER_HINT = '정한 시각까지 오늘 입력이 없으면 이 기기로 알려 드려요.';

    function showReminderState({ supported, reason, subscribed = false, reminderTime }) {
        reminderSwitch.disabled = !supported;
        reminderSwitch.checked = Boolean(supported && subscribed);
        reminderControls.hidden = !reminderSwitch.checked;
        if (reminderTime) reminderTimeSelect.value = reminderTime;
        if (supported) {
            reminderHint.textContent = REMINDER_HINT;
        } else if (reason === 'browser' && /iphone|ipad|ipod/i.test(navigator.userAgent)) {
            reminderHint.textContent = '아이폰은 Safari 에서 "홈 화면에 추가"한 앱으로 열어야 알림을 받을 수 있어요.';
        } else if (reason === 'server') {
            reminderHint.textContent = '서버에서 알림 기능이 꺼져 있어요.';
        } else {
            reminderHint.textContent = '이 브라우저에서는 알림을 쓸 수 없어요. 설치한 앱이나 Chrome 에서 켜 주세요.';
        }
    }

    async function loadReminderSetting() {
        if (!reminderSwitch) return;
        try {
            const state = await getReminderState();
            reminderPublicKey = state.publicKey || null;
            showReminderState(state);
        } catch (err) {
            showReminderState({ supported: false, reason: 'error' });
            console.warn('알림 상태를 확인하지 못했습니다.', err);
        }
    }

    reminderSwitch?.addEventListener('change', async () => {
        const turnOn = reminderSwitch.checked;
        reminderSwitch.disabled = true;
        try {
            if (turnOn) {
                await enableReminder(reminderPublicKey, reminderTimeSelect.value || DEFAULT_REMINDER_TIME);
                showToast(`마감 입력 알림을 켰어요. 매일 ${reminderTimeSelect.value}까지 입력이 없으면 알려 드려요.`);
            } else {
                await disableReminder();
                showToast('이 기기의 마감 입력 알림을 껐어요.', { tone: 'info' });
            }
        } catch (err) {
            showToast(err.message, { tone: 'danger', duration: 6000 });
        } finally {
            await loadReminderSetting();
        }
    });

    reminderTimeSelect?.addEventListener('change', async () => {
        try {
            await updateReminderTime(reminderTimeSelect.value);
            showToast(`알림 시각을 ${reminderTimeSelect.value}(으)로 바꿨어요.`);
        } catch (err) {
            showToast(err.message, { tone: 'danger' });
        }
    });

    document.getElementById('reminderTestBtn')?.addEventListener('click', async () => {
        try {
            const result = await sendTestReminder();
            showToast(result.ok ? '시험 알림을 보냈어요. 잠시 뒤 알림이 오는지 확인해 주세요.' : '알림을 보내지 못했어요. 알림을 껐다가 다시 켜 주세요.', { tone: result.ok ? 'success' : 'danger' });
        } catch (err) {
            showToast(err.message, { tone: 'danger' });
        }
    });

    if (!isPushSupported()) showReminderState({ supported: false, reason: 'browser' });

    /* ---------------- 오프라인 입력 보관함 ---------------- */
    const LAST_USER_KEY = 'dailydash-last-user';
    const outboxBanner = document.getElementById('outboxBanner');
    const outboxList = document.getElementById('outboxList');

    function rememberLastUser(user) {
        try {
            localStorage.setItem(LAST_USER_KEY, JSON.stringify({ id: user.id, email: user.email, role: user.role, status: user.status }));
        } catch {
            /* 저장 공간을 못 쓰면 오프라인 시작만 안 될 뿐이다 */
        }
    }

    function readLastUser() {
        try {
            const user = JSON.parse(localStorage.getItem(LAST_USER_KEY) || 'null');
            return user?.email && user.status === 'approved' ? user : null;
        } catch {
            return null;
        }
    }

    function renderOutbox() {
        if (!outboxBanner) return;
        const items = readOutbox(currentUserEmail);
        outboxBanner.classList.toggle('hidden-view', items.length === 0);
        setText('outboxTitle', `보내지 못한 입력 ${items.length.toLocaleString()}건`);
        outboxList.replaceChildren(...items.map((item) => {
            const { values } = item;
            const li = document.createElement('li');
            li.className = `outbox-item${item.error ? ' has-error' : ''}`;
            const text = document.createElement('span');
            const sales = Number(values.cash_income || 0) + Number(values.card_income || 0);
            text.textContent = `${values.transaction_date.slice(5)} · ${values.description} · ${formatWon(sales)}${item.error ? ` - 보내지 못함: ${item.error}` : ''}`;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'icon-btn outbox-item__remove';
            remove.setAttribute('aria-label', `${values.description} 임시 저장 지우기`);
            remove.append(iconElement('close'));
            remove.addEventListener('click', async () => {
                if (!await window.showConfirm(`임시 저장한 "${values.description}" 내역을 지울까요?
서버에는 저장되지 않은 내역이에요.`, { confirmLabel: '지우기' })) return;
                removeFromOutbox(values.client_id);
            });
            li.append(text, remove);
            return li;
        }));
    }

    async function sendOutbox({ manual = false } = {}) {
        if (readOutbox(currentUserEmail).length === 0) return;
        const result = await flushOutbox(currentUserEmail, (values) => api.createTransaction(values));
        if (!result) return;
        const { sent, failed, remaining } = result;
        if (sent > 0) {
            showToast(`임시 저장한 ${sent.toLocaleString()}건을 서버로 보냈어요.`);
            if (currentView === 'daily') loadDailyData(datePicker.value);
        }
        if (failed > 0) showToast(`${failed.toLocaleString()}건은 내용 문제로 보내지 못했어요. 목록을 확인해 주세요.`, { tone: 'danger', duration: 6000 });
        else if (manual && sent === 0 && remaining > 0) showToast('아직 서버에 연결되지 않았어요. 연결되면 자동으로 보낼게요.', { tone: 'info' });
    }

    function installOutbox() {
        renderOutbox();
        window.addEventListener(OUTBOX_EVENT, renderOutbox);
        window.addEventListener('online', () => sendOutbox());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') sendOutbox();
        });
        setInterval(() => sendOutbox(), 60 * 1000);
        document.getElementById('outboxSendBtn')?.addEventListener('click', () => sendOutbox({ manual: true }));
        sendOutbox();
    }

    /* ---------------- 적요 정리 (관리자) ---------------- */
    const itemsPanel = document.getElementById('itemsPanel');

    function createItemSection(title, hint, ...children) {
        const section = document.createElement('section');
        section.className = 'items-section';
        const heading = document.createElement('h3');
        heading.textContent = title;
        section.append(heading);
        if (hint) {
            const note = document.createElement('p');
            note.className = 'items-section__hint';
            note.textContent = hint;
            section.append(note);
        }
        section.append(...children);
        return section;
    }

    function createItemChip(item, { onRemove } = {}) {
        const chip = document.createElement('span');
        chip.className = 'item-chip';
        chip.textContent = `${item.name} · ${item.uses.toLocaleString()}건`;
        if (onRemove) {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'item-chip__remove';
            remove.setAttribute('aria-label', `${item.name} 묶음 풀기`);
            remove.append(iconElement('close'));
            remove.addEventListener('click', onRemove);
            chip.append(remove);
        }
        return chip;
    }

    function createItemInput(value, label, listId) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'item-input';
        input.value = value;
        input.maxLength = 100;
        input.setAttribute('aria-label', label);
        input.placeholder = label;
        if (listId) input.setAttribute('list', listId);
        return input;
    }

    function createItemButton(label, onClick, variant = 'btn-tonal') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `btn ${variant}`;
        button.textContent = label;
        button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                await onClick();
            } catch (err) {
                showToast(err.message, { tone: 'danger' });
            } finally {
                button.disabled = false;
            }
        });
        return button;
    }

    async function saveAliases(aliases, message) {
        await api.saveDescriptionAliases(aliases);
        aliasMapPromise = null;
        loadDescriptionSuggestions();
        showToast(message);
        await loadItemManagement();
        if (currentView !== 'daily') refreshCurrentView();
        if (seasonLoaded) loadItemSeasons(seasonSelect?.value);
    }

    async function loadItemManagement() {
        if (!itemsPanel) return;
        itemsPanel.replaceChildren(createEmptyCompact('적요 목록을 불러오는 중...'));
        let data;
        try {
            data = await api.listDescriptions();
        } catch (err) {
            itemsPanel.replaceChildren(createEmptyCompact(`적요 목록을 불러오지 못했어요. (${err.message})`));
            return;
        }
        const { names, suggestions, nonItems, mapped, notAnItem } = data;
        const listId = 'itemsNameList';
        const datalist = document.createElement('datalist');
        datalist.id = listId;
        datalist.append(...names.map((item) => new Option(item.name)));

        // 1) 묶음 추천: 이름만 조금 다른 적요들
        const suggestionCards = suggestions.map((group) => {
            const card = document.createElement('div');
            card.className = 'item-group';
            const variants = document.createElement('div');
            variants.className = 'item-group__variants';
            variants.append(...group.items.map((item) => createItemChip(item)));
            const input = createItemInput(group.suggested, '대표 이름', listId);
            const action = document.createElement('div');
            action.className = 'item-group__action';
            action.append(input, createItemButton('하나로 묶기', async () => {
                const canonical = input.value.trim();
                if (!canonical) throw new Error('대표 이름을 입력해 주세요.');
                const aliases = group.items
                    .filter((item) => item.name !== canonical)
                    .map((item) => ({ alias: item.name, canonical }));
                if (group.items.some((item) => item.name === canonical && item.canonical)) aliases.push({ alias: canonical, canonical: '' });
                await saveAliases(aliases, `${aliases.length}개 적요를 "${canonical}"(으)로 묶었어요.`);
            }, 'btn-filled'));
            card.append(variants, action);
            return card;
        });

        // 2) 결제수단·메모처럼 보이는 적요
        const nonItemRows = nonItems.map((item) => {
            const row = document.createElement('div');
            row.className = 'item-row';
            row.append(createItemChip(item), createItemButton('품목 아님으로 표시', () => saveAliases([{ alias: item.name, canonical: notAnItem }], `"${item.name}"은(는) 품목 분석에서 빼요.`)));
            return row;
        });

        // 3) 직접 묶기
        const manual = document.createElement('div');
        manual.className = 'item-group__action item-manual';
        const aliasInput = createItemInput('', '바꿀 적요 (입력된 이름)', listId);
        const canonicalInput = createItemInput('', '대표 이름', listId);
        manual.append(aliasInput, canonicalInput, createItemButton('묶기', async () => {
            const alias = aliasInput.value.trim();
            const canonical = canonicalInput.value.trim();
            if (!alias || !canonical) throw new Error('바꿀 적요와 대표 이름을 모두 입력해 주세요.');
            await saveAliases([{ alias, canonical }], `"${alias}" → "${canonical}"(으)로 묶었어요.`);
        }));

        // 4) 묶어 둔 적요 (대표 이름별)
        const byCanonical = new Map();
        mapped.forEach((item) => {
            if (!byCanonical.has(item.canonical)) byCanonical.set(item.canonical, []);
            byCanonical.get(item.canonical).push(item);
        });
        const mappedRows = [...byCanonical.entries()].map(([canonical, items]) => {
            const row = document.createElement('div');
            row.className = 'item-row item-row--mapped';
            const title = document.createElement('strong');
            title.textContent = canonical;
            const chips = document.createElement('div');
            chips.className = 'item-group__variants';
            chips.append(...items.map((item) => createItemChip(item, {
                onRemove: () => saveAliases([{ alias: item.name, canonical: '' }], `"${item.name}" 묶음을 풀었어요.`).catch((err) => showToast(err.message, { tone: 'danger' }))
            })));
            row.append(title, chips);
            return row;
        });

        itemsPanel.replaceChildren(
            datalist,
            createItemSection('묶음 추천', '이름만 조금 다른 적요들이에요. 대표 이름을 확인하고 묶어 주세요.',
                ...(suggestionCards.length ? suggestionCards : [createEmptyCompact('추천할 묶음이 없어요.')])),
            createItemSection('품목이 아닌 적요', '결제수단·메모처럼 보이는 적요는 품목 순위와 AI 리포트에서 뺄 수 있어요. (매출 합계에는 그대로 포함)',
                ...(nonItemRows.length ? nonItemRows : [createEmptyCompact('해당하는 적요가 없어요.')])),
            createItemSection('직접 묶기', '추천에 없는 적요도 대표 이름을 정해 묶을 수 있어요.', manual),
            createItemSection(`묶어 둔 적요 (${mapped.length.toLocaleString()}개)`, '× 를 누르면 묶음을 풀어요.',
                ...(mappedRows.length ? mappedRows : [createEmptyCompact('아직 묶은 적요가 없어요.')]))
        );
    }

    async function loadUserManagement() {
        if (!approvalListBody) return;
        if (!isSuperAdmin()) {
            setEmptyTableMessage(approvalListBody, 3, '관리자 전용 영역입니다.');
            return;
        }
        setEmptyTableMessage(approvalListBody, 3, '사용자 목록을 불러오는 중...');
        let users;
        try {
            users = await api.listUsers();
        } catch (err) {
            setEmptyTableMessage(approvalListBody, 3, `데이터를 로드하지 못했습니다. (${err.message})`, { tone: 'danger' });
            return;
        }
        if (!users.length) {
            setEmptyTableMessage(approvalListBody, 3, '등록된 사용자가 없습니다.');
            return;
        }

        approvalListBody.replaceChildren();
        users.forEach((user) => {
            const row = document.createElement('tr');
            const emailCell = appendCell(row, user.email, 'font-weight: 500; text-align: left !important;');
            if (user.role === 'admin') {
                const badge = document.createElement('span');
                badge.className = 'role-badge is-admin';
                badge.textContent = '관리자';
                emailCell.append(' ', badge);
            }

            const statusCell = appendCell(row, '');
            const status = document.createElement('span');
            status.className = `user-status-badge status-${user.status}`;
            status.textContent = USER_STATUS_LABELS[user.status] || user.status;
            statusCell.appendChild(status);

            const actionCell = appendCell(row, '');
            const actions = document.createElement('div');
            actions.className = 'user-actions';
            const isSelf = user.id === currentUser.id;

            if (user.status !== 'approved') {
                actions.appendChild(createUserActionButton('승인', 'user-tick', 'is-approve', () => approveUser(user)));
            }
            if (!isSelf && user.status === 'approved' && user.role !== 'admin') {
                actions.appendChild(createUserActionButton('중지', 'user-remove', 'is-muted', () => disableUser(user)));
            }
            if (!isSelf) {
                actions.appendChild(createUserActionButton('비번 초기화', 'key', 'is-muted', () => resetUserPassword(user)));
            }
            if (!isSelf && user.status !== 'approved') {
                actions.appendChild(createUserActionButton(user.status === 'pending' ? '거절' : '삭제', 'trash', 'is-danger', () => removeUser(user)));
            }
            if (isSelf) {
                const selfNote = document.createElement('span');
                selfNote.className = 'sensitive-locked';
                selfNote.textContent = '본인 계정';
                actions.appendChild(selfNote);
            }
            actionCell.appendChild(actions);
            approvalListBody.appendChild(row);
        });
    }

    async function runUserAction(action, successMessage) {
        try {
            const result = await action();
            if (successMessage) showToast(successMessage);
            loadUserManagement();
            loadOperationHistory();
            return result;
        } catch (err) {
            await window.showAlert(`처리 중 오류가 발생했습니다.<br>${err.message}`);
            return null;
        }
    }

    async function approveUser(user) {
        const confirmMessage = [
            '회원가입 승인을 진행할까요?',
            `대상 계정: ${user.email}`,
            '승인 후 DailyDash 정산 장부에 접속할 수 있습니다.'
        ].join('\n');
        if (!(await window.showConfirm(confirmMessage, { danger: false, confirmLabel: '승인', icon: 'user-tick' }))) return;
        await runUserAction(() => api.approveUser(user.id), `${user.email} 계정을 승인했습니다.`);
    }

    async function disableUser(user) {
        const confirmMessage = [
            '이 계정의 사용을 중지할까요?',
            `대상 계정: ${user.email}`,
            '모든 기기에서 즉시 로그아웃되며, 다시 승인하면 사용할 수 있습니다.'
        ].join('\n');
        if (!(await window.showConfirm(confirmMessage, { danger: true, confirmLabel: '사용 중지', icon: 'user-remove' }))) return;
        await runUserAction(() => api.disableUser(user.id), `${user.email} 계정을 사용 중지했습니다.`);
    }

    async function resetUserPassword(user) {
        const confirmMessage = [
            '임시 비밀번호를 발급할까요?',
            `대상 계정: ${user.email}`,
            '기존 비밀번호는 즉시 사용할 수 없게 됩니다.'
        ].join('\n');
        if (!(await window.showConfirm(confirmMessage, { danger: true, confirmLabel: '발급', icon: 'key' }))) return;
        const result = await runUserAction(() => api.resetUserPassword(user.id));
        if (result?.temporaryPassword) {
            await window.showAlert([
                `${user.email} 의 임시 비밀번호`,
                result.temporaryPassword,
                '이 창을 닫으면 다시 볼 수 없습니다. 사용자에게 전달하고, 로그인 후 마이페이지에서 비밀번호를 바꾸도록 안내해 주세요.'
            ].join('\n'), { icon: 'key', emphasizeLine: 1 });
        }
    }

    async function removeUser(user) {
        const isPending = user.status === 'pending';
        const confirmMessage = [
            isPending ? '가입 신청을 거절할까요?' : '이 계정을 삭제할까요?',
            `대상 계정: ${user.email}`,
            '삭제한 계정은 되돌릴 수 없습니다. (입력했던 정산 내역은 유지됩니다)'
        ].join('\n');
        if (!(await window.showConfirm(confirmMessage, { danger: true, confirmLabel: isPending ? '거절' : '삭제', icon: 'trash' }))) return;
        await runUserAction(() => api.deleteUser(user.id), isPending ? '가입 신청을 거절했습니다.' : '계정을 삭제했습니다.');
    }

    function isNoteDirty() {
        return noteInput.value !== savedNoteText;
    }

    function updateNoteStatus() {
        if (!noteStatus) return;
        const dirty = isNoteDirty();
        noteStatus.textContent = dirty ? '저장되지 않은 변경' : (savedNoteText ? '저장됨' : '');
        noteStatus.classList.toggle('is-dirty', dirty);
        saveNoteBtn.classList.toggle('is-attention', dirty);
    }

    async function loadDailyData(date) {
        const seq = ++dailyLoadSeq;
        const sameDate = date === currentDailyDate;
        currentDailyDate = date;
        setEmptyTableMessage(tableBody, 9, '데이터를 불러오는 중...');
        setListMessage(txList, '불러오는 중...', 'clock');
        try {
            const [transactions, note] = await Promise.all([
                api.listTransactionsByDate(date),
                api.getNote(date)
            ]);
            if (seq !== dailyLoadSeq) return;

            renderDailyTable(transactions);
            renderDailyQualityChecks(date, transactions);
            // 같은 날짜를 다시 불러올 때(입력 후 새로고침 등) 작성 중인 특기사항은 지우지 않는다.
            const keepDraft = sameDate && isNoteDirty();
            savedNoteText = note?.special_note || '';
            if (!keepDraft) noteInput.value = savedNoteText;
            updateNoteStatus();
        } catch (err) {
            if (seq !== dailyLoadSeq) return;
            console.error(err);
            setEmptyTableMessage(tableBody, 9, `로드 실패 (${err.message})`, { tone: 'danger' });
            setListMessage(txList, `불러오지 못했어요 (${err.message})`, 'danger');
            renderDailyQualityError(err.message);
        }
    }

    function setListMessage(container, text, iconName = 'receipt') {
        if (!container) return;
        const item = document.createElement('li');
        item.className = 'empty-state';
        item.append(iconElement(iconName), text);
        container.replaceChildren(item);
    }

    // 모바일용 내역 목록. 데스크톱은 표, 좁은 화면은 이 목록이 보인다. (CSS 로 전환)
    function txSupportText(tx) {
        const parts = [`${(tx.customer_count || 0).toLocaleString()}명`];
        if (tx.cash_income) parts.push(`현금 ${tx.cash_income.toLocaleString()}`);
        if (tx.card_income) parts.push(`카드 ${tx.card_income.toLocaleString()}`);
        if (tx.cash_expense) parts.push(`지출 ${tx.cash_expense.toLocaleString()}`);
        const remarks = [tx.remark1, tx.remark2].filter(Boolean).join(' / ');
        if (remarks) parts.push(remarks);
        return parts.join(' · ');
    }

    function renderTxList(container, transactions, { withActions = false, emptyText = '아직 입력된 내역이 없습니다.' } = {}) {
        if (!container) return;
        container.replaceChildren();
        if (!transactions.length) {
            const empty = document.createElement('li');
            empty.className = 'empty-state';
            empty.append(iconElement('receipt'), emptyText);
            container.appendChild(empty);
            return;
        }
        transactions.forEach((tx, index) => {
            const item = document.createElement('li');
            item.className = 'list-item';
            item.dataset.transactionId = tx.id;
            if (editingTransaction?.id === tx.id) item.classList.add('is-editing');

            const lead = document.createElement('span');
            lead.className = 'list-item__lead';
            lead.textContent = String(index + 1);

            const body = document.createElement('div');
            body.className = 'list-item__body';
            const headline = document.createElement('span');
            headline.className = 'list-item__headline';
            headline.textContent = tx.description || '적요 없음';
            const support = document.createElement('span');
            support.className = 'list-item__support';
            support.textContent = txSupportText(tx);
            body.append(headline, support);

            const trail = document.createElement('div');
            trail.className = 'list-item__trail';
            const amount = document.createElement('span');
            amount.className = 'list-item__amount';
            amount.textContent = `${((tx.cash_income || 0) + (tx.card_income || 0)).toLocaleString()}원`;
            const amountLabel = document.createElement('small');
            amountLabel.textContent = '매출';
            amount.appendChild(amountLabel);
            trail.appendChild(amount);

            if (withActions && isSuperAdmin()) {
                const more = document.createElement('button');
                more.type = 'button';
                more.className = 'icon-btn icon-btn--sm';
                more.setAttribute('aria-label', `${index + 1}번 내역 관리`);
                more.setAttribute('aria-haspopup', 'menu');
                more.innerHTML = iconSvg('more-vert');
                more.addEventListener('click', () => showActionMenu(more, [
                    { label: '수정', icon: iconSvg('edit'), onSelect: () => enterEditMode(tx, index + 1) },
                    { label: '삭제', icon: iconSvg('trash'), danger: true, onSelect: () => deleteTransaction(tx) }
                ]));
                trail.appendChild(more);
            }

            item.append(lead, body, trail);
            container.appendChild(item);
        });
    }

    function renderDailyTable(transactions) {
        setText('txCountChip', `${transactions.length.toLocaleString()}건`);
        renderTxList(txList, transactions, { withActions: true });
        if (transactions.length === 0) {
            setEmptyTableMessage(tableBody, 9, '아직 입력된 내역이 없습니다.');
            updateDailyTotals(0, 0, 0, 0);
            return;
        }
        tableBody.replaceChildren();
        let tCount = 0, tCashIn = 0, tCashOut = 0, tCardIn = 0;
        transactions.forEach((tx, index) => {
            tCount += tx.customer_count || 0;
            tCashIn += tx.cash_income || 0;
            tCashOut += tx.cash_expense || 0;
            tCardIn += tx.card_income || 0;

            const row = document.createElement('tr');
            row.dataset.transactionId = tx.id;
            if (editingTransaction?.id === tx.id) row.classList.add('is-editing');
            appendCell(row, index + 1);
            appendCell(row, tx.description || '', 'font-weight: 500;');
            appendCell(row, (tx.customer_count || 0).toLocaleString());
            appendCell(row, (tx.cash_income || 0).toLocaleString());
            appendCell(row, (tx.cash_expense || 0).toLocaleString());
            appendCell(row, (tx.card_income || 0).toLocaleString());
            appendCell(row, tx.remark1 || '', 'color: var(--text-muted);');
            appendCell(row, tx.remark2 || '', 'color: var(--text-muted);');
            const actionCell = appendCell(row, '');
            if (isSuperAdmin()) {
                const actions = document.createElement('div');
                actions.className = 'row-actions';

                const editBtn = document.createElement('button');
                editBtn.type = 'button';
                editBtn.className = 'btn-edit';
                editBtn.innerHTML = `${iconSvg('edit')}수정`;
                editBtn.setAttribute('aria-label', `${index + 1}번 내역 수정`);
                editBtn.addEventListener('click', () => enterEditMode(tx, index + 1));

                const deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.className = 'btn-danger';
                deleteBtn.innerHTML = `${iconSvg('trash')}삭제`;
                deleteBtn.setAttribute('aria-label', `${index + 1}번 내역 삭제`);
                deleteBtn.addEventListener('click', () => deleteTransaction(tx));

                actions.append(editBtn, deleteBtn);
                actionCell.appendChild(actions);
            } else {
                const locked = document.createElement('span');
                locked.className = 'sensitive-locked';
                locked.innerHTML = `${iconSvg('lock')}관리자 전용`;
                actionCell.appendChild(locked);
            }
            tableBody.appendChild(row);
        });
        updateDailyTotals(tCount, tCashIn, tCashOut, tCardIn);
    }

    function updateDailyTotals(count, cashIn, cashOut, cardIn) {
        elTotalCount.textContent = count.toLocaleString();
        elTotalCashIn.textContent = cashIn.toLocaleString();
        elTotalCashOut.textContent = cashOut.toLocaleString();
        elTotalCardIn.textContent = cardIn.toLocaleString();
        setText('dailyTotalSales', (cashIn + cardIn).toLocaleString());
        setText('dailyNetCash', (cashIn - cashOut).toLocaleString());
        setText('dailyTotalPeople', count.toLocaleString());
        setText('dailyTotalExpense', cashOut.toLocaleString());
    }

    function getTransactionAmount(tx, key) {
        const value = Number(tx?.[key]);
        return Number.isFinite(value) ? value : 0;
    }

    function setDailyQualityState(tone, statusText, messages) {
        const panel = document.getElementById('dailyQualityPanel');
        const status = document.getElementById('dailyQualityStatus');
        const list = document.getElementById('dailyQualityList');
        if (!panel || !status || !list) return;

        panel.classList.remove('quality-neutral', 'quality-success', 'quality-warning', 'quality-danger');
        panel.classList.add(`quality-${tone}`);
        status.className = `quality-badge quality-${tone}`;
        status.textContent = statusText;
        list.replaceChildren();

        if (messages.length === 1 && messages[0].tone === 'neutral') {
            const paragraph = document.createElement('p');
            paragraph.textContent = messages[0].text;
            list.appendChild(paragraph);
            return;
        }

        const items = document.createElement('ul');
        messages.forEach((message) => {
            const item = document.createElement('li');
            item.className = `quality-${message.tone || tone}`;
            item.textContent = message.text;
            items.appendChild(item);
        });
        list.appendChild(items);
    }

    function renderDailyQualityError(message) {
        setDailyQualityState('danger', '확인 실패', [{
            tone: 'danger',
            text: `입력 점검을 실행하지 못했습니다. ${message || '잠시 후 다시 조회해 주세요.'}`
        }]);
    }

    function renderDailyQualityChecks(date, transactions) {
        if (!transactions.length) {
            const isToday = date === getKstToday();
            setDailyQualityState('neutral', isToday ? '입력 전' : '데이터 없음', [{
                tone: 'neutral',
                text: isToday ? '오늘 아직 입력된 내역이 없습니다.' : '선택한 날짜에 입력된 내역이 없습니다.'
            }]);
            return;
        }

        const issues = [];
        let totalPeople = 0;
        let totalSales = 0;
        let totalExpense = 0;

        transactions.forEach((tx, index) => {
            const rowNo = index + 1;
            const people = getTransactionAmount(tx, 'customer_count');
            const cash = getTransactionAmount(tx, 'cash_income');
            const card = getTransactionAmount(tx, 'card_income');
            const expense = getTransactionAmount(tx, 'cash_expense');
            const sales = cash + card;
            const description = String(tx.description || '').trim();
            const remarkText = `${tx.remark1 || ''} ${tx.remark2 || ''}`.trim();

            totalPeople += people;
            totalSales += sales;
            totalExpense += expense;

            if (!description) {
                issues.push({ tone: 'warning', text: `${rowNo}번 내역의 적요가 비어 있습니다.` });
            }
            if (sales > 0 && people === 0) {
                issues.push({ tone: 'danger', text: `${rowNo}번 내역은 매출이 있는데 인원이 0명입니다.` });
            }
            if (people > 0 && sales === 0 && expense === 0) {
                issues.push({ tone: 'warning', text: `${rowNo}번 내역은 인원이 있는데 매출 금액이 없습니다.` });
            }
            if (people === 0 && sales === 0 && expense === 0) {
                issues.push({ tone: 'warning', text: `${rowNo}번 내역은 인원과 금액이 모두 0입니다.` });
            }
            if (expense > 0 && sales > 0 && expense / sales >= 0.3) {
                issues.push({ tone: 'warning', text: `${rowNo}번 내역은 지출이 매출의 30% 이상입니다.` });
            }
            if (expense > 0 && sales === 0 && !description && !remarkText) {
                issues.push({ tone: 'warning', text: `${rowNo}번 내역은 지출만 입력되어 있어 사유 확인이 필요합니다.` });
            }
        });

        if (totalSales > 0 && totalPeople === 0) {
            issues.unshift({ tone: 'danger', text: '오늘 총매출이 있는데 총 방문 인원이 0명입니다.' });
        }
        if (totalSales > 0 && totalExpense / totalSales >= 0.35) {
            issues.push({ tone: 'warning', text: `오늘 현금 지출 비중이 ${Math.round((totalExpense / totalSales) * 100).toLocaleString()}%입니다.` });
        }

        if (!issues.length) {
            setDailyQualityState('success', '정상', [{
                tone: 'success',
                text: `총 ${transactions.length.toLocaleString()}건의 인원, 매출, 지출 조합에 눈에 띄는 이상이 없습니다.`
            }]);
            return;
        }

        const hasDanger = issues.some((issue) => issue.tone === 'danger');
        const visibleIssues = issues.slice(0, 4);
        if (issues.length > visibleIssues.length) {
            visibleIssues.push({
                tone: 'warning',
                text: `그 외 ${issues.length - visibleIssues.length}건의 점검 항목이 더 있습니다.`
            });
        }

        setDailyQualityState(hasDanger ? 'danger' : 'warning', `${issues.length.toLocaleString()}건 확인`, visibleIssues);
    }

    const AMOUNT_INPUT_IDS = ['count', 'cashIn', 'cardIn', 'cashOut'];
    const SUBMIT_IDLE_HTML = `${iconSvg('check')}입력하기`;
    const SUBMIT_EDIT_HTML = `${iconSvg('save')}수정 저장`;
    const descInput = document.getElementById('desc');
    descInput?.addEventListener('input', () => descInput.closest('.field')?.classList.remove('has-error'));

    function readTransactionForm() {
        return {
            transaction_date: editingTransaction?.transaction_date || datePicker.value,
            description: document.getElementById('desc').value.trim(),
            customer_count: parseCommas(document.getElementById('count').value),
            cash_income: parseCommas(document.getElementById('cashIn').value),
            cash_expense: parseCommas(document.getElementById('cashOut').value),
            card_income: parseCommas(document.getElementById('cardIn').value),
            remark1: document.getElementById('remark1').value.trim(),
            remark2: document.getElementById('remark2').value.trim()
        };
    }

    function resetTransactionForm() {
        form.reset();
        AMOUNT_INPUT_IDS.forEach((id) => { document.getElementById(id).value = ''; });
        updateEntryPreview();
    }

    function enterEditMode(tx, rowNo) {
        editingTransaction = tx;
        document.getElementById('desc').value = tx.description || '';
        document.getElementById('count').value = formatCommas(tx.customer_count || 0);
        document.getElementById('cashIn').value = formatCommas(tx.cash_income || 0);
        document.getElementById('cardIn').value = formatCommas(tx.card_income || 0);
        document.getElementById('cashOut').value = formatCommas(tx.cash_expense || 0);
        document.getElementById('remark1').value = tx.remark1 || '';
        document.getElementById('remark2').value = tx.remark2 || '';
        updateEntryPreview();

        transactionFormTitle.innerHTML = iconSvg('edit');
        transactionFormTitle.append(`${rowNo}번 내역 수정`);
        cancelEditBtn?.classList.remove('hidden-view');
        form.classList.add('is-editing');
        submitTransactionBtn.innerHTML = SUBMIT_EDIT_HTML;
        document.querySelectorAll('#tableBody tr.is-editing, #txList .is-editing').forEach((row) => row.classList.remove('is-editing'));
        document.querySelectorAll(`[data-transaction-id="${tx.id}"]`).forEach((row) => row.classList.add('is-editing'));

        if (isMobileLayout()) {
            entrySheet.open();
        } else {
            document.getElementById('entryPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            document.getElementById('desc').focus({ preventScroll: true });
        }
    }

    function exitEditMode({ resetForm = false } = {}) {
        editingTransaction = null;
        transactionFormTitle.innerHTML = iconSvg('add-circle');
        transactionFormTitle.append('내역 추가');
        cancelEditBtn?.classList.add('hidden-view');
        form.classList.remove('is-editing');
        submitTransactionBtn.innerHTML = SUBMIT_IDLE_HTML;
        document.querySelectorAll('#tableBody tr.is-editing, #txList .is-editing').forEach((row) => row.classList.remove('is-editing'));
        if (resetForm) resetTransactionForm();
    }

    function describeChange(label, before, after, format = (value) => value) {
        if (String(before ?? '') === String(after ?? '')) return null;
        return `${label}: ${format(before) || '없음'} → ${format(after) || '없음'}`;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (submitTransactionBtn?.disabled) return;
        const editing = editingTransaction;
        const values = readTransactionForm();
        const summary = buildTransactionSummary(values);
        if (!values.description) {
            descInput?.closest('.field')?.classList.add('has-error');
            descInput?.focus();
            showToast('적요를 입력해 주세요.', { tone: 'danger' });
            return;
        }

        let confirmMessage;
        if (editing) {
            const changes = [
                describeChange('적요', editing.description, values.description),
                describeChange('인원', editing.customer_count, values.customer_count, (v) => `${Number(v || 0).toLocaleString()}명`),
                describeChange('현금 수입', editing.cash_income, values.cash_income, formatWon),
                describeChange('카드 수입', editing.card_income, values.card_income, formatWon),
                describeChange('현금 지출', editing.cash_expense, values.cash_expense, formatWon),
                describeChange('비고 1', editing.remark1, values.remark1),
                describeChange('비고 2', editing.remark2, values.remark2)
            ].filter(Boolean);
            if (!changes.length) {
                showToast('바뀐 내용이 없습니다.', { tone: 'info' });
                return;
            }
            confirmMessage = ['이 내역을 수정할까요?', `일자: ${values.transaction_date}`, ...changes].join('\n');
        } else {
            confirmMessage = [
                '입력 내용을 저장할까요?',
                `일자: ${values.transaction_date}`,
                `적요: ${values.description || '미입력'}`,
                `인원: ${summary.people.toLocaleString()}명`,
                `총매출: ${formatWon(summary.sales)} (현금 ${formatWon(summary.cash)} / 카드 ${formatWon(summary.card)})`,
                `현금 지출: ${formatWon(summary.expense)}`,
                `비고: ${[values.remark1, values.remark2].filter(Boolean).join(' / ') || '없음'}`
            ].join('\n');
        }

        // 새 내역은 '저장 전 확인창' 설정을 따르고, 수정은 바뀐 내용을 보여줘야 하므로 항상 확인한다.
        if (editing || isConfirmBeforeSave()) {
            const confirmed = await window.showConfirm(confirmMessage, {
                danger: false,
                confirmLabel: editing ? '수정' : '저장',
                icon: editing ? 'edit' : 'save'
            });
            if (!confirmed) return;
        }

        submitTransactionBtn.disabled = true;
        submitTransactionBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span>저장 중...';

        try {
            if (editing) {
                await api.updateTransaction(editing.id, values);
                exitEditMode({ resetForm: true });
                if (isMobileLayout()) entrySheet.close();
                showToast('내역을 수정했습니다.');
            } else {
                const payload = { ...values, client_id: newClientId() };
                try {
                    await api.createTransaction(payload);
                } catch (err) {
                    if (err.code !== 'NETWORK_ERROR') throw err;
                    addToOutbox(currentUserEmail, payload);
                    rememberDescriptionSuggestion(values.description);
                    resetTransactionForm();
                    showToast('인터넷이 끊겨 휴대폰에 임시 저장했어요. 연결되면 자동으로 보낼게요.', { tone: 'info', duration: 6000 });
                    return;
                }
                rememberDescriptionSuggestion(values.description);
                resetTransactionForm();
                showToast(`입력 완료 · ${values.description} ${formatWon(summary.sales)}`);
            }
            await loadDailyData(values.transaction_date);
            document.getElementById('desc')?.focus();
        } catch (error) {
            await window.showAlert("저장 실패: " + error.message);
        } finally {
            submitTransactionBtn.disabled = false;
            submitTransactionBtn.innerHTML = editingTransaction ? SUBMIT_EDIT_HTML : SUBMIT_IDLE_HTML;
        }
    });

    async function deleteTransaction(tx) {
        if (!isSuperAdmin()) {
            await window.showAlert('내역 삭제는 관리자만 가능합니다.');
            return;
        }

        const summary = buildTransactionSummary(tx);
        const confirmMessage = [
            '이 내역을 삭제 처리할까요?',
            `일자: ${tx.transaction_date || datePicker.value}`,
            `적요: ${tx.description || '적요 없음'}`,
            `인원: ${summary.people.toLocaleString()}명`,
            `총매출: ${formatWon(summary.sales)}`,
            `현금 지출: ${formatWon(summary.expense)}`,
            '삭제된 내역은 화면에서 숨겨지고 서버에 보관됩니다.'
        ].join('\n');

        if (!(await window.showConfirm(confirmMessage, { danger: true, confirmLabel: '삭제', icon: 'trash' }))) return;
        try {
            await api.deleteTransaction(tx.id);
        } catch (error) {
            await window.showAlert("삭제 실패: " + error.message);
            return;
        }
        if (editingTransaction?.id === tx.id) exitEditMode({ resetForm: true });
        await loadDailyData(datePicker.value);
        showToast(`삭제했습니다 · ${tx.description || '적요 없음'}`, {
            tone: 'info',
            duration: 7000,
            actionLabel: '되돌리기',
            onAction: async () => {
                try {
                    await api.restoreTransaction(tx.id);
                    showToast('삭제를 취소했습니다.');
                    if (datePicker.value === tx.transaction_date) loadDailyData(datePicker.value);
                } catch (error) {
                    await window.showAlert("복원 실패: " + error.message);
                }
            }
        });
    }

    saveNoteBtn.addEventListener('click', async () => {
        const note = noteInput.value.trim();
        const date = datePicker.value;
        if (note === savedNoteText.trim()) {
            showToast('바뀐 내용이 없습니다.', { tone: 'info' });
            return;
        }
        const confirmMessage = [
            '특기사항을 저장할까요?',
            `일자: ${date}`,
            `내용 길이: ${note.length.toLocaleString()}자`
        ].join('\n');
        if (!(await window.showConfirm(confirmMessage, { danger: false, confirmLabel: '저장', icon: 'note' }))) return;
        saveNoteBtn.disabled = true;
        try {
            const saved = await api.saveNote(date, note);
            if (date === currentDailyDate) {
                savedNoteText = saved.special_note;
                noteInput.value = savedNoteText;
                updateNoteStatus();
            }
            showToast('특기사항을 저장했습니다.');
        } catch (error) {
            await window.showAlert("저장 실패: " + error.message);
        } finally {
            saveNoteBtn.disabled = false;
        }
    });

    const VIEW_ORDER = ['daily', 'monthly', 'total'];

    function switchTab(tabName, { date } = {}) {
        if (!VIEWS[tabName]) return;
        const previousView = currentView;
        const applyView = () => {
            currentView = tabName;
            Object.entries(VIEWS).forEach(([name, view]) => view.el.classList.toggle('hidden-view', name !== tabName));
            document.querySelectorAll('[data-nav]').forEach((item) => {
                const active = item.dataset.nav === tabName;
                item.classList.toggle('active', active);
                if (active) item.setAttribute('aria-current', 'page');
                else item.removeAttribute('aria-current');
            });
            navIndicators.update();
            // 입력 버튼(FAB)은 일일 내역에서만 보인다.
            entryFab?.classList.toggle('is-hidden', tabName !== 'daily');
            if (tabName !== 'daily') entrySheet.close();
            updateAppBar();
            window.scrollTo({ top: 0 });
        };

        if (previousView === tabName) {
            applyView();
        } else {
            // 메뉴 순서상 오른쪽으로 가면 앞으로, 왼쪽이면 뒤로 미끄러진다.
            const direction = VIEW_ORDER.indexOf(tabName) > VIEW_ORDER.indexOf(previousView) ? 'forward' : 'back';
            runViewTransition(applyView, { direction, targets: [VIEWS[tabName].el, document.querySelector('.top-app-bar__titles')] });
        }

        if (tabName === 'daily') {
            if (date && date !== currentDailyDate) changeDailyDate(date);
            else loadDailyData(datePicker.value);
        } else if (tabName === 'monthly') {
            loadMonthlyData(monthPicker.value);
        } else if (tabName === 'total') {
            loadTotalRangeData();
            if (!seasonLoaded) loadItemSeasons();
        }
    }

    // 요구사항 1번: 월간 상세 현황 데이터 로드 및 모달 상세창 바인딩 로직 구현
    async function showDayDetailPopup(dateStr) {
        const modal = document.getElementById('dailyDetailModal');
        const titleDate = document.getElementById('detailModalTitleDate');
        const modalTableBody = document.getElementById('detailModalTableBody');
        
        if(!modal || !modalTableBody) return;

        const detailList = document.getElementById('detailModalList');
        detailModalDate = dateStr;
        titleDate.textContent = formatKoreanDate(dateStr);
        setText('detailCountChip', '조회 중');
        setEmptyTableMessage(modalTableBody, 8, '해당 일자 세부 건별 명세 조회 중...');
        detailList?.replaceChildren();
        detailDialog.open();

        try {
            const list = await api.listTransactionsByDate(dateStr);
            if (detailModalDate !== dateStr) return;

            setText('detailCountChip', `${list.length.toLocaleString()}건 · ${formatWon(list.reduce((sum, tx) => sum + (tx.cash_income || 0) + (tx.card_income || 0), 0))}`);
            renderTxList(detailList, list, { emptyText: '이 날짜에는 등록된 내역이 없습니다.' });
            if(!list || list.length === 0) {
                setEmptyTableMessage(modalTableBody, 8, '해당 일자에는 등록된 상세 판매 내역이 없습니다.');
                return;
            }

            modalTableBody.replaceChildren();
            list.forEach((tx, idx) => {
                const row = document.createElement('tr');
                appendCell(row, idx + 1);
                appendCell(row, tx.description || '-', 'font-weight: 500; text-align: left !important;');
                appendCell(row, `${(tx.customer_count || 0).toLocaleString()}명`);
                appendCell(row, formatWon(tx.cash_income), 'color: var(--secondary); font-weight: 600;');
                appendCell(row, formatWon(tx.cash_expense), 'color: var(--danger);');
                appendCell(row, formatWon(tx.card_income), 'color: #f59e0b; font-weight: 600;');
                appendCell(row, tx.remark1 || '', 'color: var(--text-muted); text-align: left !important;');
                appendCell(row, tx.remark2 || '', 'color: var(--text-muted); text-align: left !important;');
                modalTableBody.appendChild(row);
            });
        } catch (err) {
            console.error(err);
            setEmptyTableMessage(modalTableBody, 8, `명세 로드 실패 (${err.message})`, { tone: 'danger' });
        }
    }

    /* ---------------- AI 월간 리포트 (Gemini) ---------------- */
    // 숫자는 서버가 DB 에서 계산하고, AI 는 해석 문장만 쓴다. 만들기는 관리자만, 보기는 모두.
    const aiReportCard = document.getElementById('monthAiReport');
    const aiReportBody = document.getElementById('aiReportBody');
    const aiReportFoot = document.getElementById('aiReportFoot');
    const aiReportBtn = document.getElementById('aiReportBtn');
    const AI_SECTIONS = [
        ['summary', '핵심 요약', 'insight'],
        ['positives', '좋았던 점', 'trend-up'],
        ['cautions', '주의할 점', 'warning'],
        ['nextActions', '다음 준비', 'calendar-search']
    ];
    const AI_PRIVACY_NOTE = '리포트를 만들면 집계된 매출 숫자와 품목명만 Google Gemini(무료 등급)로 보냅니다. 무료 등급은 보낸 내용이 Google 서비스 개선에 쓰일 수 있어요.';
    let aiStatusPromise = null;
    let aiReportMonth = null;
    let aiGenerating = false;

    function getAiStatus() {
        aiStatusPromise ||= api.aiStatus().catch(() => ({ enabled: false }));
        return aiStatusPromise;
    }

    function createEmptyCompact(message) {
        const box = document.createElement('div');
        box.className = 'empty-compact';
        box.textContent = message;
        return box;
    }

    function setAiFoot(lines) {
        aiReportFoot.replaceChildren(...lines.filter(Boolean).map((line) => {
            const span = document.createElement('span');
            span.textContent = line;
            return span;
        }));
    }

    function setAiButton({ label, busy = false }) {
        const text = document.createElement('span');
        text.textContent = label;
        const icon = busy ? Object.assign(document.createElement('span'), { className: 'spinner' }) : iconElement('flash');
        icon.setAttribute('aria-hidden', 'true');
        aiReportBtn.replaceChildren(icon, text);
        aiReportBtn.disabled = busy;
    }

    function renderAiReport(report) {
        const admin = isSuperAdmin();
        if (!report) {
            aiReportBody.replaceChildren(createEmptyCompact(admin
                ? '아직 이 달의 리포트가 없어요. "리포트 만들기"를 누르면 AI가 이 달 매출을 해석해 드려요.'
                : '아직 이 달의 리포트가 없어요. 관리자가 만들면 여기에 보여요.'));
            setAiFoot([admin && AI_PRIVACY_NOTE]);
            return;
        }
        const headline = document.createElement('p');
        headline.className = 'ai-report__headline';
        headline.textContent = report.content.headline;
        const grid = document.createElement('div');
        grid.className = 'ai-report__grid';
        AI_SECTIONS.forEach(([key, title, icon]) => {
            const items = report.content[key] || [];
            if (items.length === 0) return;
            const section = document.createElement('section');
            section.className = `ai-report__section ai-report__section--${key}`;
            const heading = document.createElement('h3');
            heading.append(iconElement(icon), title);
            const list = document.createElement('ul');
            items.forEach((text) => {
                const item = document.createElement('li');
                item.textContent = text;
                list.append(item);
            });
            section.append(heading, list);
            grid.append(section);
        });
        aiReportBody.replaceChildren(headline, grid);
        const stale = report.month === getKstToday().slice(0, 7) && report.dataThrough < getKstToday();
        setAiFoot([
            `${formatKstDateTime(report.createdAt)} 생성 · ${report.dataThrough.replaceAll('-', '.')}까지 반영 · ${report.model}`,
            stale && admin ? '그 뒤 입력분까지 반영하려면 "다시 만들기"를 누르세요.' : '',
            'AI가 쓴 해석이에요. 숫자는 위 표와 함께 확인해 주세요.',
            admin && AI_PRIVACY_NOTE
        ]);
    }

    async function loadMonthlyAiReport(month) {
        aiReportMonth = month;
        const status = await getAiStatus();
        const admin = isSuperAdmin();
        // 꺼져 있으면 관리자에게만 설정 안내를 보여 준다.
        aiReportCard.classList.toggle('hidden-view', !status.enabled && !admin);
        aiReportBtn.classList.toggle('hidden-view', !status.enabled || !admin);
        if (!status.enabled) {
            if (admin) {
                aiReportBody.replaceChildren(createEmptyCompact('서버에 Gemini API 키(GEMINI_API_KEY)를 넣으면 AI가 월간 리포트를 써 드려요. 설정 방법은 docs/AI-REPORT.md 를 참고하세요.'));
                setAiFoot([]);
            }
            return;
        }
        if (aiGenerating) return;
        aiReportBody.replaceChildren(createEmptyCompact('리포트를 불러오는 중...'));
        setAiFoot([]);
        try {
            const report = await api.getMonthlyAiReport(month);
            if (aiReportMonth !== month || aiGenerating) return;
            renderAiReport(report);
            setAiButton({ label: report ? '다시 만들기' : '리포트 만들기' });
        } catch (err) {
            if (aiReportMonth !== month) return;
            aiReportBody.replaceChildren(createEmptyCompact(`리포트를 불러오지 못했어요. (${err.message})`));
        }
    }

    aiReportBtn?.addEventListener('click', async () => {
        const month = aiReportMonth;
        if (!month || aiGenerating) return;
        aiGenerating = true;
        setAiButton({ label: '만드는 중...', busy: true });
        aiReportBody.replaceChildren(createEmptyCompact('AI가 이 달 매출을 읽고 리포트를 쓰는 중이에요. 보통 10~30초 걸려요.'));
        try {
            const { report, cached } = await api.createMonthlyAiReport(month);
            if (aiReportMonth === month) renderAiReport(report);
            showToast(cached ? '데이터가 그대로라 저장된 리포트를 보여 드려요.' : 'AI 월간 리포트를 만들었어요.', { tone: cached ? 'info' : 'success' });
        } catch (err) {
            showToast(err.message, { tone: 'danger', duration: 6000 });
        } finally {
            aiGenerating = false;
            setAiButton({ label: '다시 만들기' });
            if (aiReportMonth !== month) loadMonthlyAiReport(aiReportMonth);
            else if (aiReportBody.querySelector('.empty-compact')) loadMonthlyAiReport(month);
        }
    });

    async function loadMonthlyData(monthStr) {
        if (!monthStr) return;
        const seq = ++monthlyLoadSeq;
        loadMonthlyAiReport(monthStr);
        try {
            setEmptyTableMessage(monthlyTableBody, 11, '데이터를 분석하는 중...');
            const pad = (value) => String(value).padStart(2, '0');
            const [year, month] = monthStr.split('-').map(Number);
            const startDate = `${monthStr}-01`;
            const lastDay = getLastDayOfMonth(year, month);
            const endDate = `${monthStr}-${pad(lastDay)}`;

            // 진행 중인 달은 오늘까지만 비교한다. (지난달 전체와 비교하면 늘 크게 줄어든 것처럼 보인다)
            const today = getKstToday();
            const isCurrentMonth = monthStr === today.slice(0, 7);
            const compareDay = isCurrentMonth ? Number(today.slice(8, 10)) : lastDay;
            const compareEnd = `${monthStr}-${pad(compareDay)}`;

            const prevMonth = getPreviousMonth(monthStr);
            const prevLastDay = getLastDayOfMonth(Number(prevMonth.slice(0, 4)), Number(prevMonth.slice(5, 7)));
            const prevStartDate = `${prevMonth}-01`;
            const prevEndDate = `${prevMonth}-${pad(isCurrentMonth ? Math.min(compareDay, prevLastDay) : prevLastDay)}`;

            // 계절 영향이 큰 가게라 작년 같은 달과의 비교를 가장 먼저 본다.
            const lastYearMonth = `${year - 1}-${pad(month)}`;
            const lastYearLastDay = getLastDayOfMonth(year - 1, month);
            const lastYearStart = `${lastYearMonth}-01`;
            const lastYearEnd = `${lastYearMonth}-${pad(lastYearLastDay)}`;
            const lastYearCompareEnd = `${lastYearMonth}-${pad(isCurrentMonth ? Math.min(compareDay, lastYearLastDay) : lastYearLastDay)}`;

            const [{ summaryRows, prevSummaryRows, transactions, previousTransactions }, lastYearRows] = await Promise.all([
                fetchPeriodBundle(startDate, endDate, prevStartDate, prevEndDate),
                fetchDailySalesSummary(lastYearStart, lastYearEnd)
            ]);
            if (seq !== monthlyLoadSeq) return;

            const dailySummary = buildDailySummaryFromView(startDate, endDate, summaryRows);
            const summary = summarizeDailyMap(dailySummary);
            const compareSummary = summarizeDailyMap(pickDailyRange(dailySummary, startDate, compareEnd));
            const prevSummary = summarizeDailyMap(buildDailySummaryFromView(prevStartDate, prevEndDate, prevSummaryRows));
            const lastYearDaily = buildDailySummaryFromView(lastYearStart, lastYearEnd, lastYearRows);
            const lastYearSummary = summarizeDailyMap(pickDailyRange(lastYearDaily, lastYearStart, lastYearCompareEnd));
            const monthComparison = { label: isCurrentMonth ? '전월 같은 기간' : '전월', ...compareTotals(compareSummary, prevSummary) };
            const yearComparison = { label: isCurrentMonth ? '전년 같은 기간' : '전년 같은 달', ...compareTotals(compareSummary, lastYearSummary) };
            const weekdaySummary = summarizeWeekdayPerformance(dailySummary, transactions);
            const descriptionSummary = summarizeDescriptions(transactions, {
                previousTransactions,
                comparisonLabel: `${monthComparison.label} 대비`
            });

            monthlyTableBody.innerHTML = '';
            let accCount = 0, accCash = 0, accExpense = 0, accCard = 0, accTotal = 0, accNet = 0;

            for (let i = 1; i <= lastDay; i++) {
                const d = `${monthStr}-${String(i).padStart(2, '0')}`;
                const dayData = dailySummary[d];
                
                accCount += dayData.count; accCash += dayData.cash; accExpense += dayData.expense; accCard += dayData.card; accTotal += dayData.total; accNet += dayData.net;

                const row = document.createElement('tr');
                // 클릭 가능한 행임을 스타일로 유추할 수 있도록 클래스 주입
                row.classList.add('clickable-row');
                if (dayData.total === 0) row.style.opacity = '0.5'; 

                const dayName = getDayName(d);
                const formattedDate = `${d} (${dayName})`;

                row.innerHTML = `
                    <td>${formattedDate}</td>
                    <td>${dayData.count.toLocaleString()}</td>
                    <td style="font-weight:700; color:var(--text-main);">${accCount.toLocaleString()}</td>
                    <td>${dayData.cash.toLocaleString()}</td>
                    <td style="color:var(--secondary); font-weight:700;">${accCash.toLocaleString()}</td>
                    <td style="color:var(--danger);">${dayData.expense.toLocaleString()}</td>
                    <td style="color:var(--danger); font-weight:700;">${accExpense.toLocaleString()}</td>
                    <td>${dayData.card.toLocaleString()}</td>
                    <td style="color:#f59e0b; font-weight:700;">${accCard.toLocaleString()}</td>
                    <td style="font-weight:700; color:var(--primary);">${dayData.total.toLocaleString()}</td>
                    <td style="font-weight:700; color:var(--text-main);">${dayData.net.toLocaleString()}</td>
                `;
                
                // 요구사항 1번: 일자별 행 클릭 시 상세 모달을 호출하는 클릭 핸들러 동적 주입
                row.addEventListener('click', () => {
                    showDayDetailPopup(d);
                });
                
                monthlyTableBody.appendChild(row);
            }

            setText('monthTotalSales', summary.total.toLocaleString());
            setText('monthTotalCash', summary.cash.toLocaleString());
            setText('monthTotalCard', summary.card.toLocaleString());
            setText('monthTotalExpense', summary.expense.toLocaleString());
            setText('monthNetSales', summary.net.toLocaleString());
            setText('monthTotalCount', summary.count.toLocaleString());

            setText('monthAvgSales', summary.averageSales.toLocaleString() + " 원");
            setText('monthAvgTicket', summary.averageTicket.toLocaleString() + " 원");
            setTrendValue('monthCompareSales', yearComparison);
            setText('monthMaxSalesDay', summary.maxSales > 0 ? `${summary.maxSalesDay.substring(5)}일 (${summary.maxSales.toLocaleString()}원)` : '-');
            setText('monthCashRatio', formatPercent(summary.cashRatio));
            setText('monthOperatingDays', `${summary.operatingDays.toLocaleString()}일`);
            setText('monthlyDetailMeta', `${summary.operatingDays.toLocaleString()}영업일 · ${formatWon(summary.total)}`);
            const currentLabel = isCurrentMonth ? '이번 달' : `${month}월`;
            const lastYearFullSummary = summarizeDailyMap(lastYearDaily);
            renderComparePanel('monthCompareList', [
                { label: isCurrentMonth ? '이번 달 (오늘까지)' : `${year}년 ${month}월`, start: startDate, end: compareEnd, summary: compareSummary, kind: 'current' },
                ...(isCurrentMonth ? buildForecastRows({
                    compareSummary, lastYearSummary, lastYearFullSummary, compareDay, lastDay, month, startDate, endDate
                }) : []),
                { label: monthComparison.label, start: prevStartDate, end: prevEndDate, summary: prevSummary, comparison: monthComparison },
                { label: yearComparison.label, start: lastYearStart, end: lastYearCompareEnd, summary: lastYearSummary, comparison: yearComparison },
                ...(isCurrentMonth ? [{
                    label: `작년 ${month}월 전체`,
                    start: lastYearStart,
                    end: lastYearEnd,
                    summary: lastYearFullSummary,
                    kind: 'reference',
                    note: '이번 달 마감 목표로 참고하세요.'
                }] : [])
            ], currentLabel);
            renderWeekdaySignals('monthWeekdaySignals', weekdaySummary);
            renderDescriptionRanking('monthDescriptionRanking', descriptionSummary);
            renderInsightList('monthInsightList', createInsightMessages(summary, [yearComparison, monthComparison], {
                weekday: weekdaySummary,
                descriptions: descriptionSummary
            }));

        } catch (err) {
            if (seq !== monthlyLoadSeq) return;
            console.error(err);
            setText('monthlyDetailMeta', '조회 실패');
            setEmptyTableMessage(monthlyTableBody, 11, `통계 데이터를 불러오지 못했습니다. (${err.message})`, { tone: 'danger' });
        }
    }

    // Chart.js 는 '총 통계' 탭에서만 필요하므로 처음 쓸 때 받아온다. (첫 화면 로딩을 가볍게)
    let chartLibraryPromise = null;
    function loadChartLibrary() {
        chartLibraryPromise ||= import('chart.js/auto').then((module) => module.default);
        return chartLibraryPromise;
    }

    function readCssVar(name, fallback) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    }

    // 요구사항 2번: 트렌디한 통계 분석 처리를 위한 종합 시각화 및 요일 분석 엔진 탑재
    async function renderAdvancedAnalytics(dailySummary) {
        lastTrendDailySummary = dailySummary;
        updateChartModeButtons();

        const sortedDates = Object.keys(dailySummary).sort();
        const labels = sortedDates.map(d => d.substring(5)); // 'MM-DD' 포맷팅
        
        const cashData = [];
        const cardData = [];
        const expenseData = [];
        const customerData = [];
        const totalData = [];
        const averageTicketData = [];
        
        // 요일별 누적 집계 데이터 공간 구성 (0: 일요일 ~ 6: 토요일)
        const weekdaySales = [0, 0, 0, 0, 0, 0, 0];
        const weekdayOpenDays = [0, 0, 0, 0, 0, 0, 0];
        const weekdayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
        let totalSalesAccum = 0;

        sortedDates.forEach(d => {
            const data = dailySummary[d];
            cashData.push(data.cash);
            cardData.push(data.card);
            expenseData.push(data.expense || 0);
            customerData.push(data.count);
            totalData.push(data.total);
            averageTicketData.push(data.count > 0 ? Math.round(data.total / data.count) : 0);
            
            // 요일 정보 추출하여 가산
            const dayIndex = parseDateKey(d).getDay();
            weekdaySales[dayIndex] += data.total;
            if (data.count > 0 || data.total > 0 || data.expense > 0) weekdayOpenDays[dayIndex]++;
            totalSalesAccum += data.total;
        });

        renderTrendSummary(dailySummary);

        // 1) 복합 다차원 추이 그래프 시각화 빌드 (Chart.js 제어)
        const ctx = document.getElementById('totalTrendChart');
        let Chart = null;
        if (ctx) {
            try {
                Chart = await loadChartLibrary();
            } catch (err) {
                console.error(err);
                chartLibraryPromise = null;
                showToast('차트 라이브러리를 불러오지 못했습니다. 새로고침 해주세요.', { tone: 'danger' });
            }
        }
        if (ctx && Chart) {
            if (trendChartInstance) {
                trendChartInstance.destroy(); // 기존 차트 자원 반환 및 초기화
            }
            // 차트 색은 화면 테마(라이트/다크)의 색 역할을 그대로 쓴다.
            const palette = {
                primary: readCssVar('--md-primary', '#2563eb'),
                tertiary: readCssVar('--md-tertiary', '#0f8a5f'),
                error: readCssVar('--md-error', '#d32f2f'),
                amber: readCssVar('--md-amber', '#d97706'),
                violet: readCssVar('--md-violet', '#7048e8'),
                surface: readCssVar('--md-surface-container-lowest', '#ffffff')
            };
            const withAlpha = (hex, alpha) => (/^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${alpha}` : hex);
            Chart.defaults.color = readCssVar('--md-on-surface-variant', '#464c59');
            Chart.defaults.borderColor = readCssVar('--md-outline-variant', '#c6cbd7');
            Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;

            const positiveSalesValues = totalData.filter(value => value > 0);
            const maxSalesValue = positiveSalesValues.length ? Math.max(...positiveSalesValues) : 0;
            const minSalesValue = positiveSalesValues.length ? Math.min(...positiveSalesValues) : 0;
            const totalBarBackground = totalData.map((value) => {
                if (value > 0 && value === maxSalesValue) return palette.primary;
                if (maxSalesValue !== minSalesValue && value > 0 && value === minSalesValue) return withAlpha(palette.primary, '55');
                return withAlpha(palette.primary, 'b3');
            });
            const totalBarBorder = totalData.map((value) => {
                if (value > 0 && value === maxSalesValue) return palette.primary;
                if (maxSalesValue !== minSalesValue && value > 0 && value === minSalesValue) return withAlpha(palette.primary, '55');
                return withAlpha(palette.primary, 'b3');
            });
            const movingAverageData = buildMovingAverage(totalData, 7);

            const chartModeCaption = {
                sales: '현금+카드 총매출, 7일 평균, 지출 흐름을 함께 봅니다.',
                payment: '현금과 카드 매출 비중을 누적 막대로 봅니다.',
                people: '방문 인원과 객단가가 매출에 미치는 흐름을 봅니다.'
            };
            setText('trendChartCaption', chartModeCaption[currentChartMode] || chartModeCaption.sales);

            const chartConfigByMode = {
                sales: {
                    datasets: [
                        {
                            label: '총매출',
                            data: totalData,
                            backgroundColor: totalBarBackground,
                            borderColor: totalBarBorder,
                            borderWidth: 1,
                            borderRadius: 6,
                            maxBarThickness: 44,
                            order: 2
                        },
                        {
                            label: '7일 평균',
                            data: movingAverageData,
                            type: 'line',
                            borderColor: palette.tertiary,
                            backgroundColor: palette.tertiary,
                            borderWidth: 3,
                            pointRadius: 0,
                            pointHoverRadius: 5,
                            tension: 0.35,
                            order: 1,
                            fill: false
                        },
                        {
                            label: '현금 지출',
                            data: expenseData,
                            type: 'line',
                            borderColor: palette.error,
                            backgroundColor: palette.error,
                            borderDash: [5, 5],
                            borderWidth: 3,
                            pointRadius: 4,
                            pointHoverRadius: 6,
                            pointBorderWidth: 2,
                            pointBorderColor: palette.surface,
                            tension: 0.2,
                            order: 1,
                            fill: false
                        }
                    ],
                    stacked: false,
                    yTitle: '금액 (원)',
                    peopleAxis: false
                },
                payment: {
                    datasets: [
                        {
                            label: '현금 수입',
                            data: cashData,
                            backgroundColor: palette.tertiary,
                            stack: 'combinedSales',
                            borderRadius: 5,
                            maxBarThickness: 42,
                            order: 2
                        },
                        {
                            label: '카드 수입',
                            data: cardData,
                            backgroundColor: palette.amber,
                            stack: 'combinedSales',
                            borderRadius: 5,
                            maxBarThickness: 42,
                            order: 2
                        },
                        {
                            label: '현금 지출',
                            data: expenseData,
                            type: 'line',
                            borderColor: palette.error,
                            backgroundColor: palette.error,
                            borderDash: [5, 5],
                            borderWidth: 3,
                            pointRadius: 4,
                            pointHoverRadius: 6,
                            pointBorderWidth: 2,
                            pointBorderColor: palette.surface,
                            tension: 0.2,
                            order: 1,
                            fill: false
                        }
                    ],
                    stacked: true,
                    yTitle: '금액 (원)',
                    peopleAxis: false
                },
                people: {
                    datasets: [
                        {
                            label: '총매출',
                            data: totalData,
                            backgroundColor: totalBarBackground,
                            borderColor: totalBarBorder,
                            borderRadius: 6,
                            maxBarThickness: 42,
                            order: 2
                        },
                        {
                            label: '객단가',
                            data: averageTicketData,
                            type: 'line',
                            borderColor: palette.tertiary,
                            backgroundColor: palette.tertiary,
                            borderWidth: 3,
                            pointRadius: 3,
                            pointHoverRadius: 6,
                            pointBorderWidth: 2,
                            pointBorderColor: palette.surface,
                            tension: 0.3,
                            order: 1,
                            fill: false
                        },
                        {
                            label: '방문 인원 (명)',
                            data: customerData,
                            type: 'line',
                            borderColor: palette.violet,
                            backgroundColor: palette.violet,
                            borderWidth: 3,
                            pointRadius: 3,
                            pointHoverRadius: 6,
                            pointBorderWidth: 2,
                            pointBorderColor: palette.surface,
                            tension: 0.3,
                            fill: false,
                            order: 1,
                            yAxisID: 'yPeopleAxis'
                        }
                    ],
                    stacked: false,
                    yTitle: '금액 (원)',
                    peopleAxis: true
                }
            };

            const chartConfig = chartConfigByMode[currentChartMode] || chartConfigByMode.sales;
            
            trendChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: chartConfig.datasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { stacked: chartConfig.stacked, grid: { display: false } },
                        y: {
                            stacked: chartConfig.stacked,
                            position: 'left',
                            title: { display: true, text: chartConfig.yTitle, font: { weight: 'bold' } },
                            ticks: { callback: value => value.toLocaleString() }
                        },
                        yPeopleAxis: {
                            display: chartConfig.peopleAxis,
                            position: 'right',
                            title: { display: true, text: '방문객 수 (명)', font: { weight: 'bold' } },
                            grid: { display: false },
                            ticks: { stepSize: 1 }
                        }
                    },
                    plugins: {
                        legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8 } }
                    }
                }
            });
        }

        // 2) 요일별 기여도 게이지 분석기 UI 렌더링
        const weekdayWrap = document.getElementById('weekdayContributionWrap');
        if (weekdayWrap) {
            weekdayWrap.innerHTML = '';
            
            weekdaySales.forEach((sales, idx) => {
                const ratio = totalSalesAccum > 0 ? Math.round((sales / totalSalesAccum) * 100) : 0;
                const avgSales = weekdayOpenDays[idx] > 0 ? Math.round(sales / weekdayOpenDays[idx]) : 0;
                
                const barRow = document.createElement('div');
                barRow.className = 'weekday-bar-row';
                // 일요일은 빨강, 토요일은 파랑으로 구분
                const dayClass = idx === 0 ? ' is-sun' : idx === 6 ? ' is-sat' : '';
                barRow.innerHTML = `
                    <span class="weekday-bar-row__name${dayClass}">${weekdayNames[idx]}</span>
                    <span class="weekday-bar-row__track"><div style="width: ${ratio}%"></div></span>
                    <span class="weekday-bar-row__value">${ratio}%<small>평균 ${Math.round(avgSales / 10000).toLocaleString()}만</small></span>
                `;
                weekdayWrap.appendChild(barRow);
            });
        }
    }

    /* ---------------- 품목 시즌 비교 (통계 분석) ---------------- */
    const seasonSelect = document.getElementById('seasonItemSelect');
    const seasonTable = document.getElementById('seasonTable');
    const seasonSummary = document.getElementById('seasonSummary');
    let seasonLoaded = false;
    let seasonSeq = 0;

    seasonSelect?.addEventListener('change', () => loadItemSeasons(seasonSelect.value));

    async function loadItemSeasons(item) {
        if (!seasonTable) return;
        const seq = ++seasonSeq;
        seasonLoaded = true;
        seasonSummary.textContent = '시즌 자료를 불러오는 중...';
        try {
            const data = await api.itemSeasons(item);
            if (seq === seasonSeq) renderItemSeasons(data);
        } catch (err) {
            if (seq === seasonSeq) seasonSummary.textContent = `시즌 자료를 불러오지 못했어요. (${err.message})`;
        }
    }

    function formatMonths(list) {
        return list.map((month) => `${month}월`).join('·');
    }

    function describeSeason({ item, years, currentMonth, months, peakMonths }) {
        if (peakMonths.length === 0) return `${item}의 최근 3년 월별 매출이에요.`;
        const [previousYear, thisYear] = years.slice(-2);
        const sumOf = (year, list) => list.reduce((sum, month) => sum + (months[year]?.[month - 1] || 0), 0);
        const parts = [`${item}은(는) ${formatMonths(peakMonths)}에 매출이 많아요.`];
        const passed = peakMonths.filter((month) => month <= currentMonth);
        if (passed.length > 0) {
            const thisSum = sumOf(thisYear, passed);
            const previousSum = sumOf(previousYear, passed);
            if (previousSum > 0) {
                const rate = Math.round(((thisSum - previousSum) / previousSum) * 100);
                const inProgress = passed.includes(currentMonth) ? ' (이번 달은 오늘까지)' : '';
                parts.push(`올해 ${formatMonths(passed)} 매출은 작년 같은 달보다 ${rate >= 0 ? '+' : ''}${rate}%예요${inProgress}.`);
            }
        }
        const upcoming = peakMonths.filter((month) => month > currentMonth);
        if (upcoming.length > 0) {
            parts.push(`다가오는 성수기 ${formatMonths(upcoming)}에 작년에는 ${formatCompactWon(sumOf(previousYear, upcoming))}을 팔았어요.`);
        }
        return parts.join(' ');
    }

    function renderItemSeasons(data) {
        const { items, item, years, currentMonth, months, peakMonths, seasonTotals } = data;
        if (!item) {
            seasonSummary.textContent = '최근 3년 동안 품목 매출이 없어요.';
            seasonSelect.replaceChildren();
            seasonTable.replaceChildren();
            return;
        }
        seasonSelect.replaceChildren(...items.map((entry) => new Option(`${entry.name} · ${formatCompactWon(entry.sales)}`, entry.name, false, entry.name === item)));
        if (!items.some((entry) => entry.name === item)) seasonSelect.prepend(new Option(item, item, true, true));

        const thisYear = years[years.length - 1];
        const max = Math.max(1, ...years.flatMap((year) => months[year]));
        const shortWon = (value) => formatCompactWon(value).replace(/원$/, '');

        const thead = document.createElement('thead');
        const headRow = thead.insertRow();
        const corner = document.createElement('th');
        corner.textContent = '연도';
        headRow.append(corner);
        for (let month = 1; month <= 12; month += 1) {
            const th = document.createElement('th');
            th.textContent = `${month}월`;
            if (peakMonths.includes(month)) th.className = 'is-peak';
            headRow.append(th);
        }
        const totalHead = document.createElement('th');
        totalHead.textContent = '성수기 합계';
        headRow.append(totalHead);

        const tbody = document.createElement('tbody');
        years.forEach((year) => {
            const row = tbody.insertRow();
            const yearCell = document.createElement('th');
            yearCell.scope = 'row';
            yearCell.textContent = String(year);
            row.append(yearCell);
            months[year].forEach((value, index) => {
                const cell = row.insertCell();
                const future = year === thisYear && index + 1 > currentMonth;
                cell.textContent = future ? '·' : value > 0 ? shortWon(value) : '-';
                if (!future && value > 0) cell.style.setProperty('--heat', (value / max).toFixed(3));
                if (peakMonths.includes(index + 1)) cell.classList.add('is-peak');
                if (future) cell.classList.add('is-future');
            });
            const total = row.insertCell();
            total.className = 'season-total';
            total.textContent = formatCompactWon(seasonTotals[year] || 0);
        });
        seasonTable.replaceChildren(thead, tbody);
        seasonSummary.textContent = describeSeason(data);
    }

    async function loadTotalRangeData() {
        const startStr = totalStartDate.value;
        const endStr = totalEndDate.value;
        if (!startStr || !endStr) { await window.showAlert("시작일과 종료일을 올바르게 선택해 주세요."); return; }
        
        if (parseDateKey(startStr) > parseDateKey(endStr)) { await window.showAlert("시작일이 종료일보다 늦을 수 없습니다."); return; }

        updateAppBar();
        const seq = ++rangeLoadSeq;
        try {
            setEmptyTableMessage(totalTableBody, 11, '기간 데이터를 종합 분석 중...');

            // 아직 오지 않은 날짜는 비교에서 뺀다. (빈 날이 섞이면 늘 줄어든 것처럼 보인다)
            const today = getKstToday();
            const compareEnd = endStr > today && startStr <= today ? today : endStr;
            const previousRange = getPreviousRange(startStr, compareEnd);
            const lastYearRange = { startStr: shiftYearKey(startStr), endStr: shiftYearKey(compareEnd) };
            const [{ summaryRows, prevSummaryRows, transactions, previousTransactions }, lastYearRows] = await Promise.all([
                fetchPeriodBundle(startStr, endStr, previousRange.startStr, previousRange.endStr),
                fetchDailySalesSummary(lastYearRange.startStr, lastYearRange.endStr)
            ]);
            if (seq !== rangeLoadSeq) return;

            const dailySummary = buildDailySummaryFromView(startStr, endStr, summaryRows);
            const summary = summarizeDailyMap(dailySummary);
            const compareSummary = summarizeDailyMap(pickDailyRange(dailySummary, startStr, compareEnd));
            const prevSummary = summarizeDailyMap(buildDailySummaryFromView(previousRange.startStr, previousRange.endStr, prevSummaryRows));
            const lastYearSummary = summarizeDailyMap(buildDailySummaryFromView(lastYearRange.startStr, lastYearRange.endStr, lastYearRows));
            const periodComparison = { label: '직전 같은 길이 기간', ...compareTotals(compareSummary, prevSummary) };
            const yearComparison = { label: '전년 같은 기간', ...compareTotals(compareSummary, lastYearSummary) };
            const weekdaySummary = summarizeWeekdayPerformance(dailySummary, transactions);
            const descriptionSummary = summarizeDescriptions(transactions, {
                previousTransactions,
                comparisonLabel: '직전 기간 대비'
            });

            totalTableBody.innerHTML = '';
            let accCount = 0, accCash = 0, accExpense = 0, accCard = 0, accTotal = 0, accNet = 0;

            Object.keys(dailySummary).sort().forEach(d => {
                const dayData = dailySummary[d];
                accCount += dayData.count; accCash += dayData.cash; accExpense += dayData.expense; accCard += dayData.card; accTotal += dayData.total; accNet += dayData.net;

                const row = document.createElement('tr');
                // 월간 표와 같이 날짜를 누르면 그날의 건별 내역을 보여준다.
                row.classList.add('clickable-row');
                if (dayData.total === 0) row.style.opacity = '0.5';

                const dayName = getDayName(d);
                const formattedDate = `${d} (${dayName})`;

                row.innerHTML = `
                    <td>${formattedDate}</td>
                    <td>${dayData.count.toLocaleString()}</td>
                    <td style="font-weight:700; color:var(--text-main);">${accCount.toLocaleString()}</td>
                    <td>${dayData.cash.toLocaleString()}</td>
                    <td style="color:var(--secondary); font-weight:700;">${accCash.toLocaleString()}</td>
                    <td style="color:var(--danger);">${dayData.expense.toLocaleString()}</td>
                    <td style="color:var(--danger); font-weight:700;">${accExpense.toLocaleString()}</td>
                    <td>${dayData.card.toLocaleString()}</td>
                    <td style="color:#f59e0b; font-weight:700;">${accCard.toLocaleString()}</td>
                    <td style="font-weight:700; color:var(--primary);">${dayData.total.toLocaleString()}</td>
                    <td style="font-weight:700; color:var(--text-main);">${dayData.net.toLocaleString()}</td>
                `;
                row.addEventListener('click', () => showDayDetailPopup(d));
                totalTableBody.appendChild(row);
            });

            setText('rangeTotalSales', summary.total.toLocaleString());
            setText('rangeTotalCash', summary.cash.toLocaleString());
            setText('rangeTotalCard', summary.card.toLocaleString());
            setText('rangeTotalExpense', summary.expense.toLocaleString());
            setText('rangeNetSales', summary.net.toLocaleString());
            setText('rangeTotalCount', summary.count.toLocaleString());

            setText('rangeAvgSales', summary.averageSales.toLocaleString() + " 원");
            setText('rangeAvgTicket', summary.averageTicket.toLocaleString() + " 원");
            setTrendValue('rangeCompareSales', yearComparison);
            setText('rangeMaxSalesDay', summary.maxSales > 0 ? `${summary.maxSalesDay} (${summary.maxSales.toLocaleString()}원)` : '-');
            setText('rangeCashRatio', formatPercent(summary.cashRatio));
            setText('rangeOperatingDays', `${summary.operatingDays.toLocaleString()}일`);
            setText('rangeChartMeta', `${summary.operatingDays.toLocaleString()}영업일 · 전년 동기 ${formatComparisonText(yearComparison)}`);
            setText('rangeDetailMeta', `${summary.operatingDays.toLocaleString()}영업일 · ${formatWon(summary.total)}`);
            renderComparePanel('rangeCompareList', [
                { label: '선택 기간', start: startStr, end: compareEnd, summary: compareSummary, kind: 'current' },
                { label: periodComparison.label, start: previousRange.startStr, end: previousRange.endStr, summary: prevSummary, comparison: periodComparison },
                { label: yearComparison.label, start: lastYearRange.startStr, end: lastYearRange.endStr, summary: lastYearSummary, comparison: yearComparison }
            ], '선택 기간');
            renderWeekdaySignals('rangeWeekdaySignals', weekdaySummary);
            renderDescriptionRanking('rangeDescriptionRanking', descriptionSummary);
            renderInsightList('rangeInsightList', createInsightMessages(summary, [yearComparison, periodComparison], {
                weekday: weekdaySummary,
                descriptions: descriptionSummary
            }));

            // 신규 시각화 함수 연동 파이프라인 배치
            const chartFold = document.getElementById('rangeChartFold');
            if (chartFold) chartFold.open = true;
            renderFlowAnalysis(analyzeSalesFlow(dailySummary));
            await renderAdvancedAnalytics(dailySummary);

        } catch (err) {
            if (seq !== rangeLoadSeq) return;
            console.error(err);
            setText('rangeChartMeta', '조회 실패');
            setText('rangeDetailMeta', '조회 실패');
            setEmptyTableMessage(totalTableBody, 11, `데이터 로드 중 에러가 발생했습니다. (${err.message})`, { tone: 'danger' });
        }
    }

    // 엑셀 라이브러리(약 1MB)는 다운로드 버튼을 누를 때만 받아온다.
    let xlsxLibraryPromise = null;
    function loadXlsxLibrary() {
        xlsxLibraryPromise ||= import('xlsx-js-style').then((module) => module.default || module);
        return xlsxLibraryPromise;
    }

    // 서식(스타일) 세팅 및 엑셀 빌드 핵심 핸들러
    async function downloadStyledExcel(tableId, labelStr) {
        if (!isSuperAdmin()) {
            window.showAlert('엑셀 백업은 관리자만 실행할 수 있습니다.');
            return;
        }

        let XLSX;
        try {
            XLSX = await loadXlsxLibrary();
        } catch (err) {
            console.error(err);
            xlsxLibraryPromise = null;
            window.showAlert('엑셀 다운로드를 위한 라이브러리가 로드되지 않았습니다. 페이지를 새로고침 해주세요.');
            return;
        }

        const table = document.getElementById(tableId);
        if (!table) return;

        const wsData = [];
        const columnCount = table.querySelector('thead tr')?.cells.length || 8;
        const rows = table.querySelectorAll('tr');
        const exportedRowCount = Math.max(rows.length - 1, 0);

        wsData.push(['DailyDash 매출보고서']);
        wsData.push([`조회 대상/기간: ${labelStr}`]);
        wsData.push([`백업 생성: ${formatKstDateTime()} · ${APP_VERSION_LABEL}`]);
        wsData.push([`생성 계정: ${currentUserEmail || '계정 정보 없음'}`]);
        wsData.push([`원본 화면: ${tableId} · 내보낸 행: ${exportedRowCount.toLocaleString()}건`]);
        wsData.push([]); 

        const tableHeaderRowIndex = wsData.length;
        rows.forEach(row => {
            const rowData = [];
            const cells = row.querySelectorAll('th, td');
            cells.forEach(cell => {
                rowData.push(cell.innerText);
            });
            wsData.push(rowData);
        });

        const ws = XLSX.utils.aoa_to_sheet(wsData);

        ws['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: columnCount - 1 } },
            { s: { r: 1, c: 0 }, e: { r: 1, c: columnCount - 1 } },
            { s: { r: 2, c: 0 }, e: { r: 2, c: columnCount - 1 } },
            { s: { r: 3, c: 0 }, e: { r: 3, c: columnCount - 1 } },
            { s: { r: 4, c: 0 }, e: { r: 4, c: columnCount - 1 } }
        ];

        for (let cellRef in ws) {
            if (cellRef[0] === '!') continue;
            const cell = ws[cellRef];
            const parsed = XLSX.utils.decode_cell(cellRef);
            const row = parsed.r;
            const col = parsed.c;

            cell.s = {
                font: { name: 'Malgun Gothic', size: 10 },
                alignment: { vertical: 'center', horizontal: 'center' },
                border: {
                    top: { style: 'thin', color: { rgb: '94A3B8' } },
                    bottom: { style: 'thin', color: { rgb: '94A3B8' } },
                    left: { style: 'thin', color: { rgb: '94A3B8' } },
                    right: { style: 'thin', color: { rgb: '94A3B8' } }
                }
            };

            if (row === 0) {
                cell.s.font = { name: 'Malgun Gothic', size: 22, bold: true, color: { rgb: '1E293B' } };
                cell.s.alignment = { horizontal: 'center', vertical: 'center' };
                delete cell.s.border;
            } else if (row > 0 && row < tableHeaderRowIndex) {
                cell.s.font = { name: 'Malgun Gothic', size: 11, color: { rgb: '64748B' } };
                cell.s.alignment = { horizontal: 'right', vertical: 'center' };
                delete cell.s.border;
            } else if (row === tableHeaderRowIndex) {
                cell.s.font = { name: 'Malgun Gothic', size: 11, bold: true, color: { rgb: 'FFFFFF' } };
                cell.s.fill = { fgColor: { rgb: '6366F1' } }; 
                cell.s.alignment = { horizontal: 'center', vertical: 'center' };
                cell.s.border = {
                    top: { style: 'thin', color: { rgb: '4F46E5' } },
                    bottom: { style: 'medium', color: { rgb: '4F46E5' } },
                    left: { style: 'thin', color: { rgb: 'CBD5E1' } },
                    right: { style: 'thin', color: { rgb: 'CBD5E1' } }
                };
            } else {
                if (col > 0) {
                    cell.s.alignment = { horizontal: 'right', vertical: 'center' };
                    if (typeof cell.v === 'string') {
                        const cleanStr = cell.v.replace(/[^0-9-]/g, '');
                        const numVal = parseInt(cleanStr);
                        if (!isNaN(numVal) && cleanStr !== '') {
                            cell.v = numVal;
                            cell.t = 'n';
                            cell.z = '#,##0'; 
                        }
                    }
                } else {
                    cell.s.alignment = { horizontal: 'center', vertical: 'center' };
                }
            }
        }

        ws['!rows'] = [
            { hpt: 36 }, 
            { hpt: 22 }, 
            { hpt: 20 },
            { hpt: 20 },
            { hpt: 20 },
            { hpt: 12 }, 
            { hpt: 26 }  
        ];

        ws['!cols'] = Array.from({ length: columnCount }, (_, index) => ({ wch: index === 0 ? 18 : 14 }));

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "매출보고서");
        XLSX.writeFile(wb, `DailyDash_매출보고서_${sanitizeFilePart(labelStr)}_${getBackupTimestamp()}.xlsx`);
        api.logExport(labelStr, [
            `${tableId}`,
            `${exportedRowCount.toLocaleString()}건`,
            APP_VERSION_LABEL
        ]).catch((err) => console.warn('엑셀 백업 이력 기록 실패', err));
        showToast('엑셀 파일을 내려받았습니다.');
    }

    init();
});

window.logout = async () => {
    if (await window.showConfirm('로그아웃 할까요?', { danger: false, confirmLabel: '로그아웃', icon: 'logout' })) {
        await api.logout().catch(() => {});
        try {
            localStorage.removeItem('dailydash-last-user');
        } catch {
            /* 무시 */
        }
        window.location.replace('login.html');
    }
};
