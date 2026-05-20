// 커스텀 알림/확인 모달 전역 핸들러 (Settle Up 구조 영구 보존)
window.showAlert = (message) => {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-alert-modal');
        const msgEl = document.getElementById('alert-message');
        const okBtn = document.getElementById('alert-ok-btn');
        if(!modal || !msgEl || !okBtn) { alert(message); resolve(); return; }
        msgEl.innerHTML = message.replace(/\n/g, '<br>');
        modal.classList.remove('hidden-view');
        const handleOk = () => {
            modal.classList.add('hidden-view');
            okBtn.removeEventListener('click', handleOk);
            resolve();
        };
        okBtn.addEventListener('click', handleOk);
    });
};

window.showConfirm = (message) => {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-confirm-modal');
        const msgEl = document.getElementById('confirm-message');
        const yesBtn = document.getElementById('confirm-yes-btn');
        const noBtn = document.getElementById('confirm-no-btn');
        if(!modal || !msgEl || !yesBtn || !noBtn) { resolve(confirm(message)); return; }
        msgEl.innerHTML = message.replace(/\n/g, '<br>');
        modal.classList.remove('hidden-view');
        const cleanUp = () => {
            modal.classList.add('hidden-view');
            yesBtn.removeEventListener('click', handleYes);
            noBtn.removeEventListener('click', handleNo);
        };
        const handleYes = () => { cleanUp(); resolve(true); };
        const handleNo = () => { cleanUp(); resolve(false); };
        yesBtn.addEventListener('click', handleYes);
        noBtn.addEventListener('click', handleNo);
    });
};

document.addEventListener('DOMContentLoaded', () => {

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/dailydash/sw.js').then(reg => console.log('PWA OK:', reg.scope), err => console.log('PWA Fail:', err));
        });
    }
    
    const SUPABASE_URL = 'https://lbwlodnguwuudbbaqmuz.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxid2xvZG5ndXd1dWRiYmFxbXV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMjg2NjQsImV4cCI6MjA5NDYwNDY2NH0.YJ3zbTthU2aGDCAfnk1GWeuI2nj4VM8qLAKXyaNITPQ';
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // DOM 요소 캐싱
    const datePicker = document.getElementById('currentDate');
    const form = document.getElementById('transactionForm');
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

    if (!datePicker || !tabDaily || !tableBody) return;

    // 세자리 세퍼레이터 및 초기 0 제거 텍스트 플레이스홀더 제어 엔진
    function formatCommas(val) {
        let num = String(val).replace(/[^0-9]/g, '');
        return num ? Number(num).toLocaleString() : '';
    }
    function parseCommas(val) {
        return parseInt(String(val).replace(/[^0-9]/g, '')) || 0;
    }

    ['count', 'cashIn', 'cardIn', 'cashOut'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', (e) => {
                e.target.value = formatCommas(e.target.value);
            });
        }
    });

    // 커스텀 요일 표기 디스플레이 유틸리티
    function updateDateDisplay(dateStr) {
        if (!dateStr) return;
        const days = ['일', '월', '화', '수', '목', '금', '토'];
        const d = new Date(dateStr);
        const dayName = days[d.getDay()];
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
        const days = ['일', '월', '화', '수', '목', '금', '토'];
        const d = new Date(inputEl.value);
        document.getElementById(displayId).textContent = `${inputEl.value} (${days[d.getDay()]})`;
    }

    // 3. 앱 초기화
    async function init() {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return; 

        if (session.user.email === 'eowert72@gmail.com') {
            const oneMonthAgo = new Date();
            oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
            await supabase.from('transactions').delete().lt('deleted_at', oneMonthAgo.toISOString());
        }

        // 한국/일본 시간(UTC+9) 기준으로 현재 날짜 구하기
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
        const kstTime = new Date(utc + (9 * 60 * 60 * 1000));
        const today = kstTime.getFullYear() + '-' + String(kstTime.getMonth() + 1).padStart(2, '0') + '-' + String(kstTime.getDate()).padStart(2, '0');
        
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
            row.innerHTML = `
                <td style="padding: 12px; font-weight: 500; text-align:left;">${item.email}</td>
                <td style="padding: 12px; text-align: center;">
                    <button onclick="approveUser('${item.email}')" class="btn-approve"><i class="fas fa-user-check"></i> 가입 승인</button>
                </td>
            `;
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
            row.innerHTML = `
                <td>${index + 1}</td>
                <td style="font-weight: 500;">${tx.description || ''}</td>
                <td>${(tx.customer_count || 0).toLocaleString()}</td>
                <td>${(tx.cash_income || 0).toLocaleString()}</td>
                <td>${(tx.cash_expense || 0).toLocaleString()}</td>
                <td>${(tx.card_income || 0).toLocaleString()}</td>
                <td style="color: var(--text-muted);">${tx.remark1 || ''}</td>
                <td style="color: var(--text-muted);">${tx.remark2 || ''}</td>
                <td><button onclick="deleteTransaction('${tx.id}')" class="btn-danger"><i class="fas fa-trash-alt"></i> 삭제</button></td>
            `;
            tableBody.appendChild(row);
        });
        updateDailyTotals(tCount, tCashIn, tCashOut, tCardIn);
    }

    function updateDailyTotals(count, cashIn, cashOut, cardIn) {
        elTotalCount.textContent = count.toLocaleString();
        elTotalCashIn.textContent = cashIn.toLocaleString();
        elTotalCashOut.textContent = cashOut.toLocaleString();
        elTotalCardIn.textContent = cardIn.toLocaleString();
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const date = datePicker.value;
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

        const { error } = await supabase.from('transactions').insert([newTx]);
        if (!error) {
            form.reset();
            ['count','cashIn','cardIn','cashOut'].forEach(id => document.getElementById(id).value = '');
            loadDailyData(date);
        } else { await window.showAlert("저장 실패: " + error.message); }
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

    async function loadMonthlyData(monthStr) {
        try {
            monthlyTableBody.innerHTML = '<tr><td colspan="8" class="empty-msg"><i class="fas fa-spinner fa-spin"></i> 데이터를 분석하는 중...</td></tr>';
            const startDate = `${monthStr}-01`;
            const lastDay = new Date(monthStr.split('-')[0], monthStr.split('-')[1], 0).getDate();
            const endDate = `${monthStr}-${lastDay}`;

            let allTxs = [];
            let fromIdx = 0;
            const limit = 1000;
            let hasMore = true;

            while (hasMore) {
                const { data: txs, error } = await supabase
                    .from('transactions')
                    .select('transaction_date, customer_count, cash_income, card_income')
                    .gte('transaction_date', startDate)
                    .lte('transaction_date', endDate)
                    .is('deleted_at', null)
                    .order('transaction_date', { ascending: true })
                    .range(fromIdx, fromIdx + limit - 1);

                if (error) throw error;
                if (txs && txs.length > 0) allTxs = allTxs.concat(txs);
                if (!txs || txs.length < limit) hasMore = false;
                else fromIdx += limit;
            }

            const dailySummary = {};
            for (let i = 1; i <= lastDay; i++) {
                const d = `${monthStr}-${String(i).padStart(2, '0')}`;
                dailySummary[d] = { count: 0, cash: 0, card: 0, total: 0 };
            }

            let maxSales = 0; let maxSalesDay = '-';

            allTxs.forEach(tx => {
                const d = tx.transaction_date;
                if (dailySummary[d]) {
                    dailySummary[d].count += (tx.customer_count || 0);
                    dailySummary[d].cash += (tx.cash_income || 0);
                    dailySummary[d].card += (tx.card_income || 0);
                    dailySummary[d].total += ((tx.cash_income || 0) + (tx.card_income || 0));
                }
            });

            monthlyTableBody.innerHTML = '';
            let accCount = 0, accCash = 0, accCard = 0, accTotal = 0;

            for (let i = 1; i <= lastDay; i++) {
                const d = `${monthStr}-${String(i).padStart(2, '0')}`;
                const dayData = dailySummary[d];
                
                accCount += dayData.count; accCash += dayData.cash; accCard += dayData.card; accTotal += dayData.total;
                if (dayData.total > maxSales) { maxSales = dayData.total; maxSalesDay = d; }

                const row = document.createElement('tr');
                if (dayData.total === 0) row.style.opacity = '0.5'; 

                // ✅ 요구사항 2번: 웹페이지 표기 날짜에 요일 추가 (예: 2026-05-18 월)
                const days = ['일', '월', '화', '수', '목', '금', '토'];
                const dayName = days[new Date(d).getDay()];
                const formattedDate = `${d} ${dayName}`;

                row.innerHTML = `
                    <td>${formattedDate}</td>
                    <td>${dayData.count.toLocaleString()}</td>
                    <td style="font-weight:700; color:var(--text-main);">${accCount.toLocaleString()}</td>
                    <td>${dayData.cash.toLocaleString()}</td>
                    <td style="color:var(--secondary); font-weight:700;">${accCash.toLocaleString()}</td>
                    <td>${dayData.card.toLocaleString()}</td>
                    <td style="color:#f59e0b; font-weight:700;">${accCard.toLocaleString()}</td>
                    <td style="font-weight:700; color:var(--primary);">${dayData.total.toLocaleString()}</td>
                `;
                monthlyTableBody.appendChild(row);
            }

            document.getElementById('monthTotalSales').textContent = accTotal.toLocaleString();
            document.getElementById('monthTotalCash').textContent = accCash.toLocaleString();
            document.getElementById('monthTotalCard').textContent = accCard.toLocaleString();
            document.getElementById('monthTotalCount').textContent = accCount.toLocaleString();

            document.getElementById('monthAvgSales').textContent = Math.round(accTotal / lastDay).toLocaleString() + " 원";
            document.getElementById('monthMaxSalesDay').textContent = maxSales > 0 ? `${maxSalesDay.substring(5)}일 (${maxSales.toLocaleString()}원)` : '-';
            document.getElementById('monthCashRatio').textContent = accTotal > 0 ? `${Math.round((accCash / accTotal) * 100)}%` : '0%';

        } catch (err) {
            console.error(err);
            monthlyTableBody.innerHTML = `<tr><td colspan="8" class="empty-msg" style="color: var(--danger);">통계 데이터를 불러오지 못했습니다.</td></tr>`;
        }
    }

    async function loadTotalRangeData() {
        const startStr = totalStartDate.value;
        const endStr = totalEndDate.value;
        if (!startStr || !endStr) { await window.showAlert("시작일과 종료일을 올바르게 선택해 주세요."); return; }
        
        if (new Date(startStr) > new Date(endStr)) { await window.showAlert("시작일이 종료일보다 늦을 수 없습니다."); return; }

        try {
            totalTableBody.innerHTML = '<tr><td colspan="8" class="empty-msg"><i class="fas fa-spinner fa-spin"></i> 기간 데이터를 종합 분석 중...</td></tr>';
            
            let allTxs = [];
            let fromIdx = 0;
            const limit = 1000;
            let hasMore = true;

            while (hasMore) {
                const { data: txs, error } = await supabase
                    .from('transactions')
                    .select('transaction_date, customer_count, cash_income, card_income')
                    .gte('transaction_date', startStr)
                    .lte('transaction_date', endStr)
                    .is('deleted_at', null)
                    .order('transaction_date', { ascending: true })
                    .range(fromIdx, fromIdx + limit - 1);

                if (error) throw error;
                if (txs && txs.length > 0) allTxs = allTxs.concat(txs);
                if (!txs || txs.length < limit) hasMore = false;
                else fromIdx += limit;
            }

            const start = new Date(startStr);
            const end = new Date(endStr);
            const dailySummary = {};
            let totalDaysCount = 0;

            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];
                dailySummary[dateStr] = { count: 0, cash: 0, card: 0, total: 0 };
                totalDaysCount++;
            }

            let maxSales = 0; let maxSalesDay = '-';

            allTxs.forEach(tx => {
                const d = tx.transaction_date;
                if (dailySummary[d]) {
                    dailySummary[d].count += (tx.customer_count || 0);
                    dailySummary[d].cash += (tx.cash_income || 0);
                    dailySummary[d].card += (tx.card_income || 0);
                    dailySummary[d].total += ((tx.cash_income || 0) + (tx.card_income || 0));
                }
            });

            totalTableBody.innerHTML = '';
            let accCount = 0, accCash = 0, accCard = 0, accTotal = 0;

            Object.keys(dailySummary).sort().forEach(d => {
                const dayData = dailySummary[d];
                accCount += dayData.count; accCash += dayData.cash; accCard += dayData.card; accTotal += dayData.total;
                if (dayData.total > maxSales) { maxSales = dayData.total; maxSalesDay = d; }

                const row = document.createElement('tr');
                if (dayData.total === 0) row.style.opacity = '0.5';

                // ✅ 요구사항 2번: 총 통계 웹페이지 표기 날짜에 요일 추가 (예: 2026-05-18 월)
                const days = ['일', '월', '화', '수', '목', '금', '토'];
                const dayName = days[new Date(d).getDay()];
                const formattedDate = `${d} ${dayName}`;

                row.innerHTML = `
                    <td>${formattedDate}</td>
                    <td>${dayData.count.toLocaleString()}</td>
                    <td style="font-weight:700; color:var(--text-main);">${accCount.toLocaleString()}</td>
                    <td>${dayData.cash.toLocaleString()}</td>
                    <td style="color:var(--secondary); font-weight:700;">${accCash.toLocaleString()}</td>
                    <td>${dayData.card.toLocaleString()}</td>
                    <td style="color:#f59e0b; font-weight:700;">${accCard.toLocaleString()}</td>
                    <td style="font-weight:700; color:var(--primary);">${dayData.total.toLocaleString()}</td>
                `;
                totalTableBody.appendChild(row);
            });

            document.getElementById('rangeTotalSales').textContent = accTotal.toLocaleString();
            document.getElementById('rangeTotalCash').textContent = accCash.toLocaleString();
            document.getElementById('rangeTotalCard').textContent = accCard.toLocaleString();
            document.getElementById('rangeTotalCount').textContent = accCount.toLocaleString();

            document.getElementById('rangeAvgSales').textContent = Math.round(accTotal / (totalDaysCount || 1)).toLocaleString() + " 원";
            document.getElementById('rangeMaxSalesDay').textContent = maxSales > 0 ? `${maxSalesDay} (${maxSales.toLocaleString()}원)` : '-';
            document.getElementById('rangeCashRatio').textContent = accTotal > 0 ? `${Math.round((accCash / accTotal) * 100)}%` : '0%';

        } catch (err) {
            console.error(err);
            totalTableBody.innerHTML = `<tr><td colspan="8" class="empty-msg" style="color: var(--danger);">데이터 로드 중 에러가 발생했습니다.</td></tr>`;
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
        
        wsData.push(['DailyDash 매출보고서']);
        wsData.push([`조회 대상/기간: ${labelStr}`]);
        wsData.push([]); 

        const rows = table.querySelectorAll('tr');
        rows.forEach(row => {
            const rowData = [];
            const cells = row.querySelectorAll('th, td');
            cells.forEach(cell => {
                // ✅ 요구사항 2번: 웹페이지 텍스트(날짜+요일)가 엑셀 파일에도 변형 없이 그대로 기록됨
                rowData.push(cell.innerText);
            });
            wsData.push(rowData);
        });

        const ws = XLSX.utils.aoa_to_sheet(wsData);

        ws['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
            { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } }
        ];

        for (let cellRef in ws) {
            if (cellRef[0] === '!') continue;
            const cell = ws[cellRef];
            const parsed = XLSX.utils.decode_cell(cellRef);
            const row = parsed.r;
            const col = parsed.c;

            // ✅ 요구사항 1번: 데이터 표의 테두리선을 조금 더 뚜렷하고 깔끔한 색상(#94A3B8)으로 강화 적용
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
                // ✅ 요구사항 1번: 엑셀 파일 대제목 폰트 크기 대폭 확대 (size: 16 -> 22) 및 굵게 지정
                cell.s.font = { name: 'Malgun Gothic', size: 22, bold: true, color: { rgb: '1E293B' } };
                cell.s.alignment = { horizontal: 'center', vertical: 'center' };
                delete cell.s.border;
            } else if (row === 1) {
                // ✅ 요구사항 1번: 조회 대상 기간 텍스트 우측 정렬 변경 (center -> right)
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

        ws['!cols'] = [
            { wch: 18 }, // 요일이 추가되었으므로 날짜 컬럼 너비 확장 유지
            { wch: 12 }, 
            { wch: 12 }, 
            { wch: 15 }, 
            { wch: 15 }, 
            { wch: 15 }, 
            { wch: 15 }, 
            { wch: 18 }  
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "매출보고서");
        XLSX.writeFile(wb, `DailyDash_매출보고서_${labelStr}.xlsx`);
    }

    init();
});

window.logout = async () => {
    if (await window.showConfirm("로그아웃 하시겠습니까?")) {
        const SUPABASE_URL = 'https://lbwlodnguwuudbbaqmuz.supabase.co';
        const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxid2xvZG5ndXd1dWRiYmFxbXV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMjg2NjQsImV4cCI6MjA5NDYwNDY2NH0.YJ3zbTthU2aGDCAfnk1GWeuI2nj4VM8qLAKXyaNITPQ';
        const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        await sb.auth.signOut();
        window.location.replace('login.html');
    }
};