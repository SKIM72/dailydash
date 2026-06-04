import '../style.css';
import { createSupabaseClient } from './services/supabaseClient.js';
import { installModalHandlers } from './shared/modal.js';
import { appendCell, setText } from './shared/dom.js';
import { formatCommas, formatPercent, formatWon, parseCommas } from './shared/format.js';
import { formatDateKey, getDayName, getKstToday, getPreviousMonth, parseDateKey } from './shared/date.js';
import {
    buildDailySummaryFromView,
    compareTotals,
    createInsightMessages,
    summarizeDailyMap,
    summarizeDescriptions,
    summarizeWeekdayPerformance
} from './features/analytics.js';
import { installThemeControls } from './shared/theme.js';

installModalHandlers();
installThemeControls();

document.addEventListener('DOMContentLoaded', () => {

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            const isLocalPreview = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
            if (isLocalPreview) {
                navigator.serviceWorker.getRegistrations?.().then((registrations) => {
                    registrations.forEach((registration) => registration.unregister());
                });
                window.caches?.keys?.().then((keys) => {
                    keys.filter((key) => key.startsWith('dailydash')).forEach((key) => caches.delete(key));
                });
                return;
            }
            navigator.serviceWorker.register('sw.js').then(reg => console.log('PWA OK:', reg.scope), err => console.log('PWA Fail:', err));
        });
    }
    
    const supabase = createSupabaseClient();

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
    const tabMonthly = document.getElementById('tabMonthly');
    const tabTotal = document.getElementById('tabTotal');
    
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

    const myPageBtn = document.getElementById('myPageBtn');
    const myPageModal = document.getElementById('myPageModal');
    const closeMyPage = document.getElementById('closeMyPage');
    const loggedInEmail = document.getElementById('loggedInEmail');
    const superUserPanel = document.getElementById('superUserPanel');
    const approvalListBody = document.getElementById('approvalListBody');

    const downloadExcelBtn = document.getElementById('downloadExcelBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    // 전역 차트 인스턴스 핸들 객체 (중복 생성 방지용)
    let trendChartInstance = null;

    if (!datePicker || !tabDaily || !tableBody) return;

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

    // 커스텀 요일 표기 디스플레이 유틸리티
    function updateDateDisplay(dateStr) {
        if (!dateStr) return;
        const dayName = getDayName(dateStr);
        document.getElementById('dateDisplay').textContent = `${dateStr} (${dayName})`;
    }

    function updateMonthDisplay(monthStr) {
        if (!monthStr) return;
        const parts = monthStr.split('-');
        document.getElementById('monthDisplay').textContent = `${parts[0]}년 ${parts[1]}월`;
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

    async function fetchDailySalesSummary(startStr, endStr) {
        const { data, error } = await supabase
            .from('v_daily_sales_summary')
            .select('transaction_date, row_count, total_people, total_cash, total_card, total_expense, total_sales, net_sales, average_ticket')
            .gte('transaction_date', startStr)
            .lte('transaction_date', endStr)
            .order('transaction_date', { ascending: true });

        if (error) throw error;
        return data || [];
    }

    async function fetchTransactionsForRange(startStr, endStr) {
        const { data, error } = await supabase
            .from('transactions')
            .select('transaction_date, description, customer_count, cash_income, cash_expense, card_income')
            .gte('transaction_date', startStr)
            .lte('transaction_date', endStr)
            .is('deleted_at', null)
            .order('transaction_date', { ascending: true })
            .range(0, 4999);

        if (error) throw error;
        return data || [];
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
            meta.textContent = `${item.people.toLocaleString()}명 · ${item.rowCount.toLocaleString()}건 · 비중 ${Math.round(item.ratio).toLocaleString()}%`;

            const bar = document.createElement('div');
            bar.className = 'ranking-bar';

            const fill = document.createElement('div');
            fill.style.width = `${Math.max(6, Math.round((item.total / maxTotal) * 100))}%`;
            bar.appendChild(fill);

            row.append(head, meta, bar);
            container.appendChild(row);
        });
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
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return; 

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
            updateDateDisplay(datePicker.value);
            loadDailyData(datePicker.value);
        });
        monthPicker.addEventListener('change', () => {
            updateMonthDisplay(monthPicker.value);
            loadMonthlyData(monthPicker.value);
        });
        totalStartDate.addEventListener('change', () => updateGenericDateDisplay(totalStartDate, 'startDateDisplay', '시작일 선택'));
        totalEndDate.addEventListener('change', () => updateGenericDateDisplay(totalEndDate, 'endDateDisplay', '종료일 선택'));

        tabDaily.addEventListener('click', () => switchTab('daily'));
        tabMonthly.addEventListener('click', () => switchTab('monthly'));
        if(tabTotal) tabTotal.addEventListener('click', () => switchTab('total'));

        if (loadTotalBtn) loadTotalBtn.addEventListener('click', () => loadTotalRangeData());
        if (downloadExcelBtn) downloadExcelBtn.addEventListener('click', () => downloadStyledExcel('monthlyTable', monthPicker.value));
        if (downloadTotalExcelBtn) downloadTotalExcelBtn.addEventListener('click', () => downloadStyledExcel('totalRangeTable', `${totalStartDate.value}_to_${totalEndDate.value}`));
        if (logoutBtn) logoutBtn.addEventListener('click', () => window.logout());

        if (myPageBtn && myPageModal && closeMyPage) {
            myPageBtn.addEventListener('click', () => {
                loggedInEmail.textContent = session.user.email;
                myPageModal.classList.remove('hidden-view');
                if (session.user.email === 'eowert72@gmail.com') {
                    superUserPanel.classList.remove('hidden-view');
                    loadApprovalList();
                } else {
                    superUserPanel.classList.add('hidden-view');
                }
            });
            closeMyPage.addEventListener('click', () => myPageModal.classList.add('hidden-view'));
        }

        // 모달 닫기 바인딩 연동 추가
        const closeDetailModal = document.getElementById('closeDetailModal');
        if(closeDetailModal) {
            closeDetailModal.addEventListener('click', () => {
                document.getElementById('dailyDetailModal').classList.add('hidden-view');
            });
        }

        loadDailyData(today);
    }

    async function loadApprovalList() {
        if (!approvalListBody) return;
        approvalListBody.innerHTML = '<tr><td colspan="2" class="empty-msg"><i class="fas fa-spinner fa-spin"></i> 대기 명단 구성 중...</td></tr>';
        const { data: list, error } = await supabase.from('user_approvals').select('*').eq('is_approved', false).order('created_at', { ascending: true });
        if (error) {
            approvalListBody.innerHTML = '<tr><td colspan="2" class="empty-msg" style="color:var(--danger);">데이터를 로드하지 못했습니다.</td></tr>';
            return;
        }
        if (!list || list.length === 0) {
            approvalListBody.innerHTML = '<tr><td colspan="2" class="empty-msg" style="padding: 20px !important;">대기 중인 신청 계정이 없습니다.</td></tr>';
            return;
        }
        approvalListBody.innerHTML = '';
        list.forEach(item => {
            const row = document.createElement('tr');
            appendCell(row, item.email, 'padding: 12px; font-weight: 500; text-align:left;');
            const actionCell = appendCell(row, '', 'padding: 12px; text-align: center;');
            const approveBtn = document.createElement('button');
            approveBtn.className = 'btn-approve';
            approveBtn.innerHTML = '<i class="fas fa-user-check"></i> 가입 승인';
            approveBtn.addEventListener('click', () => window.approveUser(item.email));
            actionCell.appendChild(approveBtn);
            approvalListBody.appendChild(row);
        });
    }

    window.approveUser = async (targetEmail) => {
        if (!(await window.showConfirm(`${targetEmail} 계정의 DailyDash 접속 권한을 승인하시겠습니까?`))) return;
        const { error } = await supabase.from('user_approvals').update({ is_approved: true }).eq('email', targetEmail);
        if (error) { await window.showAlert("승인 처리 중 오류 발생: " + error.message); } 
        else { await window.showAlert(`${targetEmail} 계정의 정산 장부 접근 승인이 완료되었습니다.`); loadApprovalList(); }
    };

    async function loadDailyData(date) {
        try {
            tableBody.innerHTML = '<tr><td colspan="9" class="empty-msg"><i class="fas fa-spinner fa-spin"></i> 데이터를 불러오는 중...</td></tr>';
            const { data: transactions, error: txError } = await supabase.from('transactions').select('*').eq('transaction_date', date).is('deleted_at', null).order('created_at', { ascending: true });
            if (txError) throw txError;

            const { data: note, error: noteError } = await supabase.from('daily_notes').select('special_note').eq('note_date', date).single();
            if (noteError && noteError.code !== 'PGRST116') throw noteError;

            renderDailyTable(transactions || []);
            noteInput.value = note ? note.special_note : '';
        } catch (err) {
            console.error(err);
            tableBody.innerHTML = `<tr><td colspan="9" class="empty-msg" style="color: var(--danger);"><i class="fas fa-exclamation-circle"></i> 로드 실패 (${err.message})</td></tr>`;
        }
    }

    function renderDailyTable(transactions) {
        if (transactions.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="9" class="empty-msg">아직 입력된 내역이 없습니다.</td></tr>';
            updateDailyTotals(0, 0, 0, 0);
            return;
        }
        tableBody.innerHTML = '';
        let tCount = 0, tCashIn = 0, tCashOut = 0, tCardIn = 0;
        transactions.forEach((tx, index) => {
            tCount += tx.customer_count || 0;
            tCashIn += tx.cash_income || 0;
            tCashOut += tx.cash_expense || 0;
            tCardIn += tx.card_income || 0;

            const row = document.createElement('tr');
            appendCell(row, index + 1);
            appendCell(row, tx.description || '', 'font-weight: 500;');
            appendCell(row, (tx.customer_count || 0).toLocaleString());
            appendCell(row, (tx.cash_income || 0).toLocaleString());
            appendCell(row, (tx.cash_expense || 0).toLocaleString());
            appendCell(row, (tx.card_income || 0).toLocaleString());
            appendCell(row, tx.remark1 || '', 'color: var(--text-muted);');
            appendCell(row, tx.remark2 || '', 'color: var(--text-muted);');
            const actionCell = appendCell(row, '');
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-danger';
            deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i> 삭제';
            deleteBtn.addEventListener('click', () => window.deleteTransaction(tx.id));
            actionCell.appendChild(deleteBtn);
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

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const date = datePicker.value;
        const originalButtonHtml = submitTransactionBtn?.innerHTML;
        const newTx = {
            transaction_date: date,
            description: document.getElementById('desc').value,
            customer_count: parseCommas(document.getElementById('count').value),
            cash_income: parseCommas(document.getElementById('cashIn').value),
            cash_expense: parseCommas(document.getElementById('cashOut').value),
            card_income: parseCommas(document.getElementById('cardIn').value),
            remark1: document.getElementById('remark1').value,
            remark2: document.getElementById('remark2').value
        };

        if (submitTransactionBtn) {
            submitTransactionBtn.disabled = true;
            submitTransactionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 저장 중...';
        }

        try {
            const { error } = await supabase.from('transactions').insert([newTx]);
            if (error) throw error;

            form.reset();
            ['count','cashIn','cardIn','cashOut'].forEach(id => document.getElementById(id).value = '');
            updateEntryPreview();
            await loadDailyData(date);
            await window.showAlert("입력이 완료되었습니다.");
            document.getElementById('desc')?.focus();
        } catch (error) {
            await window.showAlert("저장 실패: " + error.message);
        } finally {
            if (submitTransactionBtn) {
                submitTransactionBtn.disabled = false;
                submitTransactionBtn.innerHTML = originalButtonHtml || '<i class="fas fa-check"></i> 입력하기';
            }
        }
    });

    window.deleteTransaction = async (id) => {
        if(!(await window.showConfirm("이 내역을 삭제하시겠습니까?"))) return;
        const { error } = await supabase.from('transactions').update({ deleted_at: new Date().toISOString() }).eq('id', id);
        if(!error) { loadDailyData(datePicker.value); } 
        else { await window.showAlert("삭제 실패: " + error.message); }
    };

    saveNoteBtn.addEventListener('click', async () => {
        const { error } = await supabase.from('daily_notes').upsert({ note_date: datePicker.value, special_note: noteInput.value });
        if(!error) await window.showAlert("특기사항이 저장되었습니다.");
        else await window.showAlert("저장 실패: " + error.message);
    });

    function switchTab(tabName) {
        tabDaily.classList.remove('active'); tabMonthly.classList.remove('active'); if(tabTotal) tabTotal.classList.remove('active');
        viewDaily.style.display = 'none'; viewMonthly.style.display = 'none'; if(viewTotal) viewTotal.style.display = 'none';

        if (tabName === 'daily') {
            tabDaily.classList.add('active'); viewDaily.style.display = 'flex'; loadDailyData(datePicker.value);
        } else if (tabName === 'monthly') {
            tabMonthly.classList.add('active'); viewMonthly.style.display = 'flex'; loadMonthlyData(monthPicker.value);
        } else if (tabName === 'total') {
            tabTotal.classList.add('active'); viewTotal.style.display = 'flex'; loadTotalRangeData();
        }
    }

    // 요구사항 1번: 월간 상세 현황 데이터 로드 및 모달 상세창 바인딩 로직 구현
    async function showDayDetailPopup(dateStr) {
        const modal = document.getElementById('dailyDetailModal');
        const titleDate = document.getElementById('detailModalTitleDate');
        const modalTableBody = document.getElementById('detailModalTableBody');
        
        if(!modal || !modalTableBody) return;
        
        titleDate.textContent = dateStr;
        modalTableBody.innerHTML = '<tr><td colspan="8" class="empty-msg"><i class="fas fa-spinner fa-spin"></i> 해당 일자 세부 건별 명세 조회 중...</td></tr>';
        modal.classList.remove('hidden-view');
        
        try {
            const { data: list, error } = await supabase
                .from('transactions')
                .select('*')
                .eq('transaction_date', dateStr)
                .is('deleted_at', null)
                .order('created_at', { ascending: true });
                
            if(error) throw error;
            
            if(!list || list.length === 0) {
                modalTableBody.innerHTML = '<tr><td colspan="8" class="empty-msg">해당 일자에는 등록된 상세 판매 내역이 없습니다.</td></tr>';
                return;
            }
            
            modalTableBody.innerHTML = '';
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
            modalTableBody.innerHTML = `<tr><td colspan="8" class="empty-msg" style="color: var(--danger);">명세 로드 실패 (${err.message})</td></tr>`;
        }
    }

    async function loadMonthlyData(monthStr) {
        try {
            monthlyTableBody.innerHTML = '<tr><td colspan="11" class="empty-msg"><i class="fas fa-spinner fa-spin"></i> 데이터를 분석하는 중...</td></tr>';
            const startDate = `${monthStr}-01`;
            const lastDay = new Date(monthStr.split('-')[0], monthStr.split('-')[1], 0).getDate();
            const endDate = `${monthStr}-${String(lastDay).padStart(2, '0')}`;

            const summaryRows = await fetchDailySalesSummary(startDate, endDate);
            const dailySummary = buildDailySummaryFromView(startDate, endDate, summaryRows);
            const summary = summarizeDailyMap(dailySummary);

            const prevMonth = getPreviousMonth(monthStr);
            const prevLastDay = new Date(prevMonth.split('-')[0], prevMonth.split('-')[1], 0).getDate();
            const prevStartDate = `${prevMonth}-01`;
            const prevEndDate = `${prevMonth}-${String(prevLastDay).padStart(2, '0')}`;
            const prevSummaryRows = await fetchDailySalesSummary(prevStartDate, prevEndDate);
            const prevSummary = summarizeDailyMap(buildDailySummaryFromView(prevStartDate, prevEndDate, prevSummaryRows));
            const comparison = compareTotals(summary, prevSummary);
            const transactions = await fetchTransactionsForRange(startDate, endDate);
            const weekdaySummary = summarizeWeekdayPerformance(dailySummary);
            const descriptionSummary = summarizeDescriptions(transactions);

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
            setTrendValue('monthCompareSales', comparison);
            setText('monthMaxSalesDay', summary.maxSales > 0 ? `${summary.maxSalesDay.substring(5)}일 (${summary.maxSales.toLocaleString()}원)` : '-');
            setText('monthCashRatio', formatPercent(summary.cashRatio));
            setText('monthOperatingDays', `${summary.operatingDays.toLocaleString()}일`);
            setText('monthlyDetailMeta', `${summary.operatingDays.toLocaleString()}영업일 · ${formatWon(summary.total)}`);
            renderWeekdaySignals('monthWeekdaySignals', weekdaySummary);
            renderDescriptionRanking('monthDescriptionRanking', descriptionSummary);
            renderInsightList('monthInsightList', createInsightMessages(summary, comparison, {
                weekday: weekdaySummary,
                descriptions: descriptionSummary
            }));

        } catch (err) {
            console.error(err);
            setText('monthlyDetailMeta', '조회 실패');
            monthlyTableBody.innerHTML = `<tr><td colspan="11" class="empty-msg" style="color: var(--danger);">통계 데이터를 불러오지 못했습니다.</td></tr>`;
        }
    }

    // 요구사항 2번: 트렌디한 통계 분석 처리를 위한 종합 시각화 및 요일 분석 엔진 탑재
    function renderAdvancedAnalytics(dailySummary) {
        const sortedDates = Object.keys(dailySummary).sort();
        const labels = sortedDates.map(d => d.substring(5)); // 'MM-DD' 포맷팅
        
        const cashData = [];
        const cardData = [];
        const expenseData = [];
        const customerData = [];
        
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
            
            // 요일 정보 추출하여 가산
            const dayIndex = parseDateKey(d).getDay();
            weekdaySales[dayIndex] += data.total;
            if (data.count > 0 || data.total > 0 || data.expense > 0) weekdayOpenDays[dayIndex]++;
            totalSalesAccum += data.total;
        });

        // 1) 복합 다차원 추이 그래프 시각화 빌드 (Chart.js 제어)
        const ctx = document.getElementById('totalTrendChart');
        if (ctx) {
            if (trendChartInstance) {
                trendChartInstance.destroy(); // 기존 차트 자원 반환 및 초기화
            }
            
            trendChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: '현금 수입',
                            data: cashData,
                            backgroundColor: '#10b981',
                            stack: 'combinedSales'
                        },
                        {
                            label: '카드 수입',
                            data: cardData,
                            backgroundColor: '#f59e0b',
                            stack: 'combinedSales'
                        },
                        {
                            label: '현금 지출',
                            data: expenseData,
                            type: 'line',
                            borderColor: '#ef4444',
                            backgroundColor: '#ef4444',
                            borderDash: [5, 5],
                            borderWidth: 2,
                            pointRadius: 2,
                            fill: false
                        },
                        {
                            label: '방문 인원 (명)',
                            data: customerData,
                            type: 'line',
                            borderColor: '#6366f1',
                            borderWidth: 3,
                            pointBackgroundColor: '#4f46e5',
                            fill: false,
                            yAxisID: 'yPeopleAxis'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { stacked: true, grid: { display: false } },
                        y: {
                            stacked: true,
                            position: 'left',
                            title: { display: true, text: '매출액 (원)', font: { weight: 'bold' } },
                            ticks: { callback: value => value.toLocaleString() }
                        },
                        yPeopleAxis: {
                            position: 'right',
                            title: { display: true, text: '방문객 수 (명)', font: { weight: 'bold' } },
                            grid: { display: false },
                            ticks: { stepSize: 1 }
                        }
                    },
                    plugins: {
                        legend: { position: 'top', labels: { font: { family: 'Inter' } } }
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
                barRow.style.cssText = "display: flex; align-items: center; gap: 10px; font-size: 0.9rem;";
                
                // 오늘 요일 강조 인덱스 정의
                let colorHex = "#64748b";
                if(idx === 0) colorHex = "#ef4444"; // 일요일 빨강
                if(idx === 6) colorHex = "#3b82f6"; // 토요일 파랑
                
                barRow.innerHTML = `
                    <div style="width: 55px; font-weight: 600; color: ${colorHex};">${weekdayNames[idx]}</div>
                    <div style="flex: 1; background: var(--side-bg); height: 8px; border-radius: 4px; overflow: hidden; border: 1px solid var(--border);">
                        <div style="width: ${ratio}%; background: var(--primary); height: 100%; border-radius: 4px; transition: width 0.3s ease;"></div>
                    </div>
                    <div style="width: 130px; text-align: right; font-weight: 700; color: var(--text-main);">${ratio}% <span style="font-weight:normal; font-size:0.75rem; color:var(--text-muted);">평균 ${Math.round(avgSales/10000).toLocaleString()}만</span></div>
                `;
                weekdayWrap.appendChild(barRow);
            });
        }
    }

    async function loadTotalRangeData() {
        const startStr = totalStartDate.value;
        const endStr = totalEndDate.value;
        if (!startStr || !endStr) { await window.showAlert("시작일과 종료일을 올바르게 선택해 주세요."); return; }
        
        if (parseDateKey(startStr) > parseDateKey(endStr)) { await window.showAlert("시작일이 종료일보다 늦을 수 없습니다."); return; }

        try {
            totalTableBody.innerHTML = '<tr><td colspan="11" class="empty-msg"><i class="fas fa-spinner fa-spin"></i> 기간 데이터를 종합 분석 중...</td></tr>';

            const summaryRows = await fetchDailySalesSummary(startStr, endStr);
            const dailySummary = buildDailySummaryFromView(startStr, endStr, summaryRows);
            const summary = summarizeDailyMap(dailySummary);

            const previousRange = getPreviousRange(startStr, endStr);
            const prevSummaryRows = await fetchDailySalesSummary(previousRange.startStr, previousRange.endStr);
            const prevSummary = summarizeDailyMap(buildDailySummaryFromView(previousRange.startStr, previousRange.endStr, prevSummaryRows));
            const comparison = compareTotals(summary, prevSummary);
            const transactions = await fetchTransactionsForRange(startStr, endStr);
            const weekdaySummary = summarizeWeekdayPerformance(dailySummary);
            const descriptionSummary = summarizeDescriptions(transactions);

            totalTableBody.innerHTML = '';
            let accCount = 0, accCash = 0, accExpense = 0, accCard = 0, accTotal = 0, accNet = 0;

            Object.keys(dailySummary).sort().forEach(d => {
                const dayData = dailySummary[d];
                accCount += dayData.count; accCash += dayData.cash; accExpense += dayData.expense; accCard += dayData.card; accTotal += dayData.total; accNet += dayData.net;

                const row = document.createElement('tr');
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
            setTrendValue('rangeCompareSales', comparison);
            setText('rangeMaxSalesDay', summary.maxSales > 0 ? `${summary.maxSalesDay} (${summary.maxSales.toLocaleString()}원)` : '-');
            setText('rangeCashRatio', formatPercent(summary.cashRatio));
            setText('rangeOperatingDays', `${summary.operatingDays.toLocaleString()}일`);
            setText('rangeChartMeta', `${summary.operatingDays.toLocaleString()}영업일 · ${formatComparisonText(comparison)}`);
            setText('rangeDetailMeta', `${summary.operatingDays.toLocaleString()}영업일 · ${formatWon(summary.total)}`);
            renderWeekdaySignals('rangeWeekdaySignals', weekdaySummary);
            renderDescriptionRanking('rangeDescriptionRanking', descriptionSummary);
            renderInsightList('rangeInsightList', createInsightMessages(summary, comparison, {
                weekday: weekdaySummary,
                descriptions: descriptionSummary
            }));

            // 신규 시각화 함수 연동 파이프라인 배치
            const chartFold = document.getElementById('rangeChartFold');
            if (chartFold) chartFold.open = true;
            renderAdvancedAnalytics(dailySummary);

        } catch (err) {
            console.error(err);
            setText('rangeChartMeta', '조회 실패');
            setText('rangeDetailMeta', '조회 실패');
            totalTableBody.innerHTML = `<tr><td colspan="11" class="empty-msg" style="color: var(--danger);">데이터 로드 중 에러가 발생했습니다.</td></tr>`;
        }
    }

    // 서식(스타일) 세팅 및 엑셀 빌드 핵심 핸들러
    function downloadStyledExcel(tableId, labelStr) {
        if (typeof XLSX === 'undefined') {
            window.showAlert('엑셀 다운로드를 위한 라이브러리가 로드되지 않았습니다. 페이지를 새로고침 해주세요.');
            return;
        }

        const table = document.getElementById(tableId);
        if (!table) return;

        const wsData = [];
        const columnCount = table.querySelector('thead tr')?.cells.length || 8;
        
        wsData.push(['DailyDash 매출보고서']);
        wsData.push([`조회 대상/기간: ${labelStr}`]);
        wsData.push([]); 

        const rows = table.querySelectorAll('tr');
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
            { s: { r: 1, c: 0 }, e: { r: 1, c: columnCount - 1 } }
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
            } else if (row === 1) {
                cell.s.font = { name: 'Malgun Gothic', size: 11, color: { rgb: '64748B' } };
                cell.s.alignment = { horizontal: 'right', vertical: 'center' };
                delete cell.s.border;
            } else if (row === 2) {
                delete cell.s.border;
            } else if (row === 3) {
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
            { hpt: 12 }, 
            { hpt: 26 }  
        ];

        ws['!cols'] = Array.from({ length: columnCount }, (_, index) => ({ wch: index === 0 ? 18 : 14 }));

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "매출보고서");
        XLSX.writeFile(wb, `DailyDash_매출보고서_${labelStr}.xlsx`);
    }

    init();
});

window.logout = async () => {
    if (await window.showConfirm("로그아웃 하시겠습니까?")) {
        const sb = createSupabaseClient();
        await sb.auth.signOut();
        window.location.replace('login.html');
    }
};
