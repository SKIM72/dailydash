// ✅ 커스텀 알림/확인 모달을 호출하는 전역 함수
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

// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {

    // ✅ [PWA 추가] 서비스 워커 등록 (가장 먼저 실행)
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js').then(registration => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            }, err => {
                console.log('ServiceWorker registration failed: ', err);
            });
        });
    }
    
    // 1. Supabase 초기화
    const SUPABASE_URL = 'https://lbwlodnguwuudbbaqmuz.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxid2xvZG5ndXd1dWRiYmFxbXV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMjg2NjQsImV4cCI6MjA5NDYwNDY2NH0.YJ3zbTthU2aGDCAfnk1GWeuI2nj4VM8qLAKXyaNITPQ';
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // 2. DOM 요소 선택
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
    const viewDaily = document.getElementById('viewDaily');
    const viewMonthly = document.getElementById('viewMonthly');
    const monthPicker = document.getElementById('currentMonth');
    const monthlyTableBody = document.getElementById('monthlyTableBody');

    const myPageBtn = document.getElementById('myPageBtn');
    const myPageModal = document.getElementById('myPageModal');
    const closeMyPage = document.getElementById('closeMyPage');
    const loggedInEmail = document.getElementById('loggedInEmail');
    const superUserPanel = document.getElementById('superUserPanel');
    const approvalListBody = document.getElementById('approvalListBody');

    if (!datePicker || !tabDaily || !tableBody) return;

    // 3. 앱 초기화
    async function init() {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return; 

        const today = new Date().toISOString().split('T')[0];
        datePicker.value = today;
        monthPicker.value = today.substring(0, 7);

        datePicker.addEventListener('change', () => loadDailyData(datePicker.value));
        monthPicker.addEventListener('change', () => loadMonthlyData(monthPicker.value));
        tabDaily.addEventListener('click', () => switchTab('daily'));
        tabMonthly.addEventListener('click', () => switchTab('monthly'));

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
            
            closeMyPage.addEventListener('click', () => {
                myPageModal.classList.add('hidden-view');
            });
        }

        loadDailyData(today);
    }

    async function loadApprovalList() {
        if (!approvalListBody) return;
        approvalListBody.innerHTML = '<tr><td colspan="2" class="empty-msg"><i class="fas fa-spinner fa-spin"></i> 대기 명단 구성 중...</td></tr>';
        
        const { data: list, error } = await supabase
            .from('user_approvals')
            .select('*')
            .eq('is_approved', false)
            .order('created_at', { ascending: true });
            
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
        
        const { error } = await supabase
            .from('user_approvals')
            .update({ is_approved: true })
            .eq('email', targetEmail);
            
        if (error) {
            await window.showAlert("승인 처리 중 오류 발생: " + error.message);
        } else {
            await window.showAlert(`${targetEmail} 계정의 정산 장부 접근 승인이 완료되었습니다.`);
            loadApprovalList(); 
        }
    };

    async function loadDailyData(date) {
        try {
            tableBody.innerHTML = '<tr><td colspan="9" class="empty-msg"><i class="fas fa-spinner fa-spin"></i> 데이터를 불러오는 중...</td></tr>';
            
            const { data: transactions, error: txError } = await supabase
                .from('transactions')
                .select('*')
                .eq('transaction_date', date)
                .order('created_at', { ascending: true });
                
            if (txError) throw txError;

            const { data: note, error: noteError } = await supabase
                .from('daily_notes')
                .select('special_note')
                .eq('note_date', date)
                .single();

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
            customer_count: parseInt(document.getElementById('count').value) || 0,
            cash_income: parseInt(document.getElementById('cashIn').value) || 0,
            cash_expense: parseInt(document.getElementById('cashOut').value) || 0,
            card_income: parseInt(document.getElementById('cardIn').value) || 0,
            remark1: document.getElementById('remark1').value,
            remark2: document.getElementById('remark2').value
        };

        const { error } = await supabase.from('transactions').insert([newTx]);
        if (!error) {
            form.reset();
            ['count','cashIn','cashOut','cardIn'].forEach(id => document.getElementById(id).value = 0);
            loadDailyData(date);
        } else {
            await window.showAlert("저장 실패: " + error.message);
        }
    });

    window.deleteTransaction = async (id) => {
        if(!(await window.showConfirm("이 내역을 삭제하시겠습니까?"))) return;
        const { error } = await supabase.from('transactions').delete().eq('id', id);
        if(!error) {
            loadDailyData(datePicker.value);
        } else {
            await window.showAlert("삭제 실패: " + error.message);
        }
    };

    saveNoteBtn.addEventListener('click', async () => {
        const { error } = await supabase.from('daily_notes').upsert({ note_date: datePicker.value, special_note: noteInput.value });
        if(!error) await window.showAlert("특기사항이 저장되었습니다.");
    });

    function switchTab(tabName) {
        if (tabName === 'daily') {
            tabDaily.classList.add('active');
            tabMonthly.classList.remove('active');
            viewDaily.style.display = 'flex'; 
            viewMonthly.style.display = 'none';
            loadDailyData(datePicker.value);
        } else {
            tabMonthly.classList.add('active');
            tabDaily.classList.remove('active');
            viewMonthly.style.display = 'flex';
            viewDaily.style.display = 'none';
            loadMonthlyData(monthPicker.value);
        }
    }

    async function loadMonthlyData(monthStr) {
        try {
            monthlyTableBody.innerHTML = '<tr><td colspan="8" class="empty-msg"><i class="fas fa-spinner fa-spin"></i> 데이터를 분석하는 중...</td></tr>';

            const startDate = `${monthStr}-01`;
            const lastDay = new Date(monthStr.split('-')[0], monthStr.split('-')[1], 0).getDate();
            const endDate = `${monthStr}-${lastDay}`;

            const { data: txs, error } = await supabase
                .from('transactions')
                .select('transaction_date, customer_count, cash_income, card_income')
                .gte('transaction_date', startDate)
                .lte('transaction_date', endDate)
                .order('transaction_date', { ascending: true });

            if (error) throw error;

            const dailySummary = {};
            for (let i = 1; i <= lastDay; i++) {
                const d = `${monthStr}-${String(i).padStart(2, '0')}`;
                dailySummary[d] = { count: 0, cash: 0, card: 0, total: 0 };
            }

            txs.forEach(tx => {
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
                
                accCount += dayData.count;
                accCash += dayData.cash;
                accCard += dayData.card;
                accTotal += dayData.total;

                const row = document.createElement('tr');
                if (dayData.total === 0) row.style.opacity = '0.5'; 

                row.innerHTML = `
                    <td>${d}</td>
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

        } catch (err) {
            console.error(err);
            monthlyTableBody.innerHTML = `<tr><td colspan="8" class="empty-msg" style="color: var(--danger);">통계 데이터를 불러오지 못했습니다.</td></tr>`;
        }
    }

    init();
});

// ✅ 메인 화면 로그아웃
window.logout = async () => {
    if (await window.showConfirm("로그아웃 하시겠습니까?")) {
        const SUPABASE_URL = 'https://lbwlodnguwuudbbaqmuz.supabase.co';
        const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxid2xvZG5ndXd1dWRiYmFxbXV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMjg2NjQsImV4cCI6MjA5NDYwNDY2NH0.YJ3zbTthU2aGDCAfnk1GWeuI2nj4VM8qLAKXyaNITPQ';
        const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        
        await sb.auth.signOut();
        window.location.replace('login.html');
    }
};